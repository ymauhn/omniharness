import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createOmniForgeServer } from '../server.mjs';
import { runTestCommand } from '../review.mjs';
import { gitEnv } from '../lib/git-env.mjs';

// The merge gate against what a task's worktree can do to a shared repository config or history, on real temporary
// repositories (review of 2026-09-26, probes P1-P7): config-defined hooks, core.fsmonitor, a moved base, directory
// renames over an owner's ignored file, and a tracked folder turned into a file.
const TOKEN = 'review-token-5f0c9a1e7b3d';
const BRANCH = 'omniforge/task';
function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
const write = (dir, file, content) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), content); };
const read = (dir, file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : null);

async function fixture(t, prepare = () => {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'omniforge-gate-')));
  const root = path.join(dir, 'root'), worktree = path.join(dir, 'wt');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'master');
  for (const [key, value] of [['user.name', 'Review Tester'], ['user.email', 'review@test.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(root, 'config', key, value);
  write(root, 'README.md', 'base\n');
  write(root, '.gitignore', 'ignored.txt\n');
  prepare(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'worktree', 'add', '-q', '-b', BRANCH, worktree, baseSha);
  const runs = new Map();
  const app = createOmniForgeServer({ dataDir: path.join(dir, 'data'), token: TOKEN, getRun: (id, kind) => (kind ? null : runs.get(id) ?? null), engineOptions: { hosts: {} },
    runTest: options => runTestCommand({ ...options, timeoutMs: 60_000 }) });
  const origin = new URL(await app.listen()).origin;
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
  const project = app.store.addProject({ name: 'Gate', root });
  const task = app.store.addTask({ projectId: project.id, title: 'x' });
  runs.set(task.id, { id: 'run-1', taskId: task.id, projectId: project.id, host: 'claude', sessionId: null, hostSessionId: null, root, worktree, branch: BRANCH,
    baseBranch: 'master', baseSha, state: 'done', detail: '', startedAt: '2026-09-26T00:00:00.000Z', endedAt: '2026-09-26T00:01:00.000Z', exitCode: 0, usage: null });
  const headers = { 'x-omniforge-token': TOKEN, 'content-type': 'application/json' };
  // Reviews the current diff, then asks for the merge of exactly that tree.
  const merge = async () => {
    const { tree } = await (await fetch(`${origin}/api/tasks/${task.id}/diff`, { headers })).json();
    const response = await fetch(`${origin}/api/tasks/${task.id}/merge`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: app.store.task(task.id).revision, reviewedTree: tree }) });
    return { status: response.status, body: await response.json() };
  };
  return { dir, root, worktree, merge };
}

test('a config-defined hook (hook.<name>.command) refuses the merge before anything is committed or merged', async t => {
  const f = await fixture(t);
  // Written from the worktree into the shared .git/config, as an agent could.
  git(f.worktree, 'config', 'hook.inject.event', 'post-merge');
  git(f.worktree, 'config', 'hook.inject.command', 'echo injected > injected.txt');
  write(f.worktree, 'README.md', 'base\nreviewed\n');
  const head = git(f.root, 'rev-parse', 'HEAD');
  const { status, body } = await f.merge();
  assert.equal(status, 409);
  assert.match(body.error, /hook\.inject/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  assert.equal(read(f.root, 'injected.txt'), null);
  assert.equal(git(f.worktree, 'rev-list', '--count', `${head}..HEAD`), '0', 'nothing was committed on the task branch');
});

test('core.fsmonitor from the shared config never runs in the Lab\'s git calls', async t => {
  const f = await fixture(t);
  const log = path.join(f.dir, 'fsmonitor.log');
  const script = path.join(f.dir, 'fsmonitor.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho ran >> "${log.replaceAll('\\', '/')}"\nexit 1\n`, { mode: 0o755 });
  git(f.worktree, 'config', 'core.fsmonitor', script.replaceAll('\\', '/'));
  write(f.worktree, 'README.md', 'base\nreviewed\n');
  const { status } = await f.merge();
  assert.equal(status, 200);
  assert.equal(fs.existsSync(log), false);
});

test('a task branch that no longer starts from the reviewed base is refused, and the owner\'s later work stays', async t => {
  const f = await fixture(t);
  write(f.root, 'owner.txt', 'owner work after the base\n');
  git(f.root, 'add', 'owner.txt');
  git(f.root, 'commit', '-q', '-m', 'owner work');
  write(f.worktree, 'README.md', 'base\nreviewed\n');
  // The reviewed diff still reads "M README.md", but a merge from the root's HEAD would drop owner.txt.
  git(f.worktree, 'reset', '--soft', 'master');
  const { status, body } = await f.merge();
  assert.equal(status, 409);
  assert.match(body.error, /não parte mais da base/);
  assert.equal(read(f.root, 'owner.txt'), 'owner work after the base\n');
});

test('directory renames never move a task file over an owner\'s ignored file', async t => {
  const cases = {
    'the root renamed the folder': async (f, directoryRenames) => {
      if (directoryRenames) git(f.root, 'config', 'merge.directoryRenames', 'true');
      git(f.root, 'mv', 'src', 'lib');
      git(f.root, 'commit', '-q', '-m', 'rename src to lib');
      fs.appendFileSync(path.join(f.root, '.gitignore'), 'lib/new.txt\n');
      git(f.root, 'commit', '-q', '-am', 'ignore lib/new.txt');
      write(f.root, 'lib/new.txt', 'OWNER_SECRET\n');
      write(f.worktree, 'src/new.txt', 'agent\n');
      return 'lib/new.txt';
    },
    'the task renamed the folder': async f => {
      write(f.root, 'src/extra.txt', 'extra\n');
      fs.appendFileSync(path.join(f.root, '.gitignore'), 'lib/extra.txt\n');
      git(f.root, 'add', '-A');
      git(f.root, 'commit', '-q', '-m', 'root adds src/extra.txt');
      write(f.root, 'lib/extra.txt', 'OWNER_SECRET\n');
      git(f.worktree, 'mv', 'src', 'lib');
      return 'lib/extra.txt';
    },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    for (const directoryRenames of [false, true]) {
      const f = await fixture(t, root => write(root, 'src/a.txt', 'a\n'));
      const owned = await arrange(f, directoryRenames);
      const { status, body } = await f.merge();
      assert.equal(read(f.root, owned), 'OWNER_SECRET\n', `${name} (owner merge.directoryRenames=${directoryRenames}): ${status} ${body.error ?? ''}`);
      if (status !== 200) assert.doesNotMatch(body.error, /voltou a [0-9a-f]{7} sem merge pendente/, 'a refusal never claims a restore it did not check');
    }
  }
});

test('a task that turns a tracked folder into a file merges; nothing untracked is in its way', async t => {
  const f = await fixture(t, root => write(root, 'd/f.txt', 'f\n'));
  git(f.worktree, 'rm', '-q', '-r', 'd');
  write(f.worktree, 'd', 'now a file\n');
  const { status, body } = await f.merge();
  assert.equal(status, 200, body.error);
  assert.equal(read(f.root, 'd'), 'now a file\n');
});
