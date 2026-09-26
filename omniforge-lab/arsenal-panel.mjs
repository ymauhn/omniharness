// Project-scoped agent profiles. This panel records reviewed metadata; it never
// starts a model, grants host permissions or copies a session transcript.
const PILLARS = { engineering: 'Engenharia', 'orchestration-os': 'Orquestração', 'science-thesis': 'Ciência', 'education-community': 'Educação', 'technical-marketing': 'Marketing técnico' };
const KINDS = { experiment: 'Experimento (proveniência)', rejected: 'Rejeitado (proveniência)', quoted: 'Citação (proveniência)', accepted_decision: 'Decisão aceita (vira regra)' };
const HOSTS = { codex: 'Codex', claude: 'Claude', hermes: 'Hermes' };
const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const query = (projectId, other = {}) => `?${new URLSearchParams({ projectId, ...other })}`;
const failure = error => error?.status === 409 ? 'Conflito de revisão: recarregue e confira o estado atual antes de tentar novamente.'
  : [400, 404, 423, 503, 507].includes(error?.status) ? error.message : 'Operação não confirmada. Confira a conexão e atualize o arsenal.';
const emptyForm = () => ({ template: '', profileId: '', name: '' });

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
    selectedVersion: null, sessions: new Set(), notes: [], notesTotal: 0, hosts: [], focusedTaskId: null, pinHost: null, destroyed: false,
    // Unsaved input survives every re-render: note choices by id@revision, rule checks by content hash.
    choices: new Map(), form: emptyForm(), reviewed: new Set(), focusKey: null };
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
    state.sessions = new Set(); state.notes = []; state.notesTotal = 0; state.focusedTaskId = null; state.pinHost = null;
    state.choices = new Map(); state.form = emptyForm(); state.reviewed = new Set(); state.focusKey = null;
    library.replaceChildren(); detail.replaceChildren(); sources.replaceChildren();
    say(state.projectId ? 'Carregando arsenal deste projeto…' : 'Selecione um projeto.');
    reload.disabled = !state.projectId;
    render();
    if (state.projectId) void load();
  }
  // Every render rebuilds the controls; return keyboard focus to the equivalent
  // one (data-ars-key), or to the profile heading when that control is gone.
  function render() {
    const active = doc.activeElement;
    if (active && root.contains(active)) state.focusKey = active.dataset?.arsKey || null;
    else if (active && active !== doc.body) state.focusKey = null; // Never pull focus back from elsewhere.
    renderLibrary(); renderDetail(); renderSources();
    if (!state.focusKey || state.busy) return; // Controls are disabled while busy; restore afterwards.
    const target = [...root.querySelectorAll('button,input,select,h3')].find(node => node.dataset.arsKey === state.focusKey && !node.disabled)
      || detail.querySelectorAll('h3')[0];
    state.focusKey = null; target?.focus();
  }
  const keyed = (node, key) => { node.dataset.arsKey = key; return node; };
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
      render();
      say(`${state.snapshot.profiles.length} perfis no projeto · ${state.pins.length} vínculos de tarefa. Nenhum modelo foi iniciado.`);
    } catch (error) { if (current() && seq === state.loadSeq) say(failure(error)); }
  }
  async function mutate(op, data, after) {
    if (state.projectId !== getProjectId()) { sync(); return; }
    if (!state.projectId || state.busy || state.destroyed) return;
    const current = ticket(), projectId = state.projectId;
    state.busy = true; state.loadSeq++; state.previewSeq++;
    render();
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
      render();
      say(result.pin ? 'Perfil ativo vinculado à tarefa como metadado. Nenhum agente foi executado.' : 'Alteração salva no registro versionado.');
      onChanged({ projectId, snapshot: state.snapshot, pins: state.pins });
      if (after) after(result);
    } catch (error) { if (current()) say(failure(error)); }
    finally { if (current()) { state.busy = false; render(); } }
  }
  async function openProfile(id, version) {
    if (state.projectId !== getProjectId()) return sync();
    if (!state.projectId || state.busy) return;
    state.selectedId = id; state.selectedVersion = version; state.preview = null;
    render();
    const current = ticket(), seq = ++state.previewSeq;
    say(`Carregando versão ${version}…`);
    try {
      const preview = await api(`/api/arsenal/${encodeURIComponent(id)}${query(state.projectId, { version })}`);
      if (!current() || seq !== state.previewSeq || state.selectedId !== id || state.selectedVersion !== version) return;
      if (preview?.profile?.id !== id || preview.profile.version !== version) throw Error('Prévia inválida.');
      state.preview = preview; render(); say(`Versão ${version} · ${preview.review ? 'revisada' : 'rascunho sem revisão'}.`);
    } catch (error) { if (current() && seq === state.previewSeq) say(failure(error)); }
  }
  function renderLibrary() {
    library.replaceChildren();
    make(library, 'h3', 'Templates instalados · importar como rascunho');
    for (const profile of state.builtins) {
      const item = make(library, 'div', undefined, 'ars-list-item');
      make(item, 'strong', profile.name); make(item, 'small', `${PILLARS[profile.pillar] || profile.pillar} · ${profile.id}`);
      const imported = !!rowById(profile.id);
      const importButton = keyed(button(item, imported ? 'Já importado' : 'Importar rascunho', () => mutate('import', { builtinId: profile.id })), `import:${profile.id}`);
      importButton.disabled = state.busy || imported;
    }
    make(library, 'h3', `No projeto · ${state.snapshot.profiles.length}`);
    if (!state.snapshot.profiles.length) make(library, 'p', 'Nenhum perfil salvo neste projeto.', 'ars-hint');
    for (const row of state.snapshot.profiles) {
      const item = keyed(button(library, `${row.name} · última v${row.latest_version} · ativa ${row.active_version ? `v${row.active_version}` : 'nenhuma'}`, () => openProfile(row.id, row.latest_version), 'ars-profile'), `profile:${row.id}`);
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
    const taskLabel = make(area, 'label', 'Tarefa deste projeto', 'ars-field'), taskSelect = keyed(make(taskLabel, 'select'), 'pin-task');
    selectOption(taskSelect, '', 'Selecione uma tarefa');
    for (const task of savedTasks()) {
      const pin = pinByTask(task.id);
      const option = selectOption(taskSelect, task.id, `${task.title}${pin ? ' · já vinculada' : ''}`);
      option.disabled = !!pin;
    }
    if (state.focusedTaskId && !pinByTask(state.focusedTaskId) && savedTasks().some(task => task.id === state.focusedTaskId)) taskSelect.value = state.focusedTaskId;
    taskSelect.addEventListener('change', () => { state.focusedTaskId = taskSelect.value || null; });
    const hostLabel = make(area, 'label', 'Host preferido (disponibilidade verificada no servidor)', 'ars-field'), hostSelect = keyed(make(hostLabel, 'select'), 'pin-host');
    for (const host of profile.suggested_hosts) {
      const available = state.hosts.includes(host);
      const option = selectOption(hostSelect, host, `${HOSTS[host] || host}${available ? '' : ' · indisponível'}`);
      option.disabled = !available;
    }
    const firstAvailable = profile.suggested_hosts.find(host => state.hosts.includes(host));
    if (firstAvailable) hostSelect.value = state.hosts.includes(state.pinHost) && profile.suggested_hosts.includes(state.pinHost) ? state.pinHost : firstAvailable;
    hostSelect.addEventListener('change', () => { state.pinHost = hostSelect.value; });
    const pinButton = keyed(button(area, 'Vincular à tarefa', () => {
      if (!taskSelect.value || pinByTask(taskSelect.value) || !state.hosts.includes(hostSelect.value)) return say('Selecione uma tarefa sem vínculo e um host disponível.');
      void mutate('pin', { profileId: profile.id, taskId: taskSelect.value, host: hostSelect.value });
    }, 'button'), 'pin');
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
    keyed(make(header, 'h3', row.name), 'heading').tabIndex = -1;
    const versionLabel = make(header, 'label', 'Versão ', 'ars-inline'), versions = keyed(make(versionLabel, 'select'), 'version');
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
    const reviewCheck = (label, key) => {
      const check = keyed(make(label, 'input'), key); check.type = 'checkbox'; check.disabled = state.busy;
      const reviewed = `${preview.content_sha256}:${key}`; check.checked = state.reviewed.has(reviewed);
      check.addEventListener('change', () => { if (check.checked) state.reviewed.add(reviewed); else state.reviewed.delete(reviewed); });
      return check;
    };
    for (const rule of preview.rules) {
      const box = make(reviewArea, 'article', undefined, 'ars-rule');
      make(box, 'strong', rule.id); make(box, 'p', rule.text);
      make(box, 'p', `Fontes desta regra: ${rule.source_ids.join(', ')}`, 'ars-meta');
      for (const source of rule.sources) make(box, 'small', `${source.id} · ${source.kind} · ${source.reference} · SHA-256 ${source.sha256}`);
      if (!preview.review) ruleChecks.push([rule.id, reviewCheck(make(box, 'label', `Confirmei a regra ${rule.id} e suas fontes `, 'ars-check'), `rule:${rule.id}`)]);
    }
    if (!preview.review) {
      const settingsCheck = reviewCheck(make(reviewArea, 'label', 'Também revisei finalidade, hosts, skills, ferramentas, contexto e exemplos herdados ', 'ars-check'), 'settings');
      const reviewButton = keyed(button(reviewArea, 'Registrar revisão desta versão', () => {
        if (!settingsCheck.checked || ruleChecks.some(([, check]) => !check.checked)) return say('Confirme cada regra e todas as configurações herdadas antes de registrar a revisão.');
        const sourceRules = Object.fromEntries(preview.rules.map(rule => [rule.id, rule.source_ids]));
        void mutate('review', { profileId: profile.id, version: profile.version, contentSha256: preview.content_sha256,
          sourceRules, reviewedRuleIds: ruleChecks.map(([id]) => id), reviewedSettings: true });
      }, 'button'), 'review');
      reviewButton.disabled = state.busy;
      make(reviewArea, 'p', 'A identidade desta revisão é uma declaração do usuário local, não uma prova criptográfica.', 'ars-hint');
    } else make(reviewArea, 'p', `Revisão registrada em ${preview.review.at} · sequência ${preview.review.sequence}.`, 'ars-hint');
    const actions = make(detail, 'div', undefined, 'ars-actions');
    if (preview.review && row.active_version !== profile.version) {
      const activate = keyed(button(actions, 'Ativar esta versão', () => mutate('activate', { profileId: profile.id, version: profile.version }), 'button'), 'activate'); activate.disabled = state.busy;
      if (row.active_version && profile.version < row.active_version) {
        const rollback = keyed(button(actions, 'Restaurar versão anterior', () => mutate('rollback', { profileId: profile.id, version: profile.version })), 'rollback'); rollback.disabled = state.busy;
      }
    }
    if (row.active_version) { const disable = keyed(button(actions, 'Desativar perfil', () => mutate('disable', { profileId: profile.id })), 'disable'); disable.disabled = state.busy; }
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
      const check = keyed(make(label, 'input'), `session:${session.id}`); check.type = 'checkbox'; check.checked = state.sessions.has(session.id); check.disabled = state.busy;
      check.addEventListener('change', () => {
        if (check.checked) state.sessions.add(session.id); else state.sessions.delete(session.id);
        state.notes = []; state.notesTotal = 0; state.choices = new Map(); state.sourcesSeq++; render();
        say('Seleção de sessões alterada; carregue as notas novamente antes de derivar.');
      });
      sessionControls.push({ id: session.id, check });
    }
    const loadButton = keyed(button(sources, 'Carregar notas das sessões marcadas', () => {
      const ids = sessionControls.filter(({ check }) => check.checked).map(({ id }) => id);
      void loadSources(ids);
    }), 'load-notes');
    loadButton.disabled = state.busy || !savedSessions().length;
    const noteArea = make(sources, 'div', undefined, 'ars-notes');
    if (state.notesTotal > state.notes.length) make(noteArea, 'p', `Mostrando as ${state.notes.length} notas mais recentes de ${state.notesTotal}; as mais antigas ficaram de fora. Marque menos sessões para alcançá-las.`, 'ars-hint');
    const controls = [];
    state.notes.forEach((note, index) => {
      const card = make(noteArea, 'article', undefined, 'ars-note'), number = index + 1, key = `${note.id}@${note.revision}`;
      const choice = state.choices.get(key) || { selected: false, kind: 'experiment', sanitized: false };
      const choose = make(card, 'label', `Selecionar nota ${number} `, 'ars-check'), selected = keyed(make(choose, 'input'), `note:${key}:selected`); selected.type = 'checkbox';
      make(card, 'p', note.text).id = `ars-note-${number}`; make(card, 'small', `Sessão ${note.sessionId} · revisão ${note.revision} · ${note.source}`);
      const kindLabel = make(card, 'label', `Classificação da nota ${number} `, 'ars-field'), kind = keyed(make(kindLabel, 'select'), `note:${key}:kind`);
      for (const [value, label] of Object.entries(KINDS)) selectOption(kind, value, label);
      const safeLabel = make(card, 'label', `Revisei e removi dados privados da nota ${number} `, 'ars-check'), sanitized = keyed(make(safeLabel, 'input'), `note:${key}:sanitized`); sanitized.type = 'checkbox';
      selected.checked = choice.selected; kind.value = choice.kind; sanitized.checked = choice.sanitized;
      for (const control of [selected, kind, sanitized]) {
        control.disabled = state.busy; control.setAttribute('aria-describedby', `ars-note-${number}`);
        control.addEventListener('change', () => state.choices.set(key, { selected: selected.checked, kind: kind.value, sanitized: sanitized.checked }));
      }
      controls.push({ note, selected, kind, sanitized });
    });
    if (!state.notes.length) make(noteArea, 'p', 'Marque uma ou mais sessões e carregue suas notas; nenhuma é promovida automaticamente.', 'ars-hint');
    const form = make(sources, 'div', undefined, 'ars-derive-form');
    const templateLabel = make(form, 'label', 'Template original instalado ', 'ars-field'), template = keyed(make(templateLabel, 'select'), 'template');
    selectOption(template, '', 'Selecione um template');
    for (const profile of state.builtins) selectOption(template, profile.id, profile.name);
    const profileId = keyed(field(form, 'ID do novo perfil (ou de um perfil já importado, para nova versão)', 80), 'profile-id');
    const name = keyed(field(form, 'Nome da versão candidata', 100), 'name');
    template.value = state.form.template; profileId.value = state.form.profileId; name.value = state.form.name;
    template.addEventListener('change', () => { state.form.template = template.value; });
    profileId.addEventListener('input', () => { state.form.profileId = profileId.value; });
    name.addEventListener('input', () => { state.form.name = name.value; });
    const derive = keyed(button(form, 'Gerar rascunho para revisão', () => {
      const chosen = controls.filter(item => item.selected.checked);
      if (!template.value || !idPattern.test(profileId.value) || !name.value.trim() || chosen.length < 1 || chosen.length > 16 || !chosen.some(item => item.kind.value === 'accepted_decision') || chosen.some(item => !item.sanitized.checked)) {
        return say('Escolha template, ID válido, nome, 1–16 notas, ao menos uma decisão aceita e confirme a sanitização de cada nota.');
      }
      // The bridge extends only an imported profile; a template ID alone is refused.
      if (state.builtins.some(item => item.id === profileId.value) && !rowById(profileId.value)) return say('Importe esse template antes de criar uma nova versão dele, ou use um ID novo.');
      void mutate('derive', { templateId: template.value, profileId: profileId.value, name: name.value.trim(),
        selectedSourceIds: chosen.map(item => item.note.id),
        selections: chosen.map(item => ({ noteId: item.note.id, sessionId: item.note.sessionId, expectedRevision: item.note.revision,
          kind: item.kind.value, sanitized: true })) }, () => { state.choices = new Map(); state.form = emptyForm(); });
    }, 'button'), 'derive'); derive.disabled = state.busy || !state.builtins.length;
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
      state.notes = result.notes; state.notesTotal = Number.isSafeInteger(result.total) ? result.total : result.notes.length; render();
      say(`${state.notes.length} notas disponíveis${state.notesTotal > state.notes.length ? ` de ${state.notesTotal}` : ''}. Selecione explicitamente cada fonte.`);
    } catch (error) { if (current() && seq === state.sourcesSeq) say(failure(error)); }
  }
  function focusTask(taskId) {
    if (state.projectId !== getProjectId()) sync();
    if (!savedTasks().some(task => task.id === taskId)) return false;
    state.focusedTaskId = taskId; render(); return true;
  }
  sync();
  return { sync, load, refresh: load, focusTask, destroy() { state.destroyed = true; state.epoch++; root.replaceChildren(); } };
}
