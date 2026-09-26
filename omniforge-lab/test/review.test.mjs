import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createOmniForgeServer } from '../server.mjs';
import { gitEnv, runTestCommand } from '../review.mjs';

const TOKEN = 'review-token-5f0c9a1e7b3d';
const BRANCH = 'omniforge/task';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const sleepCommand = process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30';

// Real git in a throwaway repository; the location variables of a surrounding hook never leak in.
function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

async function fixture(t, { title = 'Adicionar saudação' } = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'omniforge-review-')));
  const root = path.join(dir, 'root'), worktree = path.join(dir, 'wt');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'master');
  // Identity and line endings are local to this TEST repository only.
  for (const [key, value] of [['user.name', 'Review Tester'], ['user.email', 'review@test.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(root, 'config', key, value);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'worktree', 'add', '-q', '-b', BRANCH, worktree, baseSha);
  const runs = new Map();
  // duringTest runs while the merge waits on its test command: the window in which others can act.
  const timing = { testTimeoutMs: 60_000, duringTest: null };
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: TOKEN, getRun: id => runs.get(id) ?? null,
    runTest: async options => { await timing.duringTest?.(); return runTestCommand({ ...options, timeoutMs: timing.testTimeoutMs }); } });
  const base = new URL(await app.listen()).origin;
  t.after(async () => {
    await app.close();
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), dir);
    if (relative.startsWith('omniforge-review-') && !relative.includes(path.sep)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const project = app.store.addProject({ name: 'Review', root });
  const task = app.store.addTask({ projectId: project.id, title });
  const setRun = (overrides = {}) => runs.set(task.id, { id: 'run-1', taskId: task.id, projectId: project.id, host: 'claude', sessionId: null, hostSessionId: null,
    root, worktree, branch: BRANCH, baseBranch: 'master', baseSha, state: 'done', detail: '', startedAt: '2026-09-26T00:00:00.000Z', endedAt: '2026-09-26T00:01:00.000Z', exitCode: 0,
    usage: { status: 'observed', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, source: 'fixture', reason: null }, ...overrides });
  const headers = { 'x-omniforge-token': TOKEN, 'content-type': 'application/json' };
  const get = route => fetch(`${base}${route}`, { headers });
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const merge = body => post(`/api/tasks/${task.id}/merge`, { expectedRevision: app.store.task(task.id).revision, ...body });
  const evidence = async () => (await get(`/api/tasks/${task.id}/evidence`)).json();
  return { dir, root, worktree, baseSha, app, base, project, task, runs, timing, setRun, get, post, merge, evidence };
}

const write = (dir, file, content) => fs.writeFileSync(path.join(dir, file), content);
const mergeHead = root => spawnSync('git', ['-C', root, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { env: gitEnv() }).status === 0;

test('diff shows committed, uncommitted, untracked and binary work against the base without touching the worktree index', async t => {
  const f = await fixture(t);
  f.setRun({ state: 'working' });
  write(f.worktree, 'committed.txt', 'one\ntwo\n');
  git(f.worktree, 'add', 'committed.txt');
  git(f.worktree, 'commit', '-q', '-m', 'agent commit');
  write(f.worktree, 'README.md', 'base\nchanged\n');
  write(f.worktree, 'staged.txt', 'staged\n');
  git(f.worktree, 'add', 'staged.txt');
  write(f.worktree, 'new.txt', 'untracked\n');
  fs.writeFileSync(path.join(f.worktree, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
  write(f.worktree, 'ignored.txt', 'ignored by .gitignore\n');
  const indexFile = path.resolve(f.worktree, git(f.worktree, 'rev-parse', '--git-path', 'index'));
  const indexBefore = fs.readFileSync(indexFile), statusBefore = git(f.worktree, 'status', '--porcelain');

  const response = await f.get(`/api/tasks/${f.task.id}/diff`);
  assert.equal(response.status, 200);
  const diff = await response.json();
  assert.equal(diff.baseSha, f.baseSha);
  assert.equal(diff.branch, BRANCH);
  const byPath = Object.fromEntries(diff.files.map(file => [file.path, file]));
  assert.deepEqual(Object.keys(byPath).sort(), ['README.md', 'blob.bin', 'committed.txt', 'new.txt', 'staged.txt']);
  assert.deepEqual(byPath['README.md'], { path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false });
  assert.deepEqual(byPath['committed.txt'], { path: 'committed.txt', status: 'A', additions: 2, deletions: 0, binary: false });
  assert.equal(byPath['blob.bin'].binary, true);
  assert.equal(byPath['new.txt'].status, 'A');
  assert.deepEqual(diff.stat, { files: 5, additions: 5, deletions: 0 });
  assert.match(diff.patch, /\+changed/);
  assert.match(diff.patch, /\+untracked/);
  assert.equal(diff.patch.includes('ignored by .gitignore'), false);
  assert.equal(diff.truncated, false);
  assert.deepEqual(fs.readFileSync(indexFile), indexBefore, 'the worktree index must not change');
  assert.equal(git(f.worktree, 'status', '--porcelain'), statusBefore);

  write(f.worktree, 'large.txt', 'x'.repeat(100).concat('\n').repeat(4000));
  const large = await (await f.get(`/api/tasks/${f.task.id}/diff`)).json();
  assert.equal(large.truncated, true);
  assert.ok(Buffer.byteLength(large.patch) <= 256 * 1024);
  assert.equal(large.files.find(file => file.path === 'large.txt').additions, 4000);

  f.runs.clear();
  assert.equal((await f.get(`/api/tasks/${f.task.id}/diff`)).status, 404);
});

test('merge commits pending work, runs the test, merges with --no-ff and records evidence', async t => {
  const f = await fixture(t);
  f.setRun();
  write(f.worktree, 'README.md', 'base\ngreeting\n');
  write(f.worktree, 'hello.txt', 'olá\n');
  const before = git(f.root, 'rev-parse', 'HEAD');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = await fetch(`${f.base}/api/events`, { headers: { 'x-omniforge-token': TOKEN }, signal: controller.signal });
  const reader = events.body.getReader(), decoder = new TextDecoder();
  let received = decoder.decode((await reader.read()).value);

  const body = { testCommand: 'node -e "process.stdout.write(\'tests passed\')"', note: 'Revisado pelo dono' };
  const replies = await Promise.all([f.merge(body), f.merge(body)]);
  const [response, concurrent] = replies[0].status === 200 ? replies : replies.reverse();
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(concurrent.status, 409);
  assert.match((await concurrent.json()).error, /Outro merge em andamento/);
  assert.equal(result.task.status, 'done');
  assert.equal(result.task.revision, 2);

  const head = git(f.root, 'rev-parse', 'HEAD');
  const [first, second] = git(f.root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1);
  assert.equal(first, before);
  assert.equal(second, git(f.root, 'rev-parse', BRANCH));
  assert.equal(git(f.root, 'symbolic-ref', '--short', 'HEAD'), 'master');
  assert.equal(fs.readFileSync(path.join(f.root, 'hello.txt'), 'utf8'), 'olá\n');
  assert.equal(git(f.root, 'log', '-1', '--format=%s|%an <%ae>', BRANCH), `omniforge: ${f.task.title}|Review Tester <review@test.invalid>`);
  assert.equal(git(f.worktree, 'status', '--porcelain'), '');

  const bundle = await f.evidence();
  assert.equal(bundle.taskId, f.task.id);
  assert.equal(bundle.attempts.length, 1);
  const [attempt] = bundle.attempts;
  assert.equal(attempt.refused, null);
  assert.equal(attempt.mergeSha, head);
  assert.equal(attempt.headSha, second);
  assert.equal(attempt.baseSha, f.baseSha);
  assert.equal(attempt.branch, BRANCH);
  assert.equal(attempt.runId, 'run-1');
  assert.equal(attempt.host, 'claude');
  assert.equal(attempt.note, 'Revisado pelo dono');
  assert.deepEqual(attempt.diffStat, { files: 2, additions: 2, deletions: 0 });
  assert.deepEqual(attempt.usage, f.runs.get(f.task.id).usage);
  assert.equal(attempt.test.exitCode, 0);
  assert.equal(attempt.test.timedOut, false);
  assert.match(attempt.test.outputTail, /tests passed/);
  assert.equal(attempt.test.outputSha256, sha256(attempt.test.outputTail));
  assert.ok(Number.isInteger(attempt.test.durationMs));
  assert.ok(!Number.isNaN(Date.parse(attempt.at)));
  const stored = JSON.parse(fs.readFileSync(path.join(f.app.store.dataDir, 'evidence', `${f.task.id}.json`), 'utf8'));
  assert.deepEqual(stored, bundle);

  const deadline = Date.now() + 5000;
  while (!/event: state\ndata: [^\n]*"status":"done"/.test(received) && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ done: true }), 1000))]);
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.ok(received.includes(`event: evidence\ndata: ${JSON.stringify({ taskId: f.task.id, projectId: f.project.id })}`), received.slice(-300));
  assert.match(received, /event: state\ndata: [^\n]*"status":"done"/);
  await reader.cancel();

  const again = await f.merge({});
  assert.equal(again.status, 409, 'a merged branch has nothing new to integrate');
});

