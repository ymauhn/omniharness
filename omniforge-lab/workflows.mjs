import { createHash, randomUUID } from 'node:crypto';

// Store extension, not an executor. The existing WorkspaceStore owns locking,
// recovery and atomic persistence. All mutations below are synchronous.
const AUTHORITY = 'manual-task-only';
const MAX_BYTES = 4 * 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const PILLARS = ['engineering', 'orchestration-os', 'science-thesis', 'education-community', 'technical-marketing'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
// 507 (RFC 4331 quota) keeps capacity apart from 409 revision conflicts.
const full = what => fail(`Limite de ${what} atingido; nada foi salvo`, 507);
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail('Estrutura de workflow inválida');
}
function text(value, max, label = 'Texto') {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || !value.isWellFormed()) fail(`${label} inválido (limite ${max})`);
  return value.trim();
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('Identidade de workflow inválida'); return value; }
function strings(values, maxItems = 8, maxText = 180) {
  if (!Array.isArray(values) || values.length > maxItems) fail('Lista de workflow inválida');
  const result = values.map(value => text(value, maxText));
  if (new Set(result).size !== result.length) fail('Itens duplicados no workflow');
  return result;
}

export function validateWorkflow(input) {
  exact(input, ['title', 'summary', 'pillar', 'triggerPrompt', 'inputs', 'outputs', 'hosts', 'source', 'authority', 'nodes']);
  if (!PILLARS.includes(input.pillar) || input.authority !== AUTHORITY) fail('Pilar ou autoridade de workflow inválidos');
  const hosts = strings(input.hosts, 3, 16);
  if (!hosts.length || hosts.some(host => !['codex', 'claude', 'local'].includes(host))) fail('Hosts sugeridos inválidos');
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 16) fail('Use de 1 a 16 nós');
  const nodes = input.nodes.map(node => {
    exact(node, ['id', 'title', 'prompt', 'dependsOn', 'skills']);
    return { id: id(node.id), title: text(node.title, 120), prompt: text(node.prompt, 3500), dependsOn: strings(node.dependsOn, 15, 80).map(id), skills: strings(node.skills, 8, 240) };
  });
  const known = new Set(nodes.map(node => node.id));
  if (known.size !== nodes.length || nodes.some(node => node.dependsOn.some(dep => !known.has(dep) || dep === node.id))) fail('Nó duplicado ou dependência inválida');
  const visited = new Set(), active = new Set();
  const visit = node => {
    if (active.has(node.id)) fail('O workflow deve ser acíclico');
    if (visited.has(node.id)) return;
    active.add(node.id);
    for (const dep of node.dependsOn) visit(nodes.find(item => item.id === dep));
    active.delete(node.id); visited.add(node.id);
  };
  nodes.forEach(visit);
  const result = { title: text(input.title, 120), summary: text(input.summary, 600), pillar: input.pillar, triggerPrompt: text(input.triggerPrompt, 3500), inputs: strings(input.inputs), outputs: strings(input.outputs), hosts, source: text(input.source, 300), authority: AUTHORITY, nodes };
  if (Buffer.byteLength(JSON.stringify(result)) > 24 * 1024) fail('Workflow excede 24 KiB', 413);
  return result;
}

