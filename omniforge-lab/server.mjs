import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkspaceStore, inventoryAssets, listSkills } from './core.mjs';
import { PtyCoordinator } from './pty.mjs';
import { AgentEngine, findExecutable } from './engine.mjs';
import { CatalogService } from './catalog-service.mjs';
import { ClassifierService } from './classifier-service.mjs';
import { classifyPrompt, classifierError } from './copilot-classification.mjs';
import { TerminalOutputBuffer } from './terminal-output.mjs';
import { createWorkflowService } from './workflows.mjs';
import { ArsenalService } from './arsenal-service.mjs';
import { createArsenalApi } from './arsenal-http.mjs';
import { ExtensionService } from './extensions.mjs';
import { KeyVault } from './key-vault.mjs';
import { readCodexRateLimits, usageFigures } from './usage.mjs';
import { createReview } from './review.mjs';

// Windows otherwise resolves a bare program name (python, powershell.exe, taskkill.exe) in the current folder
// first, so a file planted where the Lab was launched could run in its place.
if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const MAX_BODY = 32 * 1024;
const MAX_SSE_BACKLOG = 1024 * 1024;

function send(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function body(request, limit = MAX_BODY) {
  const chunks = [];
  let bytes = 0;
  for await (const part of request) {
    bytes += part.length;
    if (bytes > limit) {
      const error = new Error('Corpo da requisição muito grande');
      error.status = 413;
      throw error;
    }
    chunks.push(part);
  }
  let value;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { const error = new Error('Texto UTF-8 inválido'); error.status = 400; throw error; }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  }
  catch { const error = new Error('JSON inválido'); error.status = 400; throw error; }
}