test('merge refusals leave the root untouched and are recorded as evidence', async t => {
  const f = await fixture(t);
  const head = () => git(f.root, 'rev-parse', 'HEAD');
  const original = head();
  const refused = async (body, pattern) => {
    const response = await f.merge(body);
    const { error } = await response.json();
    assert.equal(response.status, 409, error);
    assert.match(error, pattern);
    assert.equal(f.app.store.task(f.task.id).status, 'open');
    return error;
  };
  write(f.worktree, 'README.md', 'base\nfrom the agent\n');

  await refused({}, /Nenhuma execução/);
  f.setRun({ state: 'working' });
  await refused({}, /em execução/);
  f.setRun();
  git(f.root, 'switch', '-q', '-c', 'elsewhere');
  await refused({}, /não na branch base master/);
  git(f.root, 'switch', '-q', 'master');
  write(f.root, 'README.md', 'owner edit\n');
  await refused({}, /mudanças não commitadas/);
  assert.equal(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), 'owner edit\n');
  write(f.root, 'README.md', 'base\n');
  await refused({ testCommand: 'exit 3' }, /teste falhou \(código 3\)/);
  f.timing.testTimeoutMs = 1500;
  const started = Date.now();
  await refused({ testCommand: sleepCommand }, /tempo limite/);
  assert.ok(Date.now() - started < 15_000);
  f.timing.testTimeoutMs = 60_000;
  assert.equal(head(), original);

  write(f.root, 'README.md', 'base\nfrom the owner\n');
  git(f.root, 'commit', '-q', '-am', 'owner change');
  const ownerHead = head();
  const conflict = await refused({}, /Conflito de merge em 1 arquivo\(s\): README\.md/);
  assert.match(conflict, new RegExp(`voltou a ${ownerHead.slice(0, 7)}`));
  assert.equal(head(), ownerHead);
  assert.equal(mergeHead(f.root), false);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(f.root, 'README.md'), 'utf8'), 'base\nfrom the owner\n');

  const { attempts } = await f.evidence();
  assert.equal(attempts.length, 7);
  assert.ok(attempts.every(attempt => attempt.refused?.reason && attempt.mergeSha === null));
  assert.equal(attempts[0].runId, null);
  assert.equal(attempts[1].runId, 'run-1');
  assert.equal(attempts[4].test.exitCode, 3);
  assert.equal(attempts[5].test.timedOut, true);
  assert.equal(attempts[6].headSha, git(f.root, 'rev-parse', BRANCH));
  assert.equal(git(f.root, 'log', '-1', '--format=%s', BRANCH), `omniforge: ${f.task.title}`);

  const stale = await f.post(`/api/tasks/${f.task.id}/merge`, { expectedRevision: 9 });
  assert.equal(stale.status, 409);
  assert.equal((await f.evidence()).attempts.length, 7, 'a stale window is not a merge attempt');
});

