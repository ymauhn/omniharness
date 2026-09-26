import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { WorkspaceStore } from '../core.mjs';
import { PtyCoordinator, resolvePtyShell } from '../pty.mjs';

// Canonical, as the store keeps project roots: TEMP may be an 8.3 or junction spelling of this folder.
const TMP = fs.realpathSync.native(os.tmpdir());

function fixture(t) {
  const root = fs.mkdtempSync(path.join(TMP, 'omniforge-pty-test-'));
  const store = new WorkspaceStore(path.join(root, 'data'));
  t.after(() => {
    store.close();
    const relative = path.relative(TMP, root);
    if (relative.startsWith('omniforge-pty-test-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true });
  });
  const projectRoot = path.join(root, 'projeto-café');
  fs.mkdirSync(projectRoot);
  const project = store.addProject({ name: 'Café', root: projectRoot });
  const session = store.addSession({ projectId: project.id, name: 'Terminal' });
  return { root, store, projectRoot, project, session };
}

async function running(store, ...ids) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !ids.every(id => store.session(id).status === 'running')) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(ids.map(id => store.session(id).status), ids.map(() => 'running'));
}

function fakePty() {
  const calls = { writes: [], sizes: [], killed: 0 };
  const child = {
    pid: 12345,
    onData(listener) { this.data = listener; return { dispose() {} }; },
    onExit(listener) { this.exit = listener; return { dispose() {} }; },
    write(value) { calls.writes.push(value); },
    resize(cols, rows) { calls.sizes.push([cols, rows]); },
    kill() { calls.killed++; queueMicrotask(() => this.exit({ exitCode: 7, signal: undefined })); },
  };
  return { child, calls };
}

test('shell resolution uses an existing absolute executable and fails closed', t => {
  const { root, store, session } = fixture(t);
  assert.equal(resolvePtyShell(process.execPath), fs.realpathSync.native(process.execPath));
  const coordinator = new PtyCoordinator(store, { env: { PATH: path.join(root, 'missing') } });
  assert.throws(() => coordinator.start(session.id), /Shell local indisponível/);
  // Nothing was spawned, so the session is not uncertain and does not block the project.
  assert.equal(store.session(session.id).status, 'stopped');
  assert.equal(coordinator.processes.size, 0);
  assert.throws(() => coordinator.start(session.id), /não está pronta/);
  assert.equal(store.addSession({ projectId: store.session(session.id).projectId, name: 'Depois de instalar o shell' }).status, 'starting');
});

test('Windows default shell prefers PowerShell 7 and falls back to the built-in Windows PowerShell', t => {
  if (process.platform !== 'win32') return;
  const { root } = fixture(t);
  const [builtIn, seven, empty] = ['v1.0', 'seven', 'empty'].map(name => { const dir = path.join(root, name); fs.mkdirSync(dir); return dir; });
  fs.writeFileSync(path.join(builtIn, 'powershell.exe'), '');
  fs.writeFileSync(path.join(seven, 'pwsh.exe'), '');
  const resolve = (...dirs) => resolvePtyShell(undefined, { Path: dirs.join(path.delimiter) });
  assert.equal(resolve(builtIn), fs.realpathSync.native(path.join(builtIn, 'powershell.exe')));
  assert.equal(resolve(builtIn, seven), fs.realpathSync.native(path.join(seven, 'pwsh.exe')));
  assert.throws(() => resolve(empty), /Shell local indisponível/);
});

