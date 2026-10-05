import { redis } from './queue.js';
import { env } from './config.js';

// One atomic script and Redis server time prevent worker races and clock drift.
// The {senderId} hash tag keeps both keys in one slot on Redis Cluster.
export const RESERVE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local hour = math.floor(now / 3600000)
local reset = (hour + 1) * 3600000
local cap = tonumber(ARGV[1])
local delay = tonumber(ARGV[2])
if redis.call('EXISTS', KEYS[2]) == 1 then return {0, now + 300, 0, hour, 0} end
local oldHour = tonumber(redis.call('HGET', KEYS[1], 'hour') or '-1')
local count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
if oldHour ~= hour then count = 0 end
local nextAt = tonumber(redis.call('HGET', KEYS[1], 'nextAt') or '0')
if count >= cap then return {0, reset, count, hour, 1} end
if now < nextAt then return {0, nextAt, count, hour, 0} end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
count = count + 1
redis.call('HSET', KEYS[1], 'hour', hour, 'count', count, 'nextAt', now + delay)
redis.call('PEXPIRE', KEYS[1], 7200000)
return {1, now, count, hour, count == cap and 1 or 0}
`;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[2]) == ARGV[1] then
 local t = redis.call('TIME')
 local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
 local nextAt = tonumber(redis.call('HGET', KEYS[1], 'nextAt') or '0')
 redis.call('HSET', KEYS[1], 'nextAt', math.max(nextAt, now + tonumber(ARGV[2])))
 redis.call('PEXPIRE', KEYS[1], 7200000)
 redis.call('DEL', KEYS[2])
 return 1
end
return 0
`;
function keys(senderId: string) {
  return [`reach:sender:{${senderId}}:quota`, `reach:sender:{${senderId}}:lock`];
}
export async function reserveSend(senderId: string, limit: number, delayMs: number, token: string) {
  const result = (await redis.eval(
    RESERVE_SCRIPT,
    2,
    ...keys(senderId),
    limit,
    delayMs,
    token,
    env.SEND_LEASE_MS,
  )) as number[];
  return {
    allowed: result[0] === 1,
    retryAt: result[1]!,
    count: result[2]!,
    hour: result[3]!,
    hitLimit: result[4] === 1,
  };
}
export async function releaseSend(senderId: string, token: string, delayMs: number) {
  await redis.eval(RELEASE_SCRIPT, 2, ...keys(senderId), token, delayMs);
}
export async function senderUsage(senderId: string) {
  const state = await redis.hgetall(keys(senderId)[0]!);
  const t = await redis.time();
  const hour = Math.floor(Number(t[0]) / 3600);
  return {
    used: Number(state.hour) === hour ? Number(state.count || 0) : 0,
    resetAt: new Date((hour + 1) * 3600000).toISOString(),
  };
}