test('merge integrates the tested commit, not a branch tip that moved during the test', async t => {
  const f = await fixture(t);
  f.setRun();
  write(f.worktree, 'hello.txt', 'hi\n');
  // A tracked file the task turns into a folder is not an owner file in the way.
  fs.rmSync(path.join(f.worktree, 'README.md'));
  fs.mkdirSync(path.join(f.worktree, 'README.md'));
  write(f.worktree, 'README.md/part.md', 'part\n');
  f.timing.duringTest = () => {
    write(f.worktree, 'untested.txt', 'late\n');
    git(f.worktree, 'add', 'untested.txt');
    git(f.worktree, 'commit', '-q', '-m', 'late commit');
  };
  const response = await f.merge({ testCommand: 'exit 0' });
  const { attempt, error } = await response.json();
  assert.equal(response.status, 200, error);
  assert.equal(git(f.root, 'rev-parse', 'HEAD^2'), attempt.headSha);
  assert.notEqual(git(f.root, 'rev-parse', BRANCH), attempt.headSha);
  assert.equal(git(f.root, 'log', '-1', '--format=%s'), `Merge branch '${BRANCH}'`);
  assert.equal(fs.existsSync(path.join(f.root, 'untested.txt')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'README.md', 'part.md'), 'utf8'), 'part\n');
});