function preset(key, title, pillar, summary, inputs, outputs, steps) {
  const nodes = steps.map(([name, prompt, skills], index) => ({ id: `step-${index + 1}`, title: name, prompt, dependsOn: index ? [`step-${index}`] : [], skills }));
  return { id: key, version: 1, kind: 'suggestion', runnable: false, definition: validateWorkflow({ title, summary, pillar, triggerPrompt: summary, inputs, outputs, hosts: ['codex', 'claude'], source: 'Original OmniHarness workflow · 2026-09-25 · proposed template', authority: AUTHORITY, nodes }) };
}
const CHECKPOINT = 'repo:.agents/skills/checkpoint-build/SKILL.md';
const GRAPH = 'repo:.agents/skills/skills-graph/SKILL.md';
const PRESETS = [
  preset('engineering-checkpoint', 'Do bug à evidência', 'engineering', 'Corrigir um problema delimitado, começando por um teste que falha e encerrando com evidência revisável.', ['Issue e critério de aceite', 'Código e regras do projeto'], ['Regressão executável', 'Diff e handoff revisado'], [
    ['Reproduzir', 'Leia o código relevante e as regras do projeto. Reproduza o problema em um teste pequeno que falhe pelo motivo esperado. Registre o comando e a falha real.', [CHECKPOINT]],
    ['Corrigir', 'Use a reprodução registrada para fazer a menor correção dentro do escopo aprovado. Rode o teste e as verificações pertinentes. Preserve falhas e limites encontrados.', [CHECKPOINT]],
    ['Revisar', 'Faça uma revisão independente do diff e dos critérios de aceite. Relacione cada alegação à evidência; entregue o handoff com os testes executados e pendências reais.', [CHECKPOINT]],
  ]),
  preset('orchestration-handoff', 'Dividir, coordenar, retomar', 'orchestration-os', 'Planejar tarefas independentes e um handoff entre hosts com identidade, dependências e limites explícitos.', ['Plano autorizado', 'Hosts observados e contexto'], ['DAG de tarefas', 'Handoff com proveniência'], [
    ['Mapear capacidades', 'Consulte o catálogo para escolher o menor conjunto pertinente de skills. Diferencie referências, instalação, disponibilidade e autorização; nenhuma seleção concede execução.', [GRAPH]],
    ['Dividir o trabalho', 'Defina tarefas disjuntas, dependências, caminhos de escrita e critérios verificáveis. Proponha worktrees separados. Só despache após preflight do executor e autoridade aplicável.', ['repo:.agents/skills/swarm/SKILL.md']],
    ['Registrar continuidade', 'Prepare um handoff com IDs de tarefa e projeto, commits, verificações, limites de cancelamento e cobertura de consumo. Desconhecido permanece desconhecido.', [CHECKPOINT]],
  ]),
  preset('science-source-audit', 'Do resultado ao parecer', 'science-thesis', 'Auditar um manuscrito existente contra resultados fornecidos, com rastreabilidade numérica e decisão do autor.', ['Manuscrito e regras', 'Arquivos de resultados existentes'], ['Mapa de alegações e fontes', 'Parecer numerado'], [
    ['Vincular fontes', 'Inventarie apenas o manuscrito e os resultados selecionados. Registre versões, comandos já fornecidos e lacunas de reprodutibilidade. Não solicite novo experimento nesta auditoria.', ['repo:.agents/skills/thesis-review/SKILL.md']],
    ['Conferir alegações', 'Confira as alegações numéricas e matemáticas usando os resultados fornecidos. Separe cálculo verificável, interpretação e hipótese. Não invente valores ou referências.', ['repo:.agents/skills/thesis-review/SKILL.md']],
    ['Entregar parecer', 'Produza correções numeradas com fonte e impacto para decisão do autor. Não reescreva resultados ou transforme lacunas em aprovação.', ['repo:.agents/skills/thesis-review/SKILL.md']],
  ]),
  preset('education-challenge', 'Desafio que ensina e verifica', 'education-community', 'Criar um desafio técnico com rubrica, solução e contraexemplo executável para desenvolvedores.', ['Objetivo e pré-requisitos', 'Exemplo aprovado'], ['Desafio e tutorial', 'Verificador positivo e negativo'], [
    ['Definir rubrica', 'Escreva um objetivo de aprendizagem observável, pré-requisitos e critérios de sucesso. Vincule o desafio a um exemplo do projeto e delimite o que será verificado.', [CHECKPOINT]],
    ['Construir verificador', 'Crie um verificador local que aceite a solução correta e rejeite um contraexemplo plausível. Registre os comandos e resultados reais antes de declarar o desafio funcional.', [CHECKPOINT]],
    ['Explicar', 'Redija um tutorial curto com o caminho do exemplo, comandos testados e explicação das falhas. Prepare material para revisão, sem publicar ou atribuir progresso a membros automaticamente.', [CHECKPOINT]],
  ]),
  preset('marketing-evidence', 'Evidência vira história', 'technical-marketing', 'Transformar uma entrega aceita em estudo de caso e roteiro técnico com cada alegação vinculada à fonte.', ['Commit aceito e público-alvo', 'Testes e evidências sanitizadas'], ['Estudo de caso', 'Roteiro com mapa de fontes'], [
    ['Selecionar evidências', 'Leia somente os artefatos autorizados: commit, testes e resultados. Registre o que está demonstrado, o que falhou e o que continua desconhecido. Selecione skills pertinentes pelo catálogo.', [GRAPH]],
    ['Escrever com fontes', 'Prepare um estudo de caso para desenvolvedores: problema, mudança, demonstração reproduzível e limites. Vincule números e capacidades às fontes; remova promessas não comprovadas.', [CHECKPOINT]],
    ['Preparar tutorial', 'Derive um roteiro de tutorial e uma chamada para ação que realmente exista. Entregue rascunhos revisáveis; nenhuma publicação, campanha ou mensagem externa está autorizada por este workflow.', [CHECKPOINT]],
  ]),
];
export function workflowPresets() { return clone(PRESETS); }

