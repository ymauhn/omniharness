// Project-scoped agent profiles. This panel records reviewed metadata; it never
// starts a model, grants host permissions or copies a session transcript.
const PILLARS = { engineering: 'Engenharia', 'orchestration-os': 'Orquestração', 'science-thesis': 'Ciência', 'education-community': 'Educação', 'technical-marketing': 'Marketing técnico' };
const KINDS = { experiment: 'Experimento (proveniência)', rejected: 'Rejeitado (proveniência)', quoted: 'Citação (proveniência)', accepted_decision: 'Decisão aceita (vira regra)' };
const HOSTS = { codex: 'Codex', claude: 'Claude', hermes: 'Hermes' };
const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const query = (projectId, other = {}) => `?${new URLSearchParams({ projectId, ...other })}`;
const failure = error => error?.status === 409 ? 'Conflito de revisão: recarregue e confira o estado atual antes de tentar novamente.'
  : error?.status === 400 || error?.status === 404 ? error.message : 'Operação não confirmada. Confira a conexão e atualize o arsenal.';

export function mountArsenalPanel({ root, api, getProjectId, getSessions, getTasks, onChanged = () => {} }) {
  const doc = root.ownerDocument;
  const make = (parent, tag, text, className = '') => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.append(node); return node;
  };
  const button = (parent, text, fn, className = 'secondary') => {
    const node = make(parent, 'button', text, className); node.type = 'button'; node.addEventListener('click', fn); return node;
  };
  const selectOption = (parent, value, text) => { const option = make(parent, 'option', text); option.value = value; return option; };
  const field = (parent, label, maxLength = 100) => {
    const wrapper = make(parent, 'label', label, 'ars-field');
    const input = make(wrapper, 'input'); input.maxLength = maxLength; return input;
  };
  const state = { projectId: undefined, epoch: 0, loadSeq: 0, previewSeq: 0, sourcesSeq: 0, busy: false,
    snapshot: { revision: 0, profiles: [] }, builtins: [], pins: [], preview: null, selectedId: null,
    selectedVersion: null, sessions: new Set(), notes: [], hosts: [], focusedTaskId: null, destroyed: false };
  root.classList.add('ars-panel');
  const toolbar = make(root, 'div', undefined, 'ars-toolbar');
  make(toolbar, 'p', 'Perfis versionados por projeto · revisão explícita antes de ativar', 'ars-hint');
  const reload = button(toolbar, 'Atualizar arsenal', () => load());
  const status = make(root, 'p', 'Selecione um projeto.', 'ars-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const layout = make(root, 'div', undefined, 'ars-layout');
  const library = make(layout, 'aside', undefined, 'ars-library');
  const detail = make(layout, 'section', undefined, 'card ars-detail');
  const sources = make(root, 'section', undefined, 'card ars-derive');
  const say = text => { status.textContent = text; };
  const ticket = () => { const projectId = state.projectId, epoch = state.epoch; return () => !state.destroyed && state.epoch === epoch && getProjectId() === projectId && state.projectId === projectId; };
  const rowById = id => state.snapshot.profiles.find(row => row.id === id);
  const savedTasks = () => getTasks().filter(task => task.projectId === state.projectId);
  const savedSessions = () => getSessions().filter(session => session.projectId === state.projectId);
  const pinByTask = taskId => state.pins.find(pin => pin.task_id === taskId);
  const checkResponse = result => {
    const builtins = Array.isArray(result?.builtins) ? result.builtins : result?.builtins?.profiles;
    if (result?.projectId !== state.projectId || !Array.isArray(result.snapshot?.profiles) || !Number.isSafeInteger(result.snapshot.revision)
        || !Array.isArray(builtins) || !Array.isArray(result.pins)) throw Error('Resposta do arsenal inválida.');
  };
  function sync() {
    if (state.destroyed || state.projectId === getProjectId()) return;
    state.projectId = getProjectId(); state.epoch++; state.loadSeq++; state.previewSeq++; state.sourcesSeq++;
    state.busy = false; state.snapshot = { revision: 0, profiles: [] }; state.builtins = []; state.pins = []; state.hosts = [];
    state.preview = null; state.selectedId = null; state.selectedVersion = null;
    state.sessions = new Set(); state.notes = []; state.focusedTaskId = null;
    library.replaceChildren(); detail.replaceChildren(); sources.replaceChildren();
    say(state.projectId ? 'Carregando arsenal deste projeto…' : 'Selecione um projeto.');
    reload.disabled = !state.projectId;
    renderLibrary(); renderDetail(); renderSources();
    if (state.projectId) void load();
  }
  async function load() {
    if (state.projectId !== getProjectId()) return sync();
    if (!state.projectId || state.destroyed) return;
    const current = ticket(), seq = ++state.loadSeq, projectId = state.projectId;
    say('Consultando arsenal deste projeto…');
    try {
      const result = await api(`/api/arsenal${query(projectId)}`);
      if (!current() || seq !== state.loadSeq) return;
      checkResponse(result);
      // A read can begin while a POST is in flight and finish after its newer
      // revision has landed. Never let that older snapshot replace the write.
      if (result.snapshot.revision < state.snapshot.revision) return;
      state.snapshot = result.snapshot; state.builtins = Array.isArray(result.builtins) ? result.builtins : result.builtins.profiles;
      state.pins = result.pins; state.hosts = Array.isArray(result.hosts) ? result.hosts : [];
      renderLibrary(); renderDetail(); renderSources();
      say(`${state.snapshot.profiles.length} perfis no projeto · ${state.pins.length} vínculos de tarefa. Nenhum modelo foi iniciado.`);
    } catch (error) { if (current() && seq === state.loadSeq) say(failure(error)); }
  }
  async function mutate(op, data, after) {
    if (state.projectId !== getProjectId()) { sync(); return; }
    if (!state.projectId || state.busy || state.destroyed) return;
    const current = ticket(), projectId = state.projectId;
    state.busy = true; state.loadSeq++; state.previewSeq++;
    renderLibrary(); renderDetail(); renderSources();
    try {
      const result = await api(`/api/arsenal/${op}`, { method: 'POST', body: { projectId, expectedRevision: state.snapshot.revision, ...data } });
      if (!current()) return;
      if (!result?.snapshot || !Number.isSafeInteger(result.revision)) throw Error('Resposta de alteração inválida.');
      if (result.revision >= state.snapshot.revision) state.snapshot = result.snapshot;
      if (result.pin) state.pins = [...state.pins.filter(pin => pin.task_id !== result.pin.task_id), result.pin];
      if (result.preview) { state.selectedId = result.preview.profile.id; state.selectedVersion = result.preview.profile.version; state.preview = result.preview; }
      else if (state.selectedId) {
        // Lifecycle actions change the current version's review/active state.
        const selected = state.selectedId, version = state.selectedVersion;
        try { const preview = await api(`/api/arsenal/${encodeURIComponent(selected)}${query(projectId, { version })}`);
          if (current() && selected === state.selectedId && version === state.selectedVersion) state.preview = preview;
        } catch { if (current()) state.preview = null; }
      }
      if (!current()) return;
      renderLibrary(); renderDetail(); renderSources();
      say(result.pin ? 'Perfil ativo vinculado à tarefa como metadado. Nenhum agente foi executado.' : 'Alteração salva no registro versionado.');
      onChanged({ projectId, snapshot: state.snapshot, pins: state.pins });
      if (after) after(result);
    } catch (error) { if (current()) say(failure(error)); }
    finally { if (current()) { state.busy = false; renderLibrary(); renderDetail(); renderSources(); } }
  }
  async function openProfile(id, version) {
    if (state.projectId !== getProjectId()) return sync();
    if (!state.projectId || state.busy) return;
    state.selectedId = id; state.selectedVersion = version; state.preview = null;
    renderLibrary(); renderDetail();
    const current = ticket(), seq = ++state.previewSeq;
    say(`Carregando versão ${version}…`);
    try {
      const preview = await api(`/api/arsenal/${encodeURIComponent(id)}${query(state.projectId, { version })}`);
      if (!current() || seq !== state.previewSeq || state.selectedId !== id || state.selectedVersion !== version) return;
      if (preview?.profile?.id !== id || preview.profile.version !== version) throw Error('Prévia inválida.');
      state.preview = preview; renderDetail(); renderLibrary(); say(`Versão ${version} · ${preview.review ? 'revisada' : 'rascunho sem revisão'}.`);
    } catch (error) { if (current() && seq === state.previewSeq) say(failure(error)); }
  }
  function renderLibrary() {
    library.replaceChildren();
    make(library, 'h3', 'Templates instalados · importar como rascunho');
    for (const profile of state.builtins) {
      const item = make(library, 'div', undefined, 'ars-list-item');
      make(item, 'strong', profile.name); make(item, 'small', `${PILLARS[profile.pillar] || profile.pillar} · ${profile.id}`);
      const imported = !!rowById(profile.id);
      const importButton = button(item, imported ? 'Já importado' : 'Importar rascunho', () => mutate('import', { builtinId: profile.id }));
      importButton.disabled = state.busy || imported;
    }
    make(library, 'h3', `No projeto · ${state.snapshot.profiles.length}`);
    if (!state.snapshot.profiles.length) make(library, 'p', 'Nenhum perfil salvo neste projeto.', 'ars-hint');
    for (const row of state.snapshot.profiles) {
      const item = button(library, `${row.name} · última v${row.latest_version} · ativa ${row.active_version ? `v${row.active_version}` : 'nenhuma'}`, () => openProfile(row.id, row.latest_version), 'ars-profile');
      item.disabled = state.busy; item.setAttribute('aria-pressed', String(state.selectedId === row.id));
    }
  }
  function summaryList(parent, label, values) {
    const group = make(parent, 'div', undefined, 'ars-field');
    make(group, 'strong', label);
    if (!values?.length) make(group, 'span', 'Nenhum');
    else for (const value of values) make(group, 'span', String(value));
  }
  function renderPin(parent, profile, row) {
    const area = make(parent, 'section', undefined, 'ars-pin');
    make(area, 'h4', 'Vincular perfil ativo a uma tarefa');
    make(area, 'p', 'Preferência de host e snapshot imutável; isto não despacha nem isola um agente.', 'ars-hint');
    if (row?.active_version !== profile.version) return make(area, 'p', 'Abra a versão ativa para vincular.', 'ars-hint');
    const taskLabel = make(area, 'label', 'Tarefa deste projeto', 'ars-field'), taskSelect = make(taskLabel, 'select');
    selectOption(taskSelect, '', 'Selecione uma tarefa');
    for (const task of savedTasks()) {
      const pin = pinByTask(task.id);
      const option = selectOption(taskSelect, task.id, `${task.title}${pin ? ' · já vinculada' : ''}`);
      option.disabled = !!pin;
    }
    if (state.focusedTaskId && !pinByTask(state.focusedTaskId) && savedTasks().some(task => task.id === state.focusedTaskId)) taskSelect.value = state.focusedTaskId;
    const hostLabel = make(area, 'label', 'Host preferido (disponibilidade verificada no servidor)', 'ars-field'), hostSelect = make(hostLabel, 'select');
    for (const host of profile.suggested_hosts) {
      const available = state.hosts.includes(host);
      const option = selectOption(hostSelect, host, `${HOSTS[host] || host}${available ? '' : ' · indisponível'}`);
      option.disabled = !available;
    }
    const firstAvailable = profile.suggested_hosts.find(host => state.hosts.includes(host));
    if (firstAvailable) hostSelect.value = firstAvailable;
    const pinButton = button(area, 'Vincular à tarefa', () => {
      if (!taskSelect.value || pinByTask(taskSelect.value) || !state.hosts.includes(hostSelect.value)) return say('Selecione uma tarefa sem vínculo e um host disponível.');
      void mutate('pin', { profileId: profile.id, taskId: taskSelect.value, host: hostSelect.value });
    }, 'button');
    pinButton.disabled = state.busy || !firstAvailable || !savedTasks().some(task => !pinByTask(task.id));
    const pinned = make(area, 'div', undefined, 'ars-pins');
    for (const pin of state.pins.filter(item => item.profile_id === profile.id)) {
      const task = savedTasks().find(item => item.id === pin.task_id);
      make(pinned, 'p', `${task?.title || pin.task_id} · ${pin.host} · v${pin.version} · ${pin.content_sha256.slice(0, 12)} · sem execução`, 'ars-hint');
    }
  }
  function renderDetail() {
    detail.replaceChildren();
    if (!state.selectedId) return make(detail, 'p', 'Selecione um perfil para ver todas as regras, fontes e configurações herdadas.', 'ars-hint');
    const row = rowById(state.selectedId);
    if (!row) { state.preview = null; state.selectedId = null; return make(detail, 'p', 'Este perfil não está neste projeto.', 'ars-hint'); }
    const header = make(detail, 'div', undefined, 'ars-detail-head');
    make(header, 'h3', row.name);
    const versionLabel = make(header, 'label', 'Versão ', 'ars-inline'), versions = make(versionLabel, 'select');
    for (let number = 1; number <= row.latest_version; number++) selectOption(versions, String(number), `v${number}`);
    versions.value = String(state.selectedVersion || row.latest_version);
    versions.disabled = state.busy;
    versions.addEventListener('change', () => openProfile(row.id, Number(versions.value)));
    const preview = state.preview;
    if (!preview || preview.profile.id !== row.id || preview.profile.version !== state.selectedVersion) return make(detail, 'p', 'Carregando prévia…', 'ars-hint');
    const profile = preview.profile;
    make(detail, 'p', `${PILLARS[profile.pillar] || profile.pillar} · v${profile.version} · ${preview.review ? 'revisada' : 'rascunho'} · ${row.active_version === profile.version ? 'ativa' : 'não ativa'} · hash ${preview.content_sha256}`, 'ars-meta');
    make(detail, 'p', profile.purpose, 'ars-purpose');
    make(detail, 'p', `Autoridade: ${profile.authority} · executável: não`, 'ars-hint');
    const metadata = make(detail, 'div', undefined, 'ars-metadata');
    for (const [label, values] of [['Hosts sugeridos', profile.suggested_hosts], ['Intenções', profile.intents], ['Skills', profile.skills], ['Ferramentas', profile.tools], ['Contexto', profile.context], ['Entradas', profile.inputs], ['Saídas', profile.outputs]]) summaryList(metadata, label, values);
    const cases = make(detail, 'section', undefined, 'ars-cases'); make(cases, 'h4', 'Casos de roteamento declarados');
    for (const item of profile.test_cases) make(cases, 'p', `${item.matches ? 'Inclui' : 'Exclui'} · ${item.intent}`, 'ars-hint');
    const provenance = make(detail, 'section', undefined, 'ars-provenance'); make(provenance, 'h4', 'Proveniência completa');
    make(provenance, 'p', `Método: ${profile.provenance.method} · fontes selecionadas: ${profile.provenance.selected_source_ids.join(', ')}`, 'ars-meta');
    if (profile.provenance.template) make(provenance, 'p', `Template: ${profile.provenance.template.id} v${profile.provenance.template.version} · ${profile.provenance.template.sha256}`, 'ars-meta');
    for (const source of profile.provenance.sources) make(provenance, 'p', `${source.id} · ${source.kind} · ${source.reference} · sessão ${source.session_id || 'autoria'} · SHA-256 ${source.sha256}`, 'ars-meta');
    const reviewArea = make(detail, 'section', undefined, 'ars-review');
    make(reviewArea, 'h4', 'Regras e verificação de cada fonte');
    const ruleChecks = [];
    for (const rule of preview.rules) {
      const box = make(reviewArea, 'article', undefined, 'ars-rule');
      make(box, 'strong', rule.id); make(box, 'p', rule.text);
      make(box, 'p', `Fontes desta regra: ${rule.source_ids.join(', ')}`, 'ars-meta');
      for (const source of rule.sources) make(box, 'small', `${source.id} · ${source.kind} · ${source.reference} · SHA-256 ${source.sha256}`);
      if (!preview.review) {
        const label = make(box, 'label', 'Confirmei esta regra e suas fontes ', 'ars-check');
        const check = make(label, 'input'); check.type = 'checkbox'; check.disabled = state.busy; ruleChecks.push([rule.id, check]);
      }
    }
    if (!preview.review) {
      const label = make(reviewArea, 'label', 'Também revisei finalidade, hosts, skills, ferramentas, contexto e exemplos herdados ', 'ars-check');
      const settingsCheck = make(label, 'input'); settingsCheck.type = 'checkbox'; settingsCheck.disabled = state.busy;
      const reviewButton = button(reviewArea, 'Registrar revisão desta versão', () => {
        if (!settingsCheck.checked || ruleChecks.some(([, check]) => !check.checked)) return say('Confirme cada regra e todas as configurações herdadas antes de registrar a revisão.');
        const sourceRules = Object.fromEntries(preview.rules.map(rule => [rule.id, rule.source_ids]));
        void mutate('review', { profileId: profile.id, version: profile.version, contentSha256: preview.content_sha256,
          sourceRules, reviewedRuleIds: ruleChecks.map(([id]) => id), reviewedSettings: true });
      }, 'button');
      reviewButton.disabled = state.busy;
      make(reviewArea, 'p', 'A identidade desta revisão é uma declaração do usuário local, não uma prova criptográfica.', 'ars-hint');
    } else make(reviewArea, 'p', `Revisão registrada em ${preview.review.at} · sequência ${preview.review.sequence}.`, 'ars-hint');
    const actions = make(detail, 'div', undefined, 'ars-actions');
    if (preview.review && row.active_version !== profile.version) {
      const activate = button(actions, 'Ativar esta versão', () => mutate('activate', { profileId: profile.id, version: profile.version }), 'button'); activate.disabled = state.busy;
      if (row.active_version && profile.version < row.active_version) {
        const rollback = button(actions, 'Restaurar versão anterior', () => mutate('rollback', { profileId: profile.id, version: profile.version })); rollback.disabled = state.busy;
      }
    }
    if (row.active_version) { const disable = button(actions, 'Desativar perfil', () => mutate('disable', { profileId: profile.id })); disable.disabled = state.busy; }
    if (row.active_version && profile.version === row.active_version) renderPin(detail, profile, row);
  }
  function renderSources() {
    sources.replaceChildren();
    make(sources, 'h3', 'Criar perfil a partir de notas selecionadas');
    make(sources, 'p', 'Apenas notas de sessão marcadas entram na derivação. Texto rejeitado, citado ou experimental vira somente proveniência; decisão aceita vira regra literal.', 'ars-hint');
    const sessionGroup = make(sources, 'div', undefined, 'ars-session-grid');
    const sessionControls = [];
    for (const session of savedSessions()) {
      const label = make(sessionGroup, 'label', session.name, 'ars-check');
      const check = make(label, 'input'); check.type = 'checkbox'; check.checked = state.sessions.has(session.id); check.disabled = state.busy;
      check.addEventListener('change', () => {
        if (check.checked) state.sessions.add(session.id); else state.sessions.delete(session.id);
        state.notes = []; state.sourcesSeq++; renderSources();
        say('Seleção de sessões alterada; carregue as notas novamente antes de derivar.');
      });
      sessionControls.push({ id: session.id, check });
    }
    const loadButton = button(sources, 'Carregar notas das sessões marcadas', () => {
      const ids = sessionControls.filter(({ check }) => check.checked).map(({ id }) => id);
      void loadSources(ids);
    });
    loadButton.disabled = state.busy || !savedSessions().length;
    const noteArea = make(sources, 'div', undefined, 'ars-notes');
    const controls = [];
    for (const note of state.notes) {
      const card = make(noteArea, 'article', undefined, 'ars-note');
      const choose = make(card, 'label', 'Selecionar nota ', 'ars-check'), selected = make(choose, 'input'); selected.type = 'checkbox'; selected.disabled = state.busy;
      make(card, 'p', note.text); make(card, 'small', `Sessão ${note.sessionId} · revisão ${note.revision} · ${note.source}`);
      const kindLabel = make(card, 'label', 'Classificação ', 'ars-field'), kind = make(kindLabel, 'select');
      for (const [value, label] of Object.entries(KINDS)) selectOption(kind, value, label);
      const safeLabel = make(card, 'label', 'Revisei e removi dados privados desta nota ', 'ars-check'), sanitized = make(safeLabel, 'input'); sanitized.type = 'checkbox';
      kind.disabled = sanitized.disabled = state.busy; controls.push({ note, selected, kind, sanitized });
    }
    if (!state.notes.length) make(noteArea, 'p', 'Marque uma ou mais sessões e carregue suas notas; nenhuma é promovida automaticamente.', 'ars-hint');
    const form = make(sources, 'div', undefined, 'ars-derive-form');
    const templateLabel = make(form, 'label', 'Template original instalado ', 'ars-field'), template = make(templateLabel, 'select');
    selectOption(template, '', 'Selecione um template');
    for (const profile of state.builtins) selectOption(template, profile.id, profile.name);
    const profileId = field(form, 'ID do novo perfil (ou ID do template para nova versão)', 80);
    const name = field(form, 'Nome da versão candidata', 100);
    const derive = button(form, 'Gerar rascunho para revisão', () => {
      const chosen = controls.filter(item => item.selected.checked);
      if (!template.value || !idPattern.test(profileId.value) || !name.value.trim() || chosen.length < 1 || chosen.length > 16 || !chosen.some(item => item.kind.value === 'accepted_decision') || chosen.some(item => !item.sanitized.checked)) {
        return say('Escolha template, ID válido, nome, 1–16 notas, ao menos uma decisão aceita e confirme a sanitização de cada nota.');
      }
      void mutate('derive', { templateId: template.value, profileId: profileId.value, name: name.value.trim(),
        selectedSourceIds: chosen.map(item => item.note.id),
        selections: chosen.map(item => ({ noteId: item.note.id, sessionId: item.note.sessionId, expectedRevision: item.note.revision,
          kind: item.kind.value, sanitized: true })) });
    }, 'button'); derive.disabled = state.busy || !state.builtins.length;
  }
  async function loadSources(ids) {
    if (state.projectId !== getProjectId()) return sync();
    if (!state.projectId || state.busy) return;
    if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length) return say('Marque de uma a oito sessões deste projeto.');
    if (ids.some(id => !savedSessions().some(session => session.id === id))) return say('Seleção de sessão inválida para este projeto.');
    state.sessions = new Set(ids); const current = ticket(), seq = ++state.sourcesSeq;
    const params = new URLSearchParams({ projectId: state.projectId }); for (const id of ids) params.append('sessionId', id);
    say('Carregando notas das sessões selecionadas…');
    try {
      const result = await api(`/api/arsenal/sources?${params}`);
      if (!current() || seq !== state.sourcesSeq) return;
      if (result?.projectId !== state.projectId || !Array.isArray(result.notes) || result.notes.some(note => !ids.includes(note.sessionId))) throw Error('Resposta de notas inválida.');
      state.notes = result.notes; renderSources(); say(`${state.notes.length} notas disponíveis. Selecione explicitamente cada fonte.`);
    } catch (error) { if (current() && seq === state.sourcesSeq) say(failure(error)); }
  }
  function focusTask(taskId) {
    if (state.projectId !== getProjectId()) sync();
    if (!savedTasks().some(task => task.id === taskId)) return false;
    state.focusedTaskId = taskId; renderDetail(); return true;
  }
  sync();
  return { sync, load, refresh: load, focusTask, destroy() { state.destroyed = true; state.epoch++; root.replaceChildren(); } };
}