test('a task changed during the test is refused before the merge; once merged, the task is done whatever follows', async t => {
  const f = await fixture(t);
  f.setRun();
  write(f.worktree, 'hello.txt', 'hi\n');
  const before = git(f.root, 'rev-parse', 'HEAD');
  f.timing.duringTest = () => f.app.store.assignTask(f.task.id, { expectedRevision: f.app.store.task(f.task.id).revision });
  const stale = await f.merge({ testCommand: 'exit 0' });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /alterada em outra janela/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);
  const [refusal] = (await f.evidence()).attempts;
  assert.equal(refusal.test.exitCode, 0);
  assert.equal(refusal.mergeSha, null);

  // An evidence write that fails after the merge must not strand the task open.
  f.timing.duringTest = null;
  fs.writeFileSync(path.join(f.app.store.dataDir, 'evidence', `${f.task.id}.json`), '{');
  assert.equal((await f.merge({})).status, 500);
  assert.notEqual(git(f.root, 'rev-parse', 'HEAD'), before);
  assert.equal(f.app.store.task(f.task.id).status, 'done');
});

test('merge refuses to overwrite or remove untracked or ignored owner files in the root', async t => {
  const f = await fixture(t);
  f.setRun();
  fs.appendFileSync(path.join(f.root, '.git', 'info', 'exclude'), 'cache\n');
  write(f.root, 'ignored.txt', 'OWNER_SECRET=keep-me\n');
  write(f.root, 'cache', 'owner cache\n');
  write(f.worktree, 'ignored.txt', 'EXAMPLE=1\n');
  fs.mkdirSync(path.join(f.worktree, 'cache'));
  write(f.worktree, 'cache/data.txt', 'data\n');
  git(f.worktree, 'add', '-f', 'ignored.txt', 'cache/data.txt');
  // A conflict too: its abort must not take the ignored files with it either.
  write(f.worktree, 'README.md', 'base\nfrom the agent\n');
  write(f.root, 'README.md', 'base\nfrom the owner\n');
  git(f.root, 'commit', '-q', '-am', 'owner change');
  const ownerHead = git(f.root, 'rev-parse', 'HEAD');
  const response = await f.merge({});
  const { error } = await response.json();
  assert.equal(response.status, 409, error);
  assert.match(error, /: cache, ignored\.txt;/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), ownerHead);
  assert.equal(mergeHead(f.root), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'ignored.txt'), 'utf8'), 'OWNER_SECRET=keep-me\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'cache'), 'utf8'), 'owner cache\n');
  assert.equal(f.app.store.task(f.task.id).status, 'open');
});