test('adapter preserves input and Unicode output, bounds chunks, and reports the observed exit', async t => {
  const { store, session, projectRoot } = fixture(t);
  const { child, calls } = fakePty();
  let spawned;
  let confirmKill;
  const killPids = [];
  const coordinator = new PtyCoordinator(store, {
    shell: process.execPath,
    spawnPty: (shell, args, options) => { spawned = { shell, args, options }; return child; },
    killTree: pid => { killPids.push(pid); return new Promise(resolve => { confirmKill = resolve; }); },
  });
  const terminal = [];
  const states = [];
  coordinator.on('terminal', event => terminal.push(event));
  coordinator.on('state', event => states.push(event));
  assert.equal(coordinator.start(session.id).id, session.id);
  assert.equal(spawned.shell, fs.realpathSync.native(process.execPath));
  if (process.platform === 'win32') assert.deepEqual(spawned.args, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'Set-PSReadLineOption -HistorySaveStyle SaveNothing']);
  assert.equal(spawned.options.cwd, projectRoot);
  assert.equal(spawned.options.env.OMNIFORGE_SESSION_ID, session.id);
  assert.equal(store.session(session.id).status, 'running');
  assert.equal(coordinator.command(session.id, '  echo café  ').accepted, true);
  assert.deepEqual(calls.writes, ['echo café\r']);
  assert.throws(() => coordinator.command(session.id, 'echo first\necho second'), /Comando inválido/);
  assert.equal(coordinator.write(session.id, 'olá\r').accepted, true);
  assert.deepEqual(calls.writes, ['echo café\r', 'olá\r']);
  assert.deepEqual(coordinator.resize(session.id, 120, 40), { sessionId: session.id, cols: 120, rows: 40 });
  assert.deepEqual(calls.sizes, [[120, 40]]);
  assert.throws(() => coordinator.resize(session.id, 0, 40), /Tamanho/);
  const output = '😀'.repeat(5000);
  child.data(output);
  assert.equal(terminal.map(event => event.text).join(''), output);
  assert.ok(terminal.every(event => event.stream === 'stdout' && event.text.length <= 8192 && event.at));
  const closed = once(coordinator, 'closed');
  assert.deepEqual(coordinator.stop(session.id), { sessionId: session.id, stopping: true });
  assert.equal(store.session(session.id).status, 'stopping');
  assert.deepEqual(states.at(-1), { sessionId: session.id, status: 'stopping' });
  assert.throws(() => coordinator.command(session.id, 'echo too late'), /não está ativa/);
  child.exit({ exitCode: 7, signal: undefined });
  await Promise.resolve();
  assert.equal(store.session(session.id).status, 'stopping');
  assert.deepEqual(killPids, [12345]);
  confirmKill(true);
  assert.deepEqual((await closed)[0], { sessionId: session.id, code: 7, signal: null, stopRequested: true });
  assert.equal(store.session(session.id).status, 'stopped');
  assert.equal(coordinator.processes.size, 0);
  await coordinator.closeAll();
  assert.equal(calls.killed, process.platform === 'win32' ? 1 : 0);
});

test('a PID reported after ConPTY connects commits the session; a launch without PID fails closed', async t => {
  const { store, session, project } = fixture(t);
  const late = fakePty();
  late.child.pid = undefined;
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => late.child, killTree: async () => true, launchTimeoutMs: 200 });
  const running = new Promise(resolve => coordinator.on('state', event => { if (event.status === 'running') resolve(event); }));
  coordinator.start(session.id);
  assert.equal(store.session(session.id).status, 'starting');
  assert.throws(() => coordinator.command(session.id, 'echo cedo'), /não está ativa/);
  late.child.pid = 4242;
  assert.deepEqual(await running, { sessionId: session.id, status: 'running' });
  assert.equal(store.session(session.id).pid, 4242);
  assert.equal(coordinator.command(session.id, 'echo pronto').accepted, true);
  const closing = coordinator.closeAll();
  late.child.exit({ exitCode: 0 });
  await closing;

  // Off Windows disposePty never calls kill(), so the fake PTY would never exit and `closed` never fire.
  if (process.platform !== 'win32') return;
  const silent = fakePty();
  silent.child.pid = undefined;
  const second = store.addSession({ projectId: project.id, name: 'Sem PID' });
  const other = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => silent.child, killTree: async () => { throw new Error('no PID to kill'); }, launchTimeoutMs: 30 });
  const closed = once(other, 'closed');
  other.start(second.id);
  await closed;
  assert.equal(store.session(second.id).status, 'interrupted');
  assert.equal(silent.calls.killed, 1);
  assert.equal(other.processes.size, 0);
});