const initial = () => ({ schema: 1, workflows: [], runs: [] });
const current = workflow => workflow.revisions.at(-1);
const summary = workflow => ({ id: workflow.id, projectId: workflow.projectId, revision: workflow.revision, archivedAt: workflow.archivedAt, ...clone(current(workflow)) });
function ancestors(definition, nodeId) {
  const selected = definition.nodes.find(node => node.id === nodeId);
  if (!selected) fail('Nó não encontrado', 404);
  const ordered = [], seen = new Set();
  const visit = node => { if (seen.has(node.id)) return; for (const dep of node.dependsOn) visit(definition.nodes.find(item => item.id === dep)); seen.add(node.id); ordered.push(node); };
  visit(selected); return ordered;
}
function validateRegistry(registry, store) {
  exact(registry, ['schema', 'workflows', 'runs']);
  if (registry.schema !== 1 || !Array.isArray(registry.workflows) || !Array.isArray(registry.runs)) fail('Schema do registro de workflows inválido');
  const workflowIds = new Set(), runIds = new Set(), requests = new Set(), usage = new Map();
  // Budgets are per project so one busy project cannot lock out another.
  // ponytail: nothing prunes old runs or versions and the state file grows with project count; a full project stays full until an owner-approved cleanup path exists.
  const charge = (row, kind) => {
    const used = usage.get(row.projectId) ?? { workflows: 0, runs: 0, bytes: 0 }; usage.set(row.projectId, used);
    used[kind]++; used.bytes += Buffer.byteLength(JSON.stringify(row));
    if (used.workflows > 128) full('128 workflows neste projeto');
    if (used.runs > 256) full('256 snapshots de tarefas neste projeto');
    if (used.bytes > MAX_BYTES) full('4 MiB de workflows neste projeto');
  };
  for (const workflow of registry.workflows) {
    exact(workflow, ['id', 'projectId', 'revision', 'archivedAt', 'revisions']); charge(workflow, 'workflows');
    id(workflow.id); store.project(workflow.projectId);
    if (workflowIds.has(workflow.id) || !Array.isArray(workflow.revisions) || workflow.revisions.length < 1 || workflow.revisions.length > 32 || workflow.revision !== workflow.revisions.length + (workflow.archivedAt ? 1 : 0) || workflow.archivedAt !== null && !Number.isFinite(Date.parse(workflow.archivedAt))) fail('Histórico de workflow inválido');
    workflowIds.add(workflow.id);
    workflow.revisions.forEach((version, index) => {
      exact(version, ['version', 'definition', 'hash', 'savedAt']);
      const definition = validateWorkflow(version.definition);
      if (version.version !== index + 1 || hash(definition) !== version.hash || hash(version.definition) !== version.hash || !Number.isFinite(Date.parse(version.savedAt))) fail('Versão de workflow inválida');
    });
  }
  for (const run of registry.runs) {
    exact(run, ['id', 'projectId', 'workflowId', 'version', 'nodeId', 'requestId', 'definition', 'hash', 'taskIds', 'createdAt', 'dispatch', 'outcome']); charge(run, 'runs');
    id(run.id); id(run.requestId);
    const workflow = registry.workflows.find(item => item.id === run.workflowId && item.projectId === run.projectId);
    const version = workflow?.revisions.find(item => item.version === run.version);
    const requestKey = `${run.projectId}/${run.requestId}`;
    if (!version || runIds.has(run.id) || requests.has(requestKey) || hash(run.definition) !== version.hash || run.hash !== version.hash || run.dispatch !== 'none' || run.outcome !== null || !Number.isFinite(Date.parse(run.createdAt))) fail('Snapshot de tarefas inválido');
    runIds.add(run.id); requests.add(requestKey);
    const nodes = ancestors(version.definition, run.nodeId);
    exact(run.taskIds, nodes.map(node => node.id));
    for (const node of nodes) {
      const task = store.task(run.taskIds[node.id]);
      const pin = { runId: run.id, workflowId: run.workflowId, version: run.version, nodeId: node.id, hash: run.hash };
      if (task.projectId !== run.projectId || JSON.stringify(task.dependsOn) !== JSON.stringify(node.dependsOn.map(dep => run.taskIds[dep])) || JSON.stringify(task.workflow) !== JSON.stringify(pin)) fail('Vínculo de tarefa inválido');
    }
  }
}

