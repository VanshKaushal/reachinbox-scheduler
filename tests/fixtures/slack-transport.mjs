// Test-only transport fixture. No production code path can route Slack to this sink.
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.hostname === 'hooks.slack.com' && process.env.TEST_SLACK_SINK)
    return original(process.env.TEST_SLACK_SINK, init);
  return original(input, init);
};
