// Fake Claude Code / Codex for the engine tests (not a test file). Launched as `node engine-fake-agent.mjs <home>
// <agent args...>` through the engine's `hosts` test seam. It records its launch, fires the engine's own hook command
// exactly as the real CLI would, waits for one line of PTY input, writes a session file under the fake home and exits.
// It never calls a model. A prompt containing FALHAR exits with code 3.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [home, ...args] = process.argv.slice(2);
const prompt = args.at(-1);
const after = flag => args[args.indexOf(flag) + 1];
// Only the Lab's own variables: the rest of the environment can hold credentials, and this file is diffed, shown and merged.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('OMNIFORGE_')));
fs.writeFileSync(path.join(process.cwd(), 'agent-call.json'), JSON.stringify({ args, env }));
const line = () => new Promise(resolve => process.stdin.once('data', resolve));

if (args.includes('--session-id')) {
  const settings = JSON.parse(fs.readFileSync(after('--settings'), 'utf8'));
  // Claude runs the hook command through a shell; the command is `"<node>" "<hook>"`.
  const hook = payload => {
    const [file, ...rest] = [...settings.hooks[payload.hook_event_name][0].hooks[0].command.matchAll(/"([^"]*)"/g)].map(match => match[1]);
    spawnSync(file, rest, { input: JSON.stringify(payload) });
  };
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await line();
  hook({ hook_event_name: 'Stop' });
  const dir = path.join(home, '.claude', 'projects', 'C--qualquer-pasta');
  const session = after('--session-id');
  // Workflow-spawned subagents sit one level deeper, in subagents/workflows/wf_*/.
  fs.mkdirSync(path.join(dir, session, 'subagents', 'workflows', 'wf_1'), { recursive: true });
  const assistant = (id, usage) => JSON.stringify({ type: 'assistant', message: { id, usage } });
  fs.writeFileSync(path.join(dir, `${session}.jsonl`), [
    JSON.stringify({ type: 'user', message: { content: 'oi' } }),
    // One API message spans several lines that repeat the same usage.
    ...Array(3).fill(assistant('m1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })),
    assistant('m2', { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
    'linha truncada {',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, session, 'subagents', 'agent-1.jsonl'), assistant('m3', { input_tokens: 1000, output_tokens: 1000 }));
  fs.writeFileSync(path.join(dir, session, 'subagents', 'workflows', 'wf_1', 'agent-2.jsonl'), assistant('m5', { input_tokens: 5000, output_tokens: 5000 }));
  fs.writeFileSync(path.join(dir, 'outra-sessao.jsonl'), assistant('m4', { input_tokens: 99999, output_tokens: 99999 }));
} else {
  await line();
  // Codex runs notify without a shell and appends the event JSON as the last argument.
  const [file, ...rest] = JSON.parse(after('-c').replace(/^notify=/, ''));
  spawnSync(file, [...rest, JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'fake-thread', cwd: process.cwd() })]);
  const dir = path.join(home, '.codex', 'sessions', '2026', '09', '26');
  fs.mkdirSync(dir, { recursive: true });
  const tokens = (input, cached, output) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 2, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output } } } });
  fs.writeFileSync(path.join(dir, 'rollout-2026-09-26T10-00-00-fake-thread.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'fake-thread', timestamp: new Date().toISOString(), cwd: after('-C') } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
    tokens(50, 30, 7),
    tokens(80, 40, 9),
  ].join('\n'));
}
process.exit(prompt.includes('FALHAR') ? 3 : 0);
