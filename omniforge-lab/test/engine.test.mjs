import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOmniForgeServer } from '../server.mjs';
import { WorkspaceStore } from '../core.mjs';
import { PtyCoordinator } from '../pty.mjs';
import { AgentEngine, claudeUsage, findCodex } from '../engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'engine-fake-agent.mjs');
const HOOK = path.join(HERE, '..', 'agent-hook.mjs');
const RUN_KEYS = ['id', 'taskId', 'projectId', 'host', 'sessionId', 'hostSessionId', 'root', 'worktree', 'branch', 'baseBranch', 'baseSha', 'state', 'detail', 'startedAt', 'endedAt', 'exitCode', 'usage'];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(root, { commit = true } = {}) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  // The Lab's default data folder sits inside the repository it serves, ignored like in this one.
  fs.writeFileSync(path.join(root, '.gitignore'), '.omniforge-lab/\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'ok\n');
  if (commit) {
    git(root, 'add', '.');
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  }
  return root;
}

async function lab(t, { engineOptions, codexPath } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const root = repo(path.join(temp, 'repo'));
  const dataDir = path.join(root, '.omniforge-lab');
  const hosts = { claude: { file: process.execPath, args: [FAKE, home] }, codex: { file: process.execPath, args: [FAKE, home] } };
  const open = () => createOmniForgeServer({ dataDir, token: 'master-token', codexPath, engineOptions: { homeDir: home, hosts, ...engineOptions } });
  let app = open();
  let base = new URL(await app.listen()).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(os.tmpdir(), temp);
    if (relative.startsWith('omniforge-engine-') && !relative.includes(path.sep)) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
  });
  const headers = { 'content-type': 'application/json', 'x-omniforge-token': 'master-token' };
  const ctx = {
    temp, home, root, dataDir,
    get app() { return app; },
    post: (route, value, extra = headers) => fetch(`${base}${route}`, { method: 'POST', headers: extra, body: typeof value === 'string' ? value : JSON.stringify(value) }),
    get: route => fetch(`${base}${route}`, { headers }),
    base: () => base,
    async restart(between = () => {}) { await app.close(); between(); app = open(); base = new URL(await app.listen()).origin; },
    async runs(projectId) { return (await (await ctx.get(`/api/agents?projectId=${projectId}`)).json()).runs; },
    async until(projectId, runId, state) {
      const deadline = Date.now() + 20000;
      let run;
      while (Date.now() < deadline) {
        run = (await ctx.runs(projectId)).find(item => item.id === runId);
        if (run?.state === state) return run;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(`run ${runId} stayed ${run?.state} (${run?.detail}), expected ${state}`);
    },
    agentEvent: (token, value) => ctx.post('/api/agent-events', value, { 'content-type': 'application/json', ...(token && { 'x-omniforge-run-token': token }) }),
  };
  return ctx;
}