test('disposal after exit never lets node-pty kill by a shell PID that Windows may have reused', async t => {
  const { store, session, project } = fixture(t);
  const exited = fakePty();
  exited.child._agent = { _innerPid: 12345 };
  const seen = [];
  const kill = exited.child.kill;
  exited.child.kill = function () { seen.push(this._agent._innerPid); return kill.call(this); };
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => exited.child, killTree: async () => true });
  coordinator.start(session.id);
  const closed = once(coordinator, 'closed');
  coordinator.stop(session.id);
  exited.child.exit({ exitCode: 0 });
  await closed;
  assert.deepEqual(seen, process.platform === 'win32' ? [0] : []);

  const hung = fakePty();
  hung.child._agent = { _innerPid: 777 };
  const hungSeen = [];
  hung.child.kill = function () { hungSeen.push(this._agent._innerPid); };
  const second = store.addSession({ projectId: project.id, name: 'Travado' });
  const other = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => hung.child, killTree: async () => true, terminationTimeoutMs: 20 });
  other.start(second.id);
  other.stop(second.id);
  await new Promise(resolve => setTimeout(resolve, 60));
  // Before exit the PID still names the live shell, so node-pty may enumerate its console.
  assert.deepEqual(hungSeen, process.platform === 'win32' ? [777] : []);
  hung.child.exit({ exitCode: 1 });
});

test('restart cannot attach a new PTY to an interrupted session', t => {
  const { root, store, session } = fixture(t);
  store.setSessionStatus(session.id, 'running', 12345);
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  try {
    assert.equal(restored.session(session.id).status, 'interrupted');
    const coordinator = new PtyCoordinator(restored, { shell: process.execPath, spawnPty: () => { throw new Error('spawn must not run'); } });
    assert.throws(() => coordinator.start(session.id), /não está pronta/);
  } finally {
    restored.close();
  }
});

test('restart treats an unfinished stop as interrupted', t => {
  const { root, store, session } = fixture(t);
  store.setSessionStatus(session.id, 'stopping', 12345);
  store.close();
  const restored = new WorkspaceStore(path.join(root, 'data'));
  try {
    assert.equal(restored.session(session.id).status, 'interrupted');
    assert.throws(() => restored.addSession({ projectId: session.projectId, name: 'Unsafe retry' }), /sessão incerta/);
  } finally {
    restored.close();
  }
});

test('failed tree termination stays interrupted even when PTY exit is observed', async t => {
  const { store, session } = fixture(t);
  const { child } = fakePty();
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => child, killTree: async pid => { assert.equal(pid, child.pid); return false; } });
  let closed = null;
  coordinator.on('closed', event => { closed = event; });
  coordinator.start(session.id);
  const closing = coordinator.closeAll();
  await coordinator.records.get(session.id).killPromise;
  assert.equal(store.session(session.id).status, 'interrupted');
  assert.throws(() => coordinator.write(session.id, 'x'), /encerrado|não está ativa/);
  assert.equal(closed, null);
  child.exit({ exitCode: 1 });
  await assert.rejects(closing, /não confirmado/);
  // The Lab asked for this exit: an unconfirmed stop is still no exit code of the agent's own.
  assert.deepEqual(closed, { sessionId: session.id, code: 1, signal: null, stopRequested: true });
  assert.equal(store.session(session.id).status, 'interrupted');
});

test('closeAll waits for both a successful exact-PID tree request and PTY exit', async t => {
  const { store, session } = fixture(t);
  const { child } = fakePty();
  const pids = [];
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => child, killTree: async pid => { pids.push(pid); return true; } });
  coordinator.start(session.id);
  const closing = coordinator.closeAll();
  await coordinator.records.get(session.id).killPromise;
  assert.deepEqual(pids, [child.pid]);
  assert.equal(store.session(session.id).status, 'stopping');
  child.exit({ exitCode: 0 });
  await closing;
  assert.equal(store.session(session.id).status, 'stopped');
});