test('a run on the base branch is refused before anything is committed in the root', async t => {
  const f = await fixture(t);
  f.setRun({ worktree: f.root, branch: 'master' });
  write(f.root, 'owner-draft.txt', 'draft\n');
  const before = git(f.root, 'rev-parse', 'HEAD');
  const response = await f.merge({});
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Registro de execução inválido/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), before);
  assert.equal(git(f.root, 'status', '--porcelain'), '?? owner-draft.txt');
});

test('merge refuses without a configured git identity and never invents one', async t => {
  const f = await fixture(t);
  f.setRun();
  write(f.worktree, 'hello.txt', 'hi\n');
  const empty = path.join(f.dir, 'empty.gitconfig');
  fs.writeFileSync(empty, '');
  // EMAIL is git's auto-detection fallback: without user.useConfigOnly git would build an identity from it.
  const override = { GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1', EMAIL: 'invented@example.invalid' };
  const saved = Object.fromEntries(Object.keys(override).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  git(f.root, 'config', '--unset', 'user.name');
  git(f.root, 'config', '--unset', 'user.email');
  Object.assign(process.env, override);
  const response = await f.merge({});
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /identidade/);
  assert.equal(git(f.root, 'rev-parse', BRANCH), f.baseSha, 'nothing was committed');
});

test('merge refuses task content that carries the Lab token', async t => {
  const f = await fixture(t);
  f.setRun();
  write(f.worktree, 'hook.json', JSON.stringify({ token: TOKEN }));
  const response = await f.merge({});
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /token/);
  assert.equal(git(f.root, 'rev-parse', BRANCH), f.baseSha);
});

test('evidence keeps the last 20 attempts, a 4 KiB output tail and never the token', async t => {
  const f = await fixture(t);
  f.setRun({ state: 'blocked' });
  for (let i = 0; i < 24; i++) assert.equal((await f.merge({ note: `tentativa ${i}` })).status, 409);
  f.setRun();
  write(f.worktree, 'hello.txt', 'hi\n');
  // Invalid UTF-8 inflates to U+FFFD on decoding; the stored tail must still fit in 4 KiB.
  const noisy = 'node -e "process.stdout.write(\'é\'.repeat(3000)); process.stdout.write(Buffer.alloc(3000, 255)); process.exit(1)"';
  assert.equal((await f.merge({ testCommand: noisy, note: `segredo ${TOKEN}` })).status, 409);
  const text = await (await f.get(`/api/tasks/${f.task.id}/evidence`)).text();
  assert.equal(text.includes(TOKEN), false);
  const { attempts } = JSON.parse(text);
  assert.equal(attempts.length, 20);
  assert.equal(attempts[0].note, 'tentativa 5');
  const last = attempts.at(-1);
  assert.equal(last.test.exitCode, 1);
  assert.ok(Buffer.byteLength(last.test.outputTail) <= 4096);
  assert.ok(last.test.outputTail.length > 1000);
  assert.match(last.test.outputSha256, /^[0-9a-f]{64}$/);
});

test('review routes require the master token', async t => {
  const f = await fixture(t);
  f.setRun();
  for (const route of ['diff', 'evidence']) assert.equal((await fetch(`${f.base}/api/tasks/${f.task.id}/${route}`)).status, 403);
  const merge = await fetch(`${f.base}/api/tasks/${f.task.id}/merge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"expectedRevision":1}' });
  assert.equal(merge.status, 403);
  assert.equal(fs.existsSync(path.join(f.app.store.dataDir, 'evidence')), false);
  assert.equal((await f.get('/api/tasks/unknown/evidence')).status, 404);
  assert.deepEqual(await f.evidence(), { taskId: f.task.id, attempts: [] });
});
