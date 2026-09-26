// Relays one agent lifecycle event to the Lab that launched the agent (see engine.mjs). Claude Code pipes the hook
// payload on stdin; Codex `notify` appends it as the last argument. It must never block or fail the agent: it prints
// nothing (Claude would add stdout to the prompt), gives up after a few seconds and always exits 0.
setTimeout(() => process.exit(0), 3000).unref();
const { OMNIFORGE_RUN_ID: runId, OMNIFORGE_RUN_TOKEN: token, OMNIFORGE_HOOK_URL: url } = process.env;
try {
  let text = process.argv.length > 2 ? process.argv.at(-1) : '';
  if (process.argv.length <= 2) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += chunk;
  }
  const payload = JSON.parse(text);
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-omniforge-run-token': token },
    body: JSON.stringify({ runId, event: payload.hook_event_name ?? payload.type, detail: String(payload.notification_type ?? payload.tool_name ?? payload.message ?? '').slice(0, 200) }),
    signal: AbortSignal.timeout(2000),
  });
} catch { /* the Lab may be closed or the payload unexpected; the agent carries on */ }
process.exit(0);
