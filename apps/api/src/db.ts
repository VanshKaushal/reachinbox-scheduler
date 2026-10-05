import mysql, {
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from 'mysql2/promise';
import { env } from './config.js';

const url = new URL(env.DATABASE_URL);
export const db = mysql.createPool({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 16,
  timezone: 'Z',
  charset: 'utf8mb4',
  waitForConnections: true,
  enableKeepAlive: true,
  ...(url.searchParams.get('ssl') === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
});
export type Connection = PoolConnection | typeof db;
export async function rows<T>(
  sql: string,
  args: unknown[] = [],
  conn: Connection = db,
): Promise<T[]> {
  const [result] = await conn.query<RowDataPacket[]>(sql, args);
  return result as T[];
}
export async function execute(sql: string, args: unknown[] = [], conn: Connection = db) {
  const [result] = await conn.query<ResultSetHeader>(sql, args);
  return result;
}
export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