// The installed Codex CLI (quota read and agent runs): PATH first, then the Codex app's own copy.
const findCodex = () => findExecutable('codex', process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.codex', '.sandbox-bin'));

// `engineOptions` is a test seam (fake agent hosts, home folder for usage files); production passes none.
export function createOmniForgeServer({ dataDir = path.join(REPO_ROOT, '.omniforge-lab'), repoRoot = REPO_ROOT, token = randomBytes(24).toString('hex'), catalog = new CatalogService({ repoRoot, dataDir }), classifier = new ClassifierService({ repoRoot }), arsenalService = null, observeArsenalHosts, keyVault = null, readQuota = readCodexRateLimits, codexPath = findCodex(), engineOptions = {}, getRun, runTest } = {}) {
  const expectedToken = Buffer.from(token);
  const sameToken = value => {
    if (typeof value !== 'string') return false;
    const presented = Buffer.from(value);
    return presented.length === expectedToken.length && timingSafeEqual(presented, expectedToken);
  };
  const store = new WorkspaceStore(dataDir);
  const shells = new PtyCoordinator(store);
  let workflows, engine;
  try {
    workflows = createWorkflowService({ store });
    engine = new AgentEngine({ store, shells, codexPath, hookUrl: () => `http://127.0.0.1:${server.address().port}/api/agent-events`, ...engineOptions });
  } catch (error) { store.close(); throw error; }
  const terminalOutput = new TerminalOutputBuffer();
  const arsenal = arsenalService || new ArsenalService({ dataDir: store.dataDir, repoRoot: path.resolve(repoRoot) });
  const arsenalApi = createArsenalApi({ store, service: arsenal, observeHosts: observeArsenalHosts });
  const extensions = new ExtensionService({ dataDir: store.dataDir });
  const keys = keyVault || new KeyVault({ dataDir: store.dataDir });
  let codexQuota = null;
  const clients = new Set();
  const skills = listSkills(repoRoot);
  const state = () => {
    const { schema, projects, sessions, tasks, memoryRevision, layout, workflowRegistry } = store.data;
    // Do not clone private note/workflow history for every public state event.
    // Task details (up to 4,000 characters each) load on demand, so state events stay small for every window.
    const snapshot = structuredClone({ schema, projects, sessions, tasks: tasks.map(({ details, ...task }) => ({ ...task, hasDetails: Boolean(details) })), memoryRevision, layout });
    snapshot.workflowRevision = (workflowRegistry?.workflows ?? []).reduce((sum, row) => sum + row.revision, 0) + (workflowRegistry?.runs?.length ?? 0);
    return { ...snapshot, skills };
  };
  const broadcast = (name, data) => {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(message);
      // write() returns false for any same-tick burst over 16 KiB; drop only a client that is really stuck.
      // It reconnects and recovers missed terminal output by replay cursor.
      if (client.writableLength > MAX_SSE_BACKLOG) {
        clients.delete(client);
        client.end();
      }
    }
  };
  // getRun(taskId) is the engine's latest run record for the task, or null.
  const review = createReview({ store, getRun: getRun ?? (taskId => engine.runForTask(taskId)), runTest, token, onEvidence: event => broadcast('evidence', event) });
  shells.on('terminal', event => {
    const { projectId } = store.session(event.sessionId);
    // Replay and SSE share exact frames; slow consumers reconnect by cursor.
    for (const frame of terminalOutput.append({ ...event, projectId })) broadcast('terminal', frame);
  });
  shells.on('closed', () => broadcast('state', state()));
  shells.on('state', () => broadcast('state', state()));
  engine.on('agent', event => broadcast('agent', event));

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    // DNS rebinding: only the exact loopback address this server printed is accepted.
    if (request.headers.host !== `127.0.0.1:${server.address()?.port}`) return send(response, 403, { error: 'Endereço local inválido' });
    try {
      // The page and its modules hold no secret. No cookie: browsers send cookies to every port on
      // 127.0.0.1, so the page keeps the launch token in port-scoped storage and sends it as a header.
      if (request.method === 'GET' && url.pathname === '/') {
        const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
        return send(response, 200, html, 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && url.pathname === '/pane-scope.mjs') {
        return send(response, 200, fs.readFileSync(path.join(HERE, 'pane-scope.mjs'), 'utf8'), 'text/javascript; charset=utf-8');
      }
      if (request.method === 'GET' && ['/copilot.mjs', '/copilot.css', '/copilot-provider.mjs', '/memory-panel.mjs', '/memory-panel.css', '/workflow-panel.mjs', '/workflow-panel.css', '/terminal-grid.mjs', '/terminal-grid.css', '/arsenal-panel.mjs', '/arsenal-panel.css', '/extensions-panel.mjs', '/usage-panel.mjs'].includes(url.pathname)) {
        return send(response, 200, fs.readFileSync(path.join(HERE, url.pathname.slice(1)), 'utf8'), url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      }
      // The page's ES modules under app/: no secret inside, so no auth, same as the panel modules above.
      // The name is constrained to [a-z0-9-]+.mjs and resolved only inside app/, so it cannot escape it.
      const appModule = /^\/app\/([a-z0-9-]+\.mjs)$/.exec(url.pathname);
      if (request.method === 'GET' && appModule) {
        return send(response, 200, fs.readFileSync(path.join(HERE, 'app', appModule[1]), 'utf8'), 'text/javascript; charset=utf-8');
      }
      const vendorFiles = {
        '/vendor/xterm.mjs': ['@xterm/xterm/lib/xterm.mjs', 'text/javascript; charset=utf-8'],
        '/vendor/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
        '/vendor/addon-fit.mjs': ['@xterm/addon-fit/lib/addon-fit.mjs', 'text/javascript; charset=utf-8'],
      };
      if (request.method === 'GET' && Object.hasOwn(vendorFiles, url.pathname)) {
        const [file, type] = vendorFiles[url.pathname];
        return send(response, 200, fs.readFileSync(path.join(HERE, 'node_modules', file), 'utf8'), type);
      }
      // Agent hooks hold only their own run's secret, never the launch token; this is the one route that takes it.
      if (request.method === 'POST' && url.pathname === '/api/agent-events') {
        return send(response, 200, engine.event(await body(request, 16 * 1024), request.headers['x-omniforge-run-token']));
      }
      // EventSource cannot send headers, so only the event stream accepts the token in its URL.
      const presented = request.headers['x-omniforge-token'] ?? (request.method === 'GET' && url.pathname === '/api/events' ? url.searchParams.get('token') : null);
      if (!sameToken(presented)) return send(response, 403, { error: 'Token local inválido' });
      if (request.method === 'POST' && request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        return send(response, 403, { error: 'Origem local inválida' });
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, state());
      const taskDetails = url.pathname.match(/^\/api\/tasks\/([^/]+)\/details$/);
      if (request.method === 'GET' && taskDetails) {
        const task = store.task(taskDetails[1]);
        return send(response, 200, { id: task.id, details: task.details ?? null });
      }
      if (request.method === 'GET') {
        const result = await review({ method: request.method, url });
        if (result) return send(response, result.status, result.body);
      }
      if (request.method === 'GET') {
        const result = await arsenalApi({ method: request.method, url });
        if (result) return send(response, result.status, result.body);
      }
      if (request.method === 'GET') {
        const result = workflows.handle({ method: request.method, url });
        if (result) return send(response, result.status, result.body);
      }
      const outputRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/output$/);
      if (request.method === 'GET' && outputRoute) {
        const projectId = url.searchParams.get('projectId');
        const cursor = url.searchParams.get('after') ?? '0';
        if (!projectId || !/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) return send(response, 400, { error: 'Escopo ou cursor de saída inválido' });
        const session = store.session(outputRoute[1]);
        if (session.projectId !== projectId) return send(response, 404, { error: 'Sessão não encontrada neste projeto' });
        return send(response, 200, terminalOutput.read(session.id, projectId, Number(cursor)));
      }
      if (request.method === 'GET' && url.pathname === '/api/copilot/status') return send(response, 200, classifier.status());
      if (request.method === 'GET' && url.pathname === '/api/skills') {
        const q = url.searchParams.get('q') ?? '';
        const host = url.searchParams.get('host');
        const ring = url.searchParams.get('ring') ?? 'installed';
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (q.length > 4096 || host?.length > 120 || !['all', 'installed', 'catalog', 'remote', 'missing', 'unknown'].includes(ring) || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 6000) return send(response, 400, { error: 'Consulta de catálogo inválida' });
        return send(response, 200, await catalog.request({ op: 'list', q, host, ring, limit, offset }));
      }
      const skillDetail = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (request.method === 'GET' && skillDetail) {
        let skillId;
        try { skillId = decodeURIComponent(skillDetail[1]); }
        catch { return send(response, 400, { error: 'Identidade de skill inválida' }); }
        if (skillId.length > 160) return send(response, 400, { error: 'Identidade de skill inválida' });
        const result = await catalog.request({ op: 'get', skill_id: skillId });
        return result.row ? send(response, 200, result) : send(response, 404, { error: 'Skill não encontrada' });
      }
      if (request.method === 'GET' && url.pathname === '/api/memory') {
        const projectId = url.searchParams.get('projectId');
        const sessionId = url.searchParams.get('sessionId');
        const notes = store.notesFor({ projectId, sessionId, includeArchived: url.searchParams.get('includeArchived') === 'true' });
        return send(response, 200, { projectId, sessionId, notes, memoryRevision: store.data.memoryRevision });
      }
      const memoryHistory = url.pathname.match(/^\/api\/memory\/([^/]+)\/history$/);
      if (request.method === 'GET' && memoryHistory) return send(response, 200, store.noteHistoryPage(memoryHistory[1], {
        scope: url.searchParams.get('scope'), projectId: url.searchParams.get('projectId'), sessionId: url.searchParams.get('sessionId'),
      }, { offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 20) }));
      if (request.method === 'GET' && url.pathname === '/api/context') return send(response, 200, store.contextBriefFor(url.searchParams.get('sessionId'), 4000, url.searchParams.get('projectId') ?? undefined));
      if (request.method === 'GET' && url.pathname === '/api/inventory') {
        const project = store.project(url.searchParams.get('projectId'));
        return send(response, 200, { projectId: project.id, ...await inventoryAssets(project.root) });
      }
      if (request.method === 'GET' && url.pathname === '/api/extensions') {
        const project = store.project(url.searchParams.get('projectId'));
        return send(response, 200, { projectId: project.id, ...extensions.list(project.id) });
      }
      if (request.method === 'GET' && url.pathname === '/api/extensions/source') {
        const project = store.project(url.searchParams.get('projectId'));
        const row = extensions.version(extensions.list(project.id), Number(url.searchParams.get('version')));
        return send(response, 200, { version: row.version, sha256: row.sha256, manifest: row.manifest, source: fs.readFileSync(row.path, 'utf8').slice(0, 64 * 1024) });
      }
      if (request.method === 'GET' && url.pathname === '/api/agents') return send(response, 200, { runs: engine.list(url.searchParams.get('projectId')) });
      if (request.method === 'GET' && url.pathname === '/api/keys') return send(response, 200, { keys: keys.list() });
      if (request.method === 'GET' && url.pathname === '/api/usage') return send(response, 200, { figures: usageFigures({ codexQuota }), codexFound: Boolean(codexPath) });
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'connection': 'keep-alive', 'x-content-type-options': 'nosniff' });
        response.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        clients.add(response);
        const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
        request.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
        return;
      }
      if (request.method !== 'POST') return send(response, 404, { error: 'Rota não encontrada' });
      const input = await body(request);
      const reviewResult = await review({ method: request.method, url, input });
      if (reviewResult) {
        if (reviewResult.changed) broadcast('state', state());
        return send(response, reviewResult.status, reviewResult.body);
      }
      const arsenalResult = await arsenalApi({ method: request.method, url, input });
      if (arsenalResult) {
        if (arsenalResult.changed) broadcast('arsenal', arsenalResult.changed);
        return send(response, arsenalResult.status, arsenalResult.body);
      }
      const workflowResult = workflows.handle({ method: request.method, url, input });
      if (workflowResult) {
        if (workflowResult.changed) broadcast('state', state());
        return send(response, workflowResult.status, workflowResult.body);
      }
      let output;
      let changed = true;
      if (['/api/copilot/enable', '/api/copilot/disable'].includes(url.pathname)) {
        if (Object.keys(input).length) return send(response, 400, { error: 'Configuração local inválida' });
        try { output = await classifier[url.pathname.endsWith('/enable') ? 'enable' : 'disable'](); }
        catch (error) { throw classifierError(error); }
        changed = false;
      }
      else if (url.pathname === '/api/copilot/classify') { output = await classifyPrompt({ input, store, catalog, classifier }); changed = false; }
      else if (url.pathname === '/api/skills/refresh') { output = await catalog.refresh(); changed = false; }
      else if (url.pathname === '/api/projects') output = store.addProject(input);
      else if (url.pathname === '/api/sessions') {
        output = store.addSession(input);
        shells.start(output.id);
      } else if (url.pathname === '/api/tasks') output = store.addTask(input);
      else if (url.pathname === '/api/memory') output = store.addNote(input);
      else if (url.pathname === '/api/layout') output = store.setLayout(input.split);
      else if (url.pathname.startsWith('/api/extensions/')) {
        const project = store.project(input.projectId), action = url.pathname.slice('/api/extensions/'.length);
        changed = false;
        if (action === 'generate') output = await extensions.generate(project.id, input.request);
        else if (action === 'preview') output = await extensions.preview(project.id, input.version, { expectedRevision: input.expectedRevision });
        else if (action === 'enable') output = await extensions.enable(project.id, input.version, { reviewed: input.reviewed, expectedRevision: input.expectedRevision });
        else if (action === 'disable') output = await extensions.disable(project.id, { expectedRevision: input.expectedRevision });
        else if (action === 'rollback') output = await extensions.rollback(project.id, { expectedRevision: input.expectedRevision });
        else if (action === 'run') output = await extensions.run(project.id, project.root);
        else return send(response, 404, { error: 'Rota não encontrada' });
      }
      else if (url.pathname === '/api/keys') { output = await keys.store({ provider: input.provider, secret: input.secret }); changed = false; }
      else if (url.pathname === '/api/keys/remove') { await keys.remove(input.ref); output = { removed: true }; changed = false; }
      else if (url.pathname === '/api/usage/codex-quota') { codexQuota = await readQuota({ codexPath }); output = { figures: usageFigures({ codexQuota }) }; changed = false; }
      else {
        const command = url.pathname.match(/^\/api\/sessions\/([^/]+)\/command$/);
        const write = url.pathname.match(/^\/api\/sessions\/([^/]+)\/write$/);
        const resize = url.pathname.match(/^\/api\/sessions\/([^/]+)\/resize$/);
        const stop = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/);
        const recovery = url.pathname.match(/^\/api\/sessions\/([^/]+)\/acknowledge$/);
        const taskStatus = url.pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
        const taskOwner = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(assign|handoff)$/);
        const taskRun = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
        const memoryUpdate = url.pathname.match(/^\/api\/memory\/([^/]+)\/(update|archive|forget)$/);
        if (command) { output = shells.command(command[1], input.command); engine.input(command[1], '\r'); changed = false; }
        else if (write) { output = shells.write(write[1], input.data); engine.input(write[1], input.data); changed = false; }
        else if (taskRun) output = engine.run(taskRun[1], input);
        else if (resize) { output = shells.resize(resize[1], input.cols, input.rows); changed = false; }
        else if (stop) { output = shells.stop(stop[1]); changed = false; }
        else if (recovery) output = store.acknowledgeInterruptedSession(recovery[1], input.verification);
        else if (taskStatus) output = store.setTaskStatus(taskStatus[1], input.status, input.expectedRevision);
        else if (taskOwner) output = taskOwner[2] === 'assign' ? store.assignTask(taskOwner[1], input) : store.handoffTask(taskOwner[1], input);
        else if (memoryUpdate) output = memoryUpdate[2] === 'update' ? store.updateNote(memoryUpdate[1], input) : store.archiveNote(memoryUpdate[1], input);
        else return send(response, 404, { error: 'Rota não encontrada' });
      }
      if (changed) broadcast('state', state());
      return send(response, 200, output);
    } catch (error) {
      return send(response, error.status || 500, { error: error.status ? error.message : 'Erro interno do aplicativo' });
    }
  });

  return {
    store,
    shells,
    engine,
    server,
    token,
    async listen(port = 0) {
      await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
      const address = server.address();
      return `http://127.0.0.1:${address.port}/?token=${token}`;
    },
    async close() {
      for (const client of clients) client.end();
      clients.clear();
      const shutdowns = await Promise.allSettled([catalog.close?.(), classifier.close(), arsenal.close?.(), shells.closeAll()]);
      const shutdownError = shutdowns.find(result => result.status === 'rejected')?.reason;
      await new Promise(resolve => server.close(resolve));
      store.close();
      if (shutdownError) throw shutdownError;
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createOmniForgeServer({ dataDir: process.env.OMNIFORGE_DATA_DIR || path.join(REPO_ROOT, '.omniforge-lab') });
  const url = await app.listen(Number(process.env.OMNIFORGE_PORT || 0));
  console.log(`OmniForge Lab: ${url}`);
  console.log('Candidato local: PTYs e Copilot; Laya exige ativação. Ctrl+C solicita o encerramento das sessões.');
  const shutdown = async () => {
    try { await app.close(); process.exit(0); }
    catch (error) { console.error(`Encerramento não confirmado: ${error.message}`); process.exit(1); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