test('a successful tree request without PTY exit times out as interrupted', async t => {
  const { store, session } = fixture(t);
  const { child } = fakePty();
  child.kill = () => { /* no onExit confirmation from the native PTY */ };
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => child, killTree: async () => true, terminationTimeoutMs: 25 });
  coordinator.start(session.id);
  let closed = false;
  coordinator.on('closed', () => { closed = true; });
  await assert.rejects(coordinator.closeAll(), /não confirmado/);
  assert.equal(store.session(session.id).status, 'interrupted');
  assert.equal(closed, false);
  child.exit({ exitCode: 0 });
  assert.equal(store.session(session.id).status, 'interrupted');
});

test('failed running-status persistence retains the PTY until exit and blocks replacement', async t => {
  const { store, session, project } = fixture(t);
  const { child } = fakePty();
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => child, killTree: async () => true });
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (target === store.file) throw new Error('disk write failed');
      return rename(source, target);
    };
    assert.throws(() => coordinator.start(session.id), /disk write failed/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(store.session(session.id).status, 'interrupted');
  assert.throws(() => store.addSession({ projectId: project.id, name: 'Unsafe retry' }), /sessão incerta/);
  assert.equal(coordinator.processes.has(session.id), true);
  const closing = coordinator.closeAll();
  child.exit({ exitCode: 0 });
  await assert.rejects(closing, /não confirmado/);
  assert.equal(coordinator.processes.size, 0);
});

test('failed final-status persistence flags the attempt as uncertain', async t => {
  const { store, session, project } = fixture(t);
  const { child } = fakePty();
  const coordinator = new PtyCoordinator(store, { shell: process.execPath, spawnPty: () => child, killTree: async () => true });
  coordinator.start(session.id);
  const closing = coordinator.closeAll();
  await coordinator.records.get(session.id).killPromise;
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (target === store.file) throw new Error('disk write failed');
      return rename(source, target);
    };
    child.exit({ exitCode: 0 });
  } finally {
    fs.renameSync = rename;
  }
  await assert.rejects(closing, /disk write failed/);
  assert.equal(store.session(session.id).status, 'interrupted');
  assert.throws(() => store.addSession({ projectId: project.id, name: 'Unsafe retry' }), /sessão incerta/);
});

test('two real PTYs keep their project directories and Unicode output separate', async t => {
  const { root, store, projectRoot, project, session } = fixture(t);
  const otherRoot = path.join(root, 'segundo-projeto');
  fs.mkdirSync(otherRoot);
  const other = store.addProject({ name: 'Segundo', root: otherRoot });
  const second = store.addSession({ projectId: other.id, name: 'Outra' });
  const coordinator = new PtyCoordinator(store);
  const output = new Map([[session.id, ''], [second.id, '']]);
  coordinator.on('terminal', event => output.set(event.sessionId, output.get(event.sessionId) + event.text));
  try {
    coordinator.start(session.id);
    coordinator.start(second.id);
    await running(store, session.id, second.id);
    // The PID-reuse guard in disposePty depends on this private node-pty field; fail loudly if it moves.
    if (process.platform === 'win32') assert.equal(coordinator.processes.get(session.id)._agent._innerPid, store.session(session.id).pid);
    const command = process.platform === 'win32' ? "Write-Output ('MARCADOR café ' + $PWD.Path)" : "printf 'MARCADOR café %s\\n' \"$PWD\"";
    coordinator.command(session.id, command);
    coordinator.command(second.id, command);
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && (!output.get(session.id).includes(`MARCADOR café ${projectRoot}`) || !output.get(second.id).includes(`MARCADOR café ${otherRoot}`))) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(output.get(session.id).includes(`MARCADOR café ${projectRoot}`), output.get(session.id));
    assert.ok(output.get(second.id).includes(`MARCADOR café ${otherRoot}`), output.get(second.id));
    assert.ok(!output.get(session.id).includes(otherRoot));
    assert.ok(!output.get(second.id).includes(projectRoot));
    assert.equal(store.session(session.id).projectId, project.id);
  } finally {
    for (const id of coordinator.processes.keys()) {
      try { coordinator.command(id, 'exit'); } catch { /* an exit may already be pending */ }
    }
    const deadline = Date.now() + 5000;
    while (coordinator.processes.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (coordinator.processes.size) await coordinator.closeAll();
  }
  assert.equal(store.session(session.id).status, 'interrupted');
  assert.equal(store.session(second.id).status, 'interrupted');
});