export function createWorkflowService({ store }) {
  const registry = () => store.data.workflowRegistry ?? initial();
  try { validateRegistry(registry(), store); } catch { fail('Registro de workflows incompatível; preserve os dados e inspecione a recuperação', 503); }
  const bound = (registry, workflowId, projectId) => {
    id(workflowId); store.project(projectId);
    const row = registry.workflows.find(item => item.id === workflowId && item.projectId === projectId);
    if (!row) fail('Workflow não encontrado neste projeto', 404);
    return row;
  };
  const writable = (row, input) => {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Revisão esperada inválida');
    if (row.revision !== input.expectedRevision) fail('Workflow alterado; recarregue antes de continuar', 409);
    if (row.archivedAt) fail('Workflow arquivado', 409);
  };
  const transaction = operation => {
    // Reuse addTask/project/task validation on a private facade. No constructor,
    // lock acquisition or durable write occurs until the whole batch validates.
    const tx = Object.create(store);
    tx.data = clone(store.data); tx.save = () => {};
    tx.data.workflowRegistry ??= initial();
    const result = operation(tx, tx.data.workflowRegistry);
    validateRegistry(tx.data.workflowRegistry, tx);
    const before = store.data;
    store.data = tx.data;
    try { store.save(); }
    catch { store.data = before; fail('Falha ao salvar workflows; nenhuma alteração confirmada', 500); }
    return clone(result);
  };
  const reviewed = input => { if (input.reviewed !== true) fail('Revise o workflow antes de salvá-lo'); };
  const version = (definition, number) => ({ version: number, definition, hash: hash(definition), savedAt: new Date().toISOString() });
  const service = {
    list(projectId) {
      store.project(projectId);
      return { projectId, rows: registry().workflows.filter(item => item.projectId === projectId).map(summary), runs: registry().runs.filter(item => item.projectId === projectId).map(({ definition, ...run }) => clone(run)) };
    },
    get(workflowId, projectId) {
      const workflow = bound(registry(), workflowId, projectId);
      return clone({ workflow, runs: registry().runs.filter(run => run.workflowId === workflow.id && run.projectId === projectId) });
    },
    create(input) {
      exact(input, ['projectId', 'definition', 'reviewed']); store.project(input.projectId); reviewed(input);
      const definition = validateWorkflow(input.definition);
      return transaction((tx, registry) => {
        const row = { id: randomUUID(), projectId: input.projectId, revision: 1, archivedAt: null, revisions: [version(definition, 1)] };
        registry.workflows.push(row); return summary(row);
      });
    },
    update(workflowId, input) {
      exact(input, ['projectId', 'expectedRevision', 'definition', 'reviewed']); reviewed(input);
      const definition = validateWorkflow(input.definition);
      return transaction((tx, registry) => {
        const row = bound(registry, workflowId, input.projectId); writable(row, input);
        if (row.revisions.length >= 32) full('32 versões deste workflow');
        row.revisions.push(version(definition, row.revisions.length + 1)); row.revision++;
        return summary(row);
      });
    },
    archive(workflowId, input) {
      exact(input, ['projectId', 'expectedRevision']);
      return transaction((tx, registry) => {
        const row = bound(registry, workflowId, input.projectId); writable(row, input);
        row.archivedAt = new Date().toISOString(); row.revision++; return summary(row);
      });
    },
    tasks(workflowId, input) {
      exact(input, ['projectId', 'expectedRevision', 'nodeId', 'requestId']); id(input.requestId); id(input.nodeId);
      const row = bound(registry(), workflowId, input.projectId);
      const prior = registry().runs.find(run => run.projectId === input.projectId && run.requestId === input.requestId);
      if (prior) {
        if (prior.workflowId !== workflowId || prior.nodeId !== input.nodeId || row.revisions.find(v => v.version === prior.version)?.version !== input.expectedRevision) fail('Identidade de pedido já usada', 409);
        return clone(prior);
      }
      writable(row, input);
      return transaction((tx, registry) => {
        const frozen = current(row), nodes = ancestors(frozen.definition, input.nodeId);
        const run = { id: randomUUID(), projectId: row.projectId, workflowId, version: frozen.version, nodeId: input.nodeId, requestId: input.requestId, definition: clone(frozen.definition), hash: frozen.hash, taskIds: {}, createdAt: new Date().toISOString(), dispatch: 'none', outcome: null };
        for (const node of nodes) {
          const task = tx.addTask({ projectId: row.projectId, title: node.title, dependsOn: node.dependsOn.map(dep => run.taskIds[dep]) });
          task.workflow = { runId: run.id, workflowId, version: run.version, nodeId: node.id, hash: run.hash };
          run.taskIds[node.id] = task.id;
        }
        registry.runs.push(run); return run;
      });
    },
    // Invoke only AFTER the server's authentication, CSRF and body limits.
    handle({ method, url, input }) {
      const pathname = url.pathname;
      if (pathname !== '/api/workflows' && !pathname.startsWith('/api/workflows/')) return null;
      const projectId = url.searchParams.get('projectId');
      if (method === 'GET' && pathname === '/api/workflows') return { status: 200, body: service.list(projectId), changed: false };
      if (method === 'GET' && pathname === '/api/workflows/presets') { store.project(projectId); return { status: 200, body: { projectId, rows: workflowPresets() }, changed: false }; }
      if (method === 'POST' && pathname === '/api/workflows') return { status: 200, body: service.create(input), changed: true };
      const match = pathname.match(/^\/api\/workflows\/([a-zA-Z0-9_-]+)(?:\/(update|archive|tasks))?$/);
      if (match && method === 'GET' && !match[2]) return { status: 200, body: service.get(match[1], projectId), changed: false };
      if (match && method === 'POST' && match[2]) return { status: 200, body: service[match[2]](match[1], input), changed: true };
      return { status: 404, body: { error: 'Rota de workflow não encontrada' }, changed: false };
    },
  };
  return service;
}
