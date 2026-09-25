import { spawnSync } from 'node:child_process';

const KINDS = new Set(['accepted_decision', 'experiment', 'rejected', 'quoted']);
const HOSTS = new Set(['codex', 'claude', 'hermes']);
const OPS = new Set(['import', 'derive', 'review', 'activate', 'rollback', 'disable', 'pin']);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('Campos do arsenal inválidos');
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('Revisão do arsenal inválida');
  return value;
}

function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('Versão de perfil inválida');
  return value;
}

function uniqueStrings(value, maximum) {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum &&
    value.every(item => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length;
}

// Metadata pinning observes an executable, not its login, allowance, tool safety or dispatch readiness.
export function observeHostExecutables() {
  const hosts = [];
  for (const host of HOSTS) {
    const command = process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `if (Get-Command -Name ${host} -CommandType Application -ErrorAction SilentlyContinue) { [Console]::Write('found') }`]]
      : ['sh', ['-c', `command -v ${host} >/dev/null 2>&1 && printf found`]];
    try {
      const result = spawnSync(command[0], command[1], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      if (result.status === 0 && result.stdout === 'found') hosts.push(host);
    } catch { /* Unknown stays unavailable. */ }
  }
  return hosts;
}

export function createArsenalApi({ store, service, observeHosts = observeHostExecutables }) {
  const project = id => store.project(id).id;
  const selectedSources = (projectId, selections, selectedSourceIds) => {
    if (!Array.isArray(selections) || selections.length < 1 || selections.length > 16 ||
        !uniqueStrings(selectedSourceIds, 16) || selections.length !== selectedSourceIds.length) fail('Seleção de fontes inválida');
    const excerpts = [];
    let total = 0;
    for (let index = 0; index < selections.length; index++) {
      const selected = selections[index];
      fields(selected, ['noteId', 'sessionId', 'expectedRevision', 'kind', 'sanitized']);
      if (selected.noteId !== selectedSourceIds[index] || selected.sanitized !== true ||
          !KINDS.has(selected.kind) || !Number.isSafeInteger(selected.expectedRevision) || selected.expectedRevision < 1) {
        fail('Fonte selecionada, classificação ou revisão inválida');
      }
      const session = store.session(selected.sessionId);
      if (session.projectId !== projectId) fail('Sessão pertence a outro projeto', 404);
      const note = store.boundNote(selected.noteId, { scope: 'session', projectId, sessionId: selected.sessionId });
      if (note.archivedAt || note.revision !== selected.expectedRevision) fail('Fonte alterada ou arquivada; recarregue antes de derivar', 409);
      const limit = selected.kind === 'accepted_decision' ? 512 : 2048;
      if (note.text.length > limit) fail('Fonte selecionada excede o limite; revise na origem');
      total += Buffer.byteLength(note.text, 'utf8');
      excerpts.push({ id: note.id, session_id: note.sessionId, kind: selected.kind, text: note.text,
        sanitized: true, reference: `memory:${note.id}@revision:${note.revision}` });
    }
    if (total > 16 * 1024 || !excerpts.some(item => item.kind === 'accepted_decision')) fail('Fontes excedem o limite ou não incluem uma decisão aceita');
    return excerpts;
  };

  return async function handle({ method, url, input }) {
    if (!url.pathname.startsWith('/api/arsenal')) return null;
    if (method === 'GET' && url.pathname === '/api/arsenal') {
      const projectId = project(url.searchParams.get('projectId'));
      const builtinResult = await service.request({ op: 'builtins' });
      // Registry and pin reads are distinct bridge calls. Only expose a pair
      // observed at one revision; concurrent writers require a bounded retry.
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await service.request({ op: 'list', projectId });
        const pinResult = await service.request({ op: 'list-pins', projectId });
        if (snapshot.revision === pinResult.revision) {
          return { status: 200, body: { projectId, snapshot, builtins: builtinResult.profiles, pins: pinResult.pins,
            hosts: observeHosts(), runnable: false } };
        }
      }
      fail('O arsenal mudou durante a consulta; atualize novamente', 409);
    }
    if (method === 'GET' && url.pathname === '/api/arsenal/sources') {
      const projectId = project(url.searchParams.get('projectId'));
      const sessionIds = url.searchParams.getAll('sessionId');
      if (!uniqueStrings(sessionIds, 8)) fail('Selecione de uma a oito sessões');
      const notes = [];
      for (const sessionId of sessionIds) {
        if (store.session(sessionId).projectId !== projectId) fail('Sessão pertence a outro projeto', 404);
        for (const note of store.notesFor({ projectId, sessionId })) {
          if (note.scope === 'session' && note.projectId === projectId && note.sessionId === sessionId && !note.archivedAt) {
            notes.push({ id: note.id, sessionId, revision: note.revision, text: note.text, source: note.source,
              updatedAt: note.updatedAt });
          }
        }
      }
      notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      return { status: 200, body: { projectId, notes: notes.slice(0, 64) } };
    }
    const pinRoute = url.pathname.match(/^\/api\/arsenal\/pins\/([^/]+)$/);
    if (method === 'GET' && pinRoute) {
      const projectId = project(url.searchParams.get('projectId'));
      const task = store.task(pinRoute[1]);
      if (task.projectId !== projectId) fail('Tarefa pertence a outro projeto', 404);
      return { status: 200, body: await service.request({ op: 'get-pin', projectId, taskId: task.id }) };
    }
    const detail = url.pathname.match(/^\/api\/arsenal\/([^/]+)$/);
    if (method === 'GET' && detail) {
      const projectId = project(url.searchParams.get('projectId'));
      const requestedVersion = Number(url.searchParams.get('version'));
      if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) fail('Versão de perfil inválida');
      let profileId;
      try { profileId = decodeURIComponent(detail[1]); } catch { fail('Perfil inválido'); }
      return { status: 200, body: await service.request({ op: 'preview', projectId, profileId, version: requestedVersion }) };
    }
    const action = url.pathname.match(/^\/api\/arsenal\/(import|derive|review|activate|rollback|disable|pin)$/);
    if (method !== 'POST' || !action || !OPS.has(action[1])) return null;
    const op = action[1];
    const projectId = project(input?.projectId);
    revision(input.expectedRevision);
    let request;
    if (op === 'import') {
      fields(input, ['projectId', 'builtinId', 'expectedRevision']);
      request = { op: 'import-builtin', projectId, builtinId: input.builtinId, expectedRevision: input.expectedRevision };
    } else if (op === 'derive') {
      fields(input, ['projectId', 'templateId', 'profileId', 'name', 'selectedSourceIds', 'selections', 'expectedRevision']);
      const excerpts = selectedSources(projectId, input.selections, input.selectedSourceIds);
      request = { op, projectId, templateId: input.templateId, profileId: input.profileId, name: input.name,
        selectedSourceIds: input.selectedSourceIds, excerpts, expectedRevision: input.expectedRevision };
    } else if (op === 'review') {
      fields(input, ['projectId', 'profileId', 'version', 'contentSha256', 'sourceRules', 'reviewedRuleIds', 'reviewedSettings', 'expectedRevision']);
      version(input.version);
      if (input.reviewedSettings !== true) fail('Revise os campos herdados antes de aprovar');
      const preview = await service.request({ op: 'preview', projectId, profileId: input.profileId, version: input.version });
      const ids = preview.rules.map(rule => rule.id);
      if (input.contentSha256 !== preview.content_sha256 || !uniqueStrings(input.reviewedRuleIds, 64) ||
          input.reviewedRuleIds.length !== ids.length || !ids.every(id => input.reviewedRuleIds.includes(id))) {
        fail('Confirmação completa das regras obrigatória');
      }
      const sourceRules = Object.fromEntries(preview.rules.map(rule => [rule.id, rule.source_ids]));
      if (!input.sourceRules || typeof input.sourceRules !== 'object' || Array.isArray(input.sourceRules) ||
          Object.keys(input.sourceRules).length !== ids.length ||
          ids.some(id => !Array.isArray(input.sourceRules[id]) ||
            JSON.stringify(input.sourceRules[id]) !== JSON.stringify(sourceRules[id]))) {
        fail('Mapa de fontes da revisão inválido');
      }
      request = { op, projectId, profileId: input.profileId, version: input.version,
        contentSha256: input.contentSha256, sourceRules: input.sourceRules, expectedRevision: input.expectedRevision };
    } else if (op === 'activate' || op === 'rollback') {
      fields(input, ['projectId', 'profileId', 'version', 'expectedRevision']);
      request = { op, projectId, profileId: input.profileId, version: version(input.version), expectedRevision: input.expectedRevision };
    } else if (op === 'disable') {
      fields(input, ['projectId', 'profileId', 'expectedRevision']);
      request = { op, projectId, profileId: input.profileId, expectedRevision: input.expectedRevision };
    } else {
      fields(input, ['projectId', 'profileId', 'taskId', 'host', 'expectedRevision']);
      if (!HOSTS.has(input.host)) fail('Host de agente inválido');
      const task = store.task(input.taskId);
      if (task.projectId !== projectId) fail('Tarefa pertence a outro projeto', 404);
      const availableHosts = observeHosts();
      if (!Array.isArray(availableHosts) || !availableHosts.includes(input.host)) fail('Executável do host não observado neste ambiente', 409);
      request = { op, projectId, profileId: input.profileId, taskId: task.id, host: input.host,
        availableHosts, expectedRevision: input.expectedRevision };
    }
    const result = await service.request(request);
    return { status: 200, body: result, changed: { projectId, revision: result.revision } };
  };
}