// Manual Windows canary: run in a local shell allowed to inspect processes with
// OMNIFORGE_PTY_DESCENDANT_CANARY=1 node --test --test-name-pattern='descendant canary' test/pty.test.mjs
// This stays opt-in because Get-CimInstance is denied by some test sandboxes.
if (process.platform === 'win32' && process.env.OMNIFORGE_PTY_DESCENDANT_CANARY === '1') {
  test('descendant canary requires the exact child to exit before reporting stopped', async t => {
    const { root, store, session } = fixture(t);
    const shell = resolvePtyShell();
    const coordinator = new PtyCoordinator(store);
    const token = `OMNI_PTY_CHILD_${randomUUID().replaceAll('-', '')}`;
    const pidFile = path.join(root, 'child-pid.txt');
    let output = '';
    let childPid;
    let shellPid;
    let exitTimer;
    const inspect = pid => {
      const query = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress }`;
      const result = execFileSync(shell, ['-NoLogo', '-NoProfile', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 7000 }).trim();
      return result ? JSON.parse(result) : null;
    };
    coordinator.on('terminal', event => { if (event.sessionId === session.id) output += event.text; });
    try {
      coordinator.start(session.id);
      await running(store, session.id);
      shellPid = coordinator.processes.get(session.id).pid;
      const childCommand = `Start-Sleep -Seconds 120; # ${token}`;
      const startCommand = `$p = Start-Process -FilePath '${shell.replaceAll("'", "''")}' -ArgumentList '-NoLogo -NoProfile -Command "${childCommand}"' -PassThru; Set-Content -LiteralPath '${pidFile.replaceAll("'", "''")}' -Value $p.Id; Write-Output ('OMNI_CHILD_PID=' + $p.Id)`;
      coordinator.command(session.id, startCommand);
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && !childPid) {
        const match = output.match(/OMNI_CHILD_PID=(\d+)/);
        if (match) childPid = Number(match[1]);
        else await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(childPid, output.slice(-2000));
      const before = inspect(childPid);
      assert.equal(before?.ParentProcessId, shellPid);
      assert.equal(before?.ExecutablePath?.toLowerCase(), shell.toLowerCase());
      assert.ok(before?.CommandLine?.includes(token));
      const closed = new Promise((resolve, reject) => {
        coordinator.once('closed', resolve);
        exitTimer = setTimeout(() => reject(new Error('PTY onExit timeout')), 12000);
      });
      assert.deepEqual(coordinator.stop(session.id), { sessionId: session.id, stopping: true });
      await closed;
      assert.equal(store.session(session.id).status, 'stopped');
      assert.equal(inspect(childPid), null);
    } finally {
      clearTimeout(exitTimer);
      if (!childPid && fs.existsSync(pidFile)) childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (coordinator.processes.size) {
        try { await coordinator.closeAll(); } catch { /* preserve the original test failure */ }
      }
      if (Number.isSafeInteger(childPid) && childPid > 0) {
        const survivor = inspect(childPid);
        if (survivor?.ProcessId === childPid && survivor.ParentProcessId === shellPid && survivor.ExecutablePath?.toLowerCase() === shell.toLowerCase() && survivor.CommandLine?.includes(token)) {
          execFileSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(childPid), '/F'], { windowsHide: true, timeout: 7000 });
        }
      }
    }
  });
}