async function agentStream(base, t) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/api/events?token=master-token`, { signal: controller.signal });
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let end; (end = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(end + 2)) {
          const frame = buffer.slice(0, end).match(/^event: agent\ndata: (.*)$/s);
          if (frame) events.push(JSON.parse(frame[1]));
        }
      }
    } catch { /* aborted at teardown */ }
  })();
  return events;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 20000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(predicate(), message);
}

const call = run => JSON.parse(fs.readFileSync(path.join(run.worktree, 'agent-call.json'), 'utf8'));

test('a PTY launch override replaces the program, arguments and folder but keeps the Lab environment', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const store = new WorkspaceStore(path.join(temp, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const project = store.addProject({ name: 'Launch', root: temp });
  const session = store.addSession({ projectId: project.id, name: 'Agente' });
  let spawned;
  const child = { pid: 4321, onData() {}, onExit() {}, kill() {} };
  // Git location variables (as inside a git hook that launched the Lab) would point the agent's git at another repository.
  const env = { PATH: 'x', KEEP: '1', GIT_DIR: path.join(temp, 'hook', '.git'), git_work_tree: temp, GIT_INDEX_FILE: 'index' };
  const coordinator = new PtyCoordinator(store, { env, spawnPty: (file, args, options) => { spawned = { file, args, options }; return child; } });
  coordinator.start(session.id, { cwd: path.join(temp, 'data'), file: process.execPath, args: ['--flag', 'a "b"'], env: { EXTRA: '2' } });
  assert.equal(spawned.file, fs.realpathSync.native(process.execPath));
  assert.deepEqual(spawned.args, ['--flag', 'a "b"']);
  assert.equal(spawned.options.cwd, path.join(temp, 'data'));
  assert.deepEqual(spawned.options.env, { PATH: 'x', KEEP: '1', EXTRA: '2', OMNIFORGE_PROJECT_ID: project.id, OMNIFORGE_SESSION_ID: session.id });
});

test('the engine\'s git ignores git location variables the Lab inherited (as inside a git hook)', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const store = new WorkspaceStore(path.join(temp, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });
  const shells = Object.assign(new EventEmitter(), { start() {} });
  const engine = new AgentEngine({ store, shells, hookUrl: () => 'http://127.0.0.1:9/api/agent-events', homeDir: path.join(temp, 'home'), hosts: { claude: { file: process.execPath, args: [] } } });
  const decoy = repo(path.join(temp, 'decoy'));
  const project = store.addProject({ name: 'Repo', root: repo(path.join(temp, 'repo')) });
  const task = store.addTask({ projectId: project.id, title: 'Hook' });
  const hook = { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, '.git', 'index') };
  const saved = Object.fromEntries(Object.keys(hook).map(key => [key, process.env[key]]));
  Object.assign(process.env, hook);
  let run;
  try { run = engine.run(task.id, { host: 'claude', expectedRevision: task.revision }); }
  finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.equal(run.baseSha, git(project.root, 'rev-parse', 'HEAD'));
  assert.equal(git(run.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), run.branch);
  assert.notEqual(git(project.root, 'branch', '--list', run.branch), '');
  assert.equal(git(decoy, 'branch', '--list', 'omniforge/*'), '', 'the decoy repository is untouched');
});

test('the hook relay always exits 0 and never writes to stdout, even with the Lab gone or garbage input', () => {
  const env = { ...process.env, OMNIFORGE_RUN_ID: 'r', OMNIFORGE_RUN_TOKEN: 't', OMNIFORGE_HOOK_URL: 'http://127.0.0.1:9/api/agent-events' };
  for (const [args, input] of [[[], '{"hook_event_name":"Stop"}'], [[], 'lixo'], [['{"type":"agent-turn-complete"}'], '']]) {
    const result = spawnSync(process.execPath, [HOOK, ...args], { input, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('a Claude task runs in its own worktree and branch, reports hook states and ends with observed usage', async t => {
  const lab_ = await lab(t);
  const { root, dataDir, post, get } = lab_;
  const events = await agentStream(lab_.base(), t);
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  // Starts and ends with a quote, carries cmd.exe metacharacters and a newline: it must arrive as literal text.
  const title = '"a" & calc & "b"';
  const details = 'a" & calc & "\nlinha 2 %PATH% $(whoami) `id`';
  const task = await (await post('/api/tasks', { projectId: project.id, title, details })).json();
  const head = git(root, 'rev-parse', 'HEAD');
  const response = await post(`/api/tasks/${task.id}/run`, { host: 'claude', expectedRevision: 1 });
  assert.equal(response.status, 200, await response.clone().text());
  const run = await response.json();
  assert.deepEqual(Object.keys(run).sort(), [...RUN_KEYS].sort());
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(run.host, 'claude');
  assert.equal(run.root, fs.realpathSync.native(root));
  // A short folder name keeps Claude's transcript path under Windows' 260-character limit.
  assert.equal(run.worktree, fs.realpathSync.native(path.join(dataDir, 'worktrees', run.id.slice(0, 8))));
  assert.equal(run.branch, `omniforge/${task.id.slice(0, 8)}-1`);
  assert.equal(run.baseBranch, 'main');
  assert.equal(run.baseSha, head);
  assert.equal(run.state, 'working');
  assert.match(run.hostSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(run.usage, { status: 'unknown', inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, source: null, reason: 'Execução em andamento' });
  assert.equal(git(run.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), run.branch);
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  const bound = (await (await get('/api/state')).json()).tasks.find(item => item.id === task.id);
  assert.deepEqual([bound.sessionId, bound.worktree, bound.status, bound.revision], [run.sessionId, run.worktree, 'running', 3]);
  const again = await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: 3 });
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /já tem um agente/);

  await lab_.until(project.id, run.id, 'blocked');
  const launched = call(run);
  const settingsFile = path.join(dataDir, 'runs', run.id, 'claude-settings.json');
  assert.deepEqual(launched.args, ['--session-id', run.hostSessionId, '--settings', settingsFile, `Tarefa: ${title}\n\n${details}`]);
  assert.equal(path.relative(run.worktree, settingsFile).startsWith('..'), true);
  const settingsText = fs.readFileSync(settingsFile, 'utf8');
  const settings = JSON.parse(settingsText);
  assert.deepEqual(Object.keys(settings), ['hooks']);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
  const posix = value => value.replaceAll('\\', '/');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `"${posix(process.execPath)}" "${posix(HOOK)}"`);
  assert.equal(launched.env.OMNIFORGE_RUN_ID, run.id);
  assert.equal(launched.env.OMNIFORGE_HOOK_URL, `${lab_.base()}/api/agent-events`);
  assert.match(launched.env.OMNIFORGE_RUN_TOKEN, /^[0-9a-f]{48}$/);
  for (const text of [JSON.stringify(launched), settingsText]) assert.equal(text.includes('master-token'), false);

  // Enter typed while the agent waits counts as an answer; the fake then reports Stop and exits 0.
  assert.equal((await post(`/api/sessions/${run.sessionId}/write`, { data: '\r' })).status, 200);
  const done = await lab_.until(project.id, run.id, 'done');
  assert.equal(done.exitCode, 0);
  assert.ok(Date.parse(done.endedAt) >= Date.parse(done.startedAt));
  assert.deepEqual(done.usage, { status: 'observed', inputTokens: 6011, outputTokens: 6007, cacheReadTokens: 103, cacheCreationTokens: 24,
    source: path.join(lab_.home, '.claude', 'projects', 'C--qualquer-pasta', `${run.hostSessionId}.jsonl`), reason: null });
  assert.equal(git(root, 'status', '--porcelain'), '');
  await waitFor(() => events.some(event => event.runId === run.id && event.state === 'done'), 'SSE agent done');
  const mine = events.filter(event => event.runId === run.id);
  // The fake's PreToolUse (tool Bash) while already working is a no-op: no runs.json write, no broadcast per tool switch.
  assert.deepEqual(mine.map(event => [event.state, event.detail]), [
    ['starting', ''], ['working', ''], ['blocked', 'permission_prompt'], ['working', ''], ['idle', ''], ['done', ''],
  ]);
  assert.deepEqual(Object.keys(mine[0]), ['taskId', 'projectId', 'runId', 'sessionId', 'host', 'state', 'detail', 'at']);
  assert.deepEqual([mine[0].taskId, mine[0].projectId, mine[0].sessionId, mine[0].host], [task.id, project.id, run.sessionId, 'claude']);
  // A finished run's secret no longer works.
  assert.equal((await lab_.agentEvent(launched.env.OMNIFORGE_RUN_TOKEN, { runId: run.id, event: 'Stop' })).status, 403);
  assert.equal(lab_.app.engine.runForTask(task.id).state, 'done');
  assert.equal(lab_.app.engine.runForTask('nenhuma'), null);
  // The review routes read the engine's run by default: the fake agent's file is the task's diff.
  const diff = await (await get(`/api/tasks/${task.id}/diff`)).json();
  assert.deepEqual([diff.branch, diff.files.map(file => file.path)], [run.branch, ['agent-call.json']]);
  // The agent exited on its own, so its session stays uncertain, but only for its own worktree: the next run starts.
  assert.equal((await (await get('/api/state')).json()).sessions.find(item => item.id === run.sessionId).status, 'interrupted');
  const next = await post(`/api/tasks/${task.id}/run`, { host: 'claude', expectedRevision: 3 });
  assert.equal(next.status, 200, await next.clone().text());
  const second = await next.json();
  assert.equal(second.branch, `omniforge/${task.id.slice(0, 8)}-2`);
  await lab_.until(project.id, second.id, 'blocked');
  assert.equal((await post(`/api/sessions/${second.sessionId}/write`, { data: '\r' })).status, 200);
  await lab_.until(project.id, second.id, 'done');
});

test('a Codex task gets notify as TOML and reads its own rollout; hook secrets are per run', async t => {
  const lab_ = await lab(t);
  const { root, post } = lab_;
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  const first = await (await post('/api/tasks', { projectId: project.id, title: 'Codex tarefa' })).json();
  const second = await (await post('/api/tasks', { projectId: project.id, title: 'Claude tarefa', details: 'FALHAR de propósito' })).json();
  const codex = await (await post(`/api/tasks/${first.id}/run`, { host: 'codex', expectedRevision: 1 })).json();
  const claude = await (await post(`/api/tasks/${second.id}/run`, { host: 'claude', expectedRevision: 1 })).json();
  assert.notEqual(codex.worktree, claude.worktree);
  assert.equal(codex.hostSessionId, null);
  await lab_.until(project.id, claude.id, 'blocked');
  const codexCall = call(codex);
  const [noDaemon, flagC, worktree, flagConfig, notify, prompt] = codexCall.args;
  // --no-daemon keeps the turn, and so notify, inside the PTY that carries the run's hook environment.
  assert.deepEqual([noDaemon, flagC, worktree, flagConfig, prompt, codexCall.args.length], ['--no-daemon', '-C', codex.worktree, '-c', 'Tarefa: Codex tarefa', 6]);
  // A JSON string array is valid TOML: backslashes and quotes of a Windows path stay escaped.
  assert.deepEqual(JSON.parse(notify.replace(/^notify=/, '')), [process.execPath, HOOK]);
  const codexToken = codexCall.env.OMNIFORGE_RUN_TOKEN;
  const claudeToken = call(claude).env.OMNIFORGE_RUN_TOKEN;
  assert.notEqual(codexToken, claudeToken);

  const rejected = [
    [null, { runId: codex.id, event: 'Stop' }, 403],
    ['0'.repeat(48), { runId: codex.id, event: 'Stop' }, 403],
    [claudeToken, { runId: codex.id, event: 'Stop' }, 403],
    ['master-token', { runId: codex.id, event: 'Stop' }, 403],
    [codexToken, { runId: 'desconhecida', event: 'Stop' }, 403],
    [codexToken, { runId: codex.id, event: 'SessionStart' }, 400],
    [codexToken, JSON.stringify({ runId: codex.id, event: 'Stop', detail: 'x'.repeat(17 * 1024) }), 413],
  ];
  for (const [token, value, status] of rejected) assert.equal((await lab_.agentEvent(token, value)).status, status, JSON.stringify([token, status]));
  // The Host check still applies: a rebinding page cannot reach this route under another name.
  const { port } = new URL(lab_.base());
  const rebound = await new Promise((resolve, reject) => {
    const headers = { host: `rebind.example:${port}`, 'x-omniforge-run-token': codexToken };
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/agent-events', headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end(JSON.stringify({ runId: codex.id, event: 'Stop' }));
  });
  assert.equal(rebound, 403);
  // A valid event changes only its own run.
  assert.equal((await lab_.agentEvent(codexToken, { runId: codex.id, event: 'Stop' })).status, 200);
  const states = Object.fromEntries((await lab_.runs(project.id)).map(run => [run.id, run.state]));
  assert.deepEqual(states, { [codex.id]: 'idle', [claude.id]: 'blocked' });

  // Decoys: the same worktree before the run began, and a newer session in another folder.
  const sessions = path.join(lab_.home, '.codex', 'sessions', '2026', '09', '25');
  fs.mkdirSync(sessions, { recursive: true });
  const meta = (cwd, timestamp) => JSON.stringify({ type: 'session_meta', payload: { id: 'decoy', timestamp, cwd } });
  const count = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 5 } } } });
  fs.writeFileSync(path.join(sessions, 'rollout-old.jsonl'), `${meta(codex.worktree, '2020-01-01T00:00:00.000Z')}\n${count}`);
  fs.writeFileSync(path.join(sessions, 'rollout-other.jsonl'), `${meta(root, '2999-01-01T00:00:00.000Z')}\n${count}`);
  // A concurrent session elsewhere past V8's string limit (~512 MiB; this host has a 1.5 GB rollout): only its first
  // line may be read. Extending the file writes no data.
  const huge = path.join(sessions, 'rollout-huge.jsonl');
  fs.writeFileSync(huge, `${meta(root, new Date().toISOString())}\n`);
  fs.truncateSync(huge, 600 * 2 ** 20);

  assert.equal((await post(`/api/sessions/${codex.sessionId}/write`, { data: 'continue\r' })).status, 200);
  const codexDone = await lab_.until(project.id, codex.id, 'done');
  assert.equal(codexDone.hostSessionId, 'fake-thread');
  // Codex's input_tokens (80) include its cached input (40); like Claude's, the stored input excludes cache reads.
  assert.deepEqual(codexDone.usage, { status: 'observed', inputTokens: 40, outputTokens: 9, cacheReadTokens: 40, cacheCreationTokens: 2,
    source: path.join(lab_.home, '.codex', 'sessions', '2026', '09', '26', 'rollout-2026-09-26T10-00-00-fake-thread.jsonl'), reason: null });
  assert.equal((await post(`/api/sessions/${claude.sessionId}/write`, { data: '\r' })).status, 200);
  const failed = await lab_.until(project.id, claude.id, 'failed');
  assert.deepEqual([failed.exitCode, failed.detail], [3, 'saiu com código 3']);
  assert.equal((await lab_.agentEvent(codexToken, { runId: codex.id, event: 'Stop' })).status, 403);
  assert.deepEqual((await lab_.runs(project.id)).map(run => run.id), [claude.id, codex.id]);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a run is refused before anything is created when the repository, task or executable is not ready', async t => {
  // Fake hosts here: a refusal bug must never launch a real agent.
  const lab_ = await lab(t);
  const { temp, root, dataDir } = lab_;
  // Only npm-style shims on PATH and no native install folder: never run through cmd.exe.
  const shims = path.join(temp, 'shims');
  fs.mkdirSync(shims);
  for (const name of ['claude.cmd', 'claude.bat', 'codex.cmd']) fs.writeFileSync(path.join(shims, name), '@echo off\r\n');
  const refusal = async (projectRoot, body, status, pattern, { post } = lab_) => {
    const project = await (await post('/api/projects', { name: path.basename(projectRoot), root: projectRoot })).json();
    const task = await (await post('/api/tasks', { projectId: project.id, title: 'Tarefa' })).json();
    const response = await post(`/api/tasks/${task.id}/run`, { expectedRevision: 1, ...body });
    const { error } = await response.json();
    assert.equal(response.status, status, `${projectRoot} ${JSON.stringify(body)}: ${error}`);
    assert.match(error, pattern);
  };
  const plain = path.join(temp, 'sem-git');
  fs.mkdirSync(plain);
  await refusal(plain, { host: 'claude' }, 409, /repositório git/);
  await refusal(repo(path.join(temp, 'sem-commit'), { commit: false }), { host: 'claude' }, 409, /pelo menos um commit/);
  const detached = repo(path.join(temp, 'destacado'));
  git(detached, 'checkout', '-q', '--detach');
  await refusal(detached, { host: 'claude' }, 409, /HEAD destacado/);
  fs.mkdirSync(path.join(root, 'sub'));
  await refusal(path.join(root, 'sub'), { host: 'claude' }, 409, /raiz de um repositório/);
  await refusal(root, { host: 'bash' }, 400, /Host de agente inválido/);
  await refusal(root, { host: 'claude', expectedRevision: 7 }, 409, /Tarefa alterada/);
  const restricted = await lab(t, { codexPath: null, engineOptions: { hosts: null, env: { PATH: shims } } });
  await refusal(restricted.root, { host: 'claude' }, 409, /Claude.*\.cmd/, restricted);
  await refusal(restricted.root, { host: 'codex' }, 409, /Codex.*\.cmd/, restricted);
  // The .sandbox-bin copy serves the quota read, but an agent there fails every tool closed.
  const sandboxBin = path.join(temp, 'home', '.codex', '.sandbox-bin');
  fs.mkdirSync(sandboxBin, { recursive: true });
  fs.writeFileSync(path.join(sandboxBin, process.platform === 'win32' ? 'codex.exe' : 'codex'), '');
  const sandboxed = await lab(t, { codexPath: path.join(sandboxBin, process.platform === 'win32' ? 'codex.exe' : 'codex'), engineOptions: { hosts: null } });
  await refusal(sandboxed.root, { host: 'codex' }, 409, /\.sandbox-bin.*instale o Codex CLI ou o app do Codex/, sandboxed);
  for (const ctx of [lab_, restricted, sandboxed]) {
    assert.equal(fs.existsSync(path.join(ctx.dataDir, 'worktrees')), false);
    assert.equal(git(ctx.root, 'branch', '--list', 'omniforge/*'), '');
    assert.equal(git(ctx.root, 'status', '--porcelain'), '');
    assert.equal(ctx.app.store.data.sessions.length, 0);
  }
  assert.equal(fs.existsSync(path.join(dataDir, 'runs.json')), false);
});

test('a launch that fails after the worktree exists ends failed, never stuck starting', async t => {
  const lab_ = await lab(t);
  const { root, dataDir, post } = lab_;
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Sem settings' })).json();
  // A file where the per-run folder must go makes the Claude settings write fail.
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'runs'), '');
  assert.equal((await post(`/api/tasks/${task.id}/run`, { host: 'claude', expectedRevision: 1 })).status, 500);
  const [failed] = await lab_.runs(project.id);
  assert.equal(failed.state, 'failed');
  assert.ok(failed.endedAt);
  // Nothing was spawned: the session is a plain stop and the task can run again.
  assert.equal(lab_.app.store.session(failed.sessionId).status, 'stopped');
  const retry = await (await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: 1 })).json();
  assert.equal(retry.state, 'working');
  await waitFor(() => fs.existsSync(path.join(retry.worktree, 'agent-call.json')), 'fake Codex started');
});

test('an agent killed by a signal, or stopped by the Lab without confirmation, ends failed/interrompido, never done or with an exit code', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const store = new WorkspaceStore(path.join(temp, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });
  const shells = Object.assign(new EventEmitter(), { start() {} });
  const engine = new AgentEngine({ store, shells, hookUrl: () => 'http://127.0.0.1:9/api/agent-events', homeDir: path.join(temp, 'home'), hosts: { claude: { file: process.execPath, args: [] } } });
  const project = store.addProject({ name: 'Repo', root: repo(path.join(temp, 'repo')) });
  const task = store.addTask({ projectId: project.id, title: 'Parar' });
  const run = engine.run(task.id, { host: 'claude', expectedRevision: task.revision });
  // POSIX: a Lab stop or shutdown reports code 0 plus the signal.
  shells.emit('closed', { sessionId: run.sessionId, code: 0, signal: 9 });
  const stopped = engine.runForTask(task.id);
  assert.deepEqual([stopped.state, stopped.detail, stopped.exitCode], ['failed', 'interrompido', null]);
  // Windows: taskkill ended it with code 1 but could not confirm the tree, so the session is interrupted, not stopped.
  const other = store.addTask({ projectId: project.id, title: 'Parar sem confirmação' });
  const unconfirmed = engine.run(other.id, { host: 'claude', expectedRevision: other.revision });
  store.setSessionStatus(unconfirmed.sessionId, 'interrupted');
  shells.emit('closed', { sessionId: unconfirmed.sessionId, code: 1, signal: null, stopRequested: true });
  const ended = engine.runForTask(other.id);
  assert.deepEqual([ended.state, ended.detail, ended.exitCode], ['failed', 'interrompido', null]);
});

test('an agent the Lab stops ends failed/interrompido with no exit code, also on Windows where taskkill exits it with 1', async t => {
  const lab_ = await lab(t);
  const { root, post } = lab_;
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Parar pelo Lab' })).json();
  const run = await (await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: 1 })).json();
  await waitFor(() => fs.existsSync(path.join(run.worktree, 'agent-call.json')) && lab_.app.store.session(run.sessionId).status === 'running', 'fake Codex running');
  assert.equal((await post(`/api/sessions/${run.sessionId}/stop`, {})).status, 200);
  const stopped = await lab_.until(project.id, run.id, 'failed');
  assert.deepEqual([stopped.detail, stopped.exitCode], ['interrompido', null]);
});

test('a run moves an open task to running and leaves a blocked or done task as it was', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const store = new WorkspaceStore(path.join(temp, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });
  const shells = Object.assign(new EventEmitter(), { start() {} });
  const engine = new AgentEngine({ store, shells, hookUrl: () => 'http://127.0.0.1:9/api/agent-events', homeDir: path.join(temp, 'home'), hosts: { claude: { file: process.execPath, args: [] } } });
  const project = store.addProject({ name: 'Repo', root: repo(path.join(temp, 'repo')) });
  const open = store.addTask({ projectId: project.id, title: 'Aberta' });
  const run = engine.run(open.id, { host: 'claude', expectedRevision: open.revision });
  const moved = store.task(open.id);
  assert.deepEqual([moved.status, moved.sessionId, moved.worktree, moved.revision], ['running', run.sessionId, run.worktree, 3]);
  for (const status of ['blocked', 'done']) {
    const task = store.addTask({ projectId: project.id, title: status });
    store.setTaskStatus(task.id, status, task.revision);
    engine.run(task.id, { host: 'claude', expectedRevision: task.revision });
    assert.equal(store.task(task.id).status, status);
  }
});

test('a Lab restart turns an unfinished run into failed/interrompido, never done', async t => {
  const lab_ = await lab(t);
  const { root, dataDir, post } = lab_;
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Longa' })).json();
  const run = await (await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: 1 })).json();
  await waitFor(() => fs.existsSync(path.join(run.worktree, 'agent-call.json')), 'fake Codex started');
  const token = call(run).env.OMNIFORGE_RUN_TOKEN;
  // Simulate a crash: the file still says working when the next Lab starts.
  await lab_.restart(() => {
    const runs = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8'));
    runs[0].state = 'working';
    fs.writeFileSync(path.join(dataDir, 'runs.json'), JSON.stringify(runs));
  });
  const [recovered] = await lab_.runs(project.id);
  assert.deepEqual([recovered.id, recovered.state, recovered.detail], [run.id, 'failed', 'interrompido']);
  assert.ok(recovered.endedAt);
  assert.equal(recovered.usage.status, 'unknown');
  assert.match(recovered.usage.reason, /Codex/);
  assert.equal((await lab_.agentEvent(token, { runId: run.id, event: 'Stop' })).status, 403);
  // A new run of the same task is allowed and takes the next branch number.
  if (lab_.app.store.session(run.sessionId).status === 'interrupted') {
    assert.equal((await post(`/api/sessions/${run.sessionId}/acknowledge`, { verification: 'Processo encerrado no teste' })).status, 200);
  }
  const revision = lab_.app.store.task(task.id).revision;
  const next = await (await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: revision })).json();
  assert.equal(next.branch, `omniforge/${task.id.slice(0, 8)}-2`);
  // Let the PTY report its PID before teardown stops it; an uncommitted launch is (rightly) never a confirmed stop.
  await waitFor(() => fs.existsSync(path.join(next.worktree, 'agent-call.json')), 'second fake Codex started');
});

test('codex resolves to PATH, then the Codex app build that has its code-mode host, then .sandbox-bin', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const put = (...parts) => { const file = path.join(temp, ...parts); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };
  const sandbox = put('home', '.codex', '.sandbox-bin', exe);
  const env = { USERPROFILE: path.join(temp, 'home'), LOCALAPPDATA: path.join(temp, 'local'), PATH: '' };
  assert.equal(findCodex(env), sandbox);
  put('local', 'OpenAI', 'Codex', 'bin', 'partial', exe);
  assert.equal(findCodex(env), sandbox, 'a build without its code-mode host fails every tool closed');
  const complete = put('local', 'OpenAI', 'Codex', 'bin', 'complete', exe);
  put('local', 'OpenAI', 'Codex', 'bin', 'complete', 'codex-code-mode-host.exe');
  assert.equal(findCodex(env), complete);
  const onPath = put('path', exe);
  assert.equal(findCodex({ ...env, PATH: path.dirname(onPath) }), onPath);
});

test('CLI prompts that fire no hook (folder trust, hook review, model switch, approvals) show the run as blocked', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  const store = new WorkspaceStore(path.join(temp, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });
  const shells = Object.assign(new EventEmitter(), { start() {} });
  const engine = new AgentEngine({ store, shells, hookUrl: () => 'http://127.0.0.1:9/api/agent-events', homeDir: path.join(temp, 'home'), hosts: { claude: { file: process.execPath, args: [] }, codex: { file: process.execPath, args: [] } } });
  const project = store.addProject({ name: 'Repo', root: repo(path.join(temp, 'repo')) });
  const run = host => engine.run(store.addTask({ projectId: project.id, title: host }).id, { host, expectedRevision: 1 });
  const state = id => { const found = engine.list(project.id).find(item => item.id === id); return [found.state, found.detail]; };
  const claude = run('claude');
  // Real Claude output: words placed by cursor moves, split across chunks.
  shells.emit('terminal', { sessionId: claude.sessionId, text: 'Quick safety check \x1b[1C❯ No, exit \x1b[2;4HYes, I tr' });
  assert.deepEqual(state(claude.id), ['working', '']);
  shells.emit('terminal', { sessionId: claude.sessionId, text: 'ust\x1b[1Cthis folder' });
  assert.deepEqual(state(claude.id), ['blocked', 'trust_prompt']);
  engine.input(claude.sessionId, '\r');
  assert.deepEqual(state(claude.id), ['working', '']);
  shells.emit('terminal', { sessionId: claude.sessionId, text: 'Read 1 file' });
  assert.deepEqual(state(claude.id), ['working', ''], 'the answered prompt is not detected again');
  const codex = run('codex');
  for (const [text, detail] of [['Trust this folder? Codex can read', 'trust_prompt'], ['Hooks need review', 'hooks_review'],
    ['Approaching rate limits', 'rate_limit_prompt'], ['Would you like to run the following command?', 'approval_prompt'], ['Would you like to make the following edits?', 'approval_prompt']]) {
    shells.emit('terminal', { sessionId: codex.sessionId, text });
    assert.deepEqual(state(codex.id), ['blocked', detail], text);
    engine.input(codex.sessionId, '\r');
  }
});

test('a missing Claude transcript names the Windows path limit when the expected path is too long', { skip: process.platform !== 'win32' && 'Windows path limit' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-'));
  try {
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    assert.equal(claudeUsage(home, '9eb69a4e-8692-4290-aa64-000470ad5a61', 'C:\\curto').usage.reason, 'Transcrição da sessão Claude não encontrada');
    assert.match(claudeUsage(home, '9eb69a4e-8692-4290-aa64-000470ad5a61', 'C:\\' + 'pasta\\'.repeat(40)).usage.reason, /260 caracteres/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the Gauntlet runs only on its own request, report-only in the finished run\'s worktree, and its report lands in the evidence', async t => {
  const lab_ = await lab(t);
  const { root, dataDir, post, get } = lab_;
  const events = await agentStream(lab_.base(), t);
  const project = await (await post('/api/projects', { name: 'Repo', root })).json();
  const task = await (await post('/api/tasks', { projectId: project.id, title: 'Revisar com Gauntlet' })).json();
  const revision = () => lab_.app.store.task(task.id).revision;
  const gauntlet = body => post(`/api/tasks/${task.id}/gauntlet`, { expectedRevision: revision(), preset: 'rapido', ...body });
  assert.equal((await gauntlet()).status, 404, 'no run, nothing to review');
  const run = await (await post(`/api/tasks/${task.id}/run`, { host: 'claude', expectedRevision: 1 })).json();
  await lab_.until(project.id, run.id, 'blocked');
  const early = await gauntlet();
  assert.equal(early.status, 409);
  assert.match((await early.json()).error, /terminado/);
  assert.equal((await post(`/api/sessions/${run.sessionId}/write`, { data: '\r' })).status, 200);
  await lab_.until(project.id, run.id, 'done');
  assert.equal((await gauntlet({ preset: 'profundo' })).status, 400);
  assert.equal((await gauntlet({ expectedRevision: 99 })).status, 409);
  // The agent exited on its own: its session is uncertain, and nothing else starts in its folder until the owner checks it.
  const uncertain = await gauntlet();
  assert.equal(uncertain.status, 409);
  assert.match((await uncertain.json()).error, /sessão incerta/);
  assert.equal((await post(`/api/sessions/${run.sessionId}/acknowledge`, { verification: 'Processo do agente encerrado' })).status, 200);
  // Nothing but the gauntlet request itself starts a review.
  assert.deepEqual((await lab_.runs(project.id)).map(item => [item.id, item.kind]), [[run.id, undefined]]);

  const response = await gauntlet();
  assert.equal(response.status, 200, await response.clone().text());
  const review = await response.json();
  assert.deepEqual([review.kind, review.host, review.root, review.worktree, review.branch, review.baseBranch, review.baseSha],
    ['gauntlet', 'claude', run.root, run.worktree, run.branch, run.baseBranch, run.baseSha]);
  assert.notEqual(review.sessionId, run.sessionId);
  await lab_.until(project.id, review.id, 'blocked');
  // The fake agent records its launch in its own cwd: the finished run's worktree.
  const launched = call(review);
  assert.deepEqual(launched.args, ['--session-id', review.hostSessionId, '--settings', path.join(dataDir, 'runs', review.id, 'claude-settings.json'),
    `/gauntlet-loop rapido so-relatorio sem-perguntas desde=${run.baseSha}`]);
  assert.equal(launched.env.OMNIFORGE_RUN_ID, review.id);
  // The task keeps its owner and revision: a review is not a new owner.
  assert.deepEqual([lab_.app.store.task(task.id).sessionId, revision()], [run.sessionId, 3]);
  // While it reviews: no second Gauntlet, no new agent run, no merge (it would commit the hunters' probe files).
  assert.match((await (await gauntlet()).json()).error, /já tem uma revisão/);
  assert.equal((await post(`/api/tasks/${task.id}/run`, { host: 'codex', expectedRevision: revision() })).status, 409);
  const merge = await post(`/api/tasks/${task.id}/merge`, { expectedRevision: revision() });
  assert.equal(merge.status, 409);
  assert.match((await merge.json()).error, /Gauntlet/);

  assert.equal((await post(`/api/sessions/${review.sessionId}/write`, { data: '\r' })).status, 200);
  const done = await lab_.until(project.id, review.id, 'done');
  assert.equal(done.usage.status, 'observed');
  await waitFor(() => events.some(event => event.runId === review.id && event.state === 'done'), 'SSE gauntlet done');
  assert.ok(events.filter(event => event.runId === review.id).every(event => event.kind === 'gauntlet'), 'the agent SSE names the review run');
  const bundle = await (await get(`/api/tasks/${task.id}/evidence`)).json();
  assert.deepEqual(bundle.gauntlet, [{ at: done.endedAt, runId: review.id, preset: 'rapido', exitCode: 0, usage: done.usage,
    reportPath: path.join(run.worktree, '.gauntlet', 'relatorio-fake.md'), summary: { high: 1, medium: 0, low: 2, unverified: 0 } }]);
  // Merge attempts stay as they were and name the agent run, not the review.
  assert.deepEqual(bundle.attempts.map(attempt => [attempt.runId, attempt.usage.status]), [[run.id, 'observed']]);
  // The report folder ignores itself: the task's diff and merge never carry it.
  const diff = await (await get(`/api/tasks/${task.id}/diff`)).json();
  assert.deepEqual(diff.files.map(file => file.path), ['agent-call.json']);
  assert.equal(lab_.app.engine.runForTask(task.id).id, run.id);
  assert.equal(lab_.app.engine.runForTask(task.id, 'gauntlet').id, review.id);

  // /run never takes a kind or a prompt from the page: this is an ordinary agent run in a new worktree, not a flag.
  const body = { host: 'claude', expectedRevision: revision(), kind: 'gauntlet', prompt: '--dangerously-skip-permissions' };
  const smuggled = await (await post(`/api/tasks/${task.id}/run`, body)).json();
  assert.equal(smuggled.kind, undefined);
  assert.notEqual(smuggled.worktree, run.worktree);
  await waitFor(() => fs.existsSync(path.join(smuggled.worktree, 'agent-call.json')), 'fake Claude started');
  assert.equal(call(smuggled).args.at(-1), 'Tarefa: Revisar com Gauntlet');
});

test('a review in a finished run\'s worktree still sees that run\'s uncertain session when the data folder is an alias', t => {
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-engine-')));
  const real = path.join(temp, 'real'), alias = path.join(temp, 'alias');
  fs.mkdirSync(real);
  // Another spelling of the same folder, like the 8.3 short name of %TEMP% on a CI runner.
  fs.symlinkSync(real, alias, 'junction');
  const store = new WorkspaceStore(path.join(alias, 'data'));
  t.after(() => { store.close(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });
  const shells = Object.assign(new EventEmitter(), { start() {} });
  const engine = new AgentEngine({ store, shells, hookUrl: () => 'http://127.0.0.1:9/api/agent-events', homeDir: path.join(temp, 'home'), hosts: { claude: { file: process.execPath, args: [] } } });
  const project = store.addProject({ name: 'Repo', root: repo(path.join(temp, 'repo')) });
  const task = store.addTask({ projectId: project.id, title: 'Revisar' });
  const run = engine.run(task.id, { host: 'claude', expectedRevision: 1 });
  shells.emit('closed', { sessionId: run.sessionId, code: 0, signal: null });
  store.setSessionStatus(run.sessionId, 'interrupted'); // what the PTY layer records when an agent exits on its own
  assert.throws(() => engine.run(task.id, { host: 'claude', expectedRevision: store.task(task.id).revision, kind: 'gauntlet', prompt: '/gauntlet-loop rapido' }), /sessão incerta/);
});
