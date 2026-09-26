const binding = note => ({ scope: note.scope, projectId: note.projectId ?? null, sessionId: note.sessionId ?? null });
const query = value => new URLSearchParams(Object.entries(value).filter(([, item]) => item !== null));
const visible = (note, projectId, sessionId) => note.scope === 'global' || note.projectId === projectId &&
  (note.scope === 'project' || note.scope === 'session' && note.sessionId === sessionId);

export class MemoryPanelController {
  constructor({ api, changed = () => {}, notify = () => {} }) {
    Object.assign(this, { api, changed, notify, projectId: null, sessionId: null, includeArchived: false,
      generation: 0, request: 0, notes: [], editor: null, history: null, message: '', busy: false });
  }
  select(projectId, sessionId = null, includeArchived = this.includeArchived) {
    if (projectId === this.projectId && sessionId === this.sessionId && includeArchived === this.includeArchived) return false;
    Object.assign(this, { projectId, sessionId, includeArchived, notes: [], loading: true, editor: null, history: null, busy: false, message: '' });
    this.generation++; this.request++; this.notify();
    return true;
  }
  async load() {
    const generation = this.generation, request = ++this.request;
    const current = () => generation === this.generation && request === this.request;
    try {
      const result = await this.api(`/api/memory?${query({ projectId: this.projectId, sessionId: this.sessionId, includeArchived: this.includeArchived })}`);
      if (!current()) return;
      this.notes = (result.notes || []).filter(note => visible(note, this.projectId, this.sessionId) && (this.includeArchived || !note.archivedAt));
      if (this.editor && this.notes.find(note => note.id === this.editor.note.id)?.revision !== this.editor.note.revision) {
        this.message = 'Esta nota mudou em outra sessão. Seu rascunho foi preservado; consulte a versão atual antes de salvar.';
      }
    } catch (error) { if (current()) this.message = error.message; }
    if (current()) { this.loading = false; this.notify(); }
  }
  edit(id, kind = 'update') {
    const note = this.notes.find(item => item.id === id);
    if (this.busy || !note || note.archivedAt || !['update', 'archive'].includes(kind)) return;
    this.editor = { note: structuredClone(note), text: note.text, source: note.source, kind };
    this.message = ''; this.history = null; this.notify();
  }
  cancel() { if (!this.busy) { this.editor = null; this.message = ''; this.notify(); } }
  async save() {
    const editor = this.editor, generation = this.generation;
    if (!editor || this.busy) return;
    const current = () => generation === this.generation && this.editor === editor;
    this.busy = true; this.message = ''; this.notify();
    try {
      const body = { ...binding(editor.note), expectedRevision: editor.note.revision, source: editor.source };
      if (editor.kind === 'update') body.text = editor.text;
      await this.api(`/api/memory/${encodeURIComponent(editor.note.id)}/${editor.kind}`, { method: 'POST', body });
      // The original scope may have changed while the request was in flight.
      if (!current()) return;
      this.editor = null; this.busy = false;
      this.message = editor.kind === 'archive' ? 'Nota arquivada; histórico preservado.' : 'Nova revisão salva.';
      this.changed(); await this.load();
    } catch (error) {
      if (current()) this.message = error.status === 409 ? 'Conflito: nenhuma substituição foi feita. Seu rascunho continua aqui; cancele e reabra a nota para usar a versão atual.' : error.message;
    } finally { if (generation === this.generation) { this.busy = false; this.notify(); } }
  }
  async inspect(id, offset = 0) {
    const note = this.notes.find(item => item.id === id) || (this.history?.id === id ? this.history.note : null), generation = this.generation;
    if (!note || this.busy) return;
    const selection = { id, note, offset, total: 0, hasMore: false, loading: true, status: 'Carregando histórico…', rows: [] };
    this.history = selection; this.notify();
    try {
      const result = await this.api(`/api/memory/${encodeURIComponent(id)}/history?${query({ ...binding(note), offset, limit: 20 })}`);
      if (generation !== this.generation || this.history !== selection) return;
      if (result.noteId !== id || result.offset !== offset || result.limit !== 20 || !Array.isArray(result.history) || result.history.length > 20 || !Number.isSafeInteger(result.total) || result.total < 0 || typeof result.hasMore !== 'boolean') throw Error('Página de histórico inválida');
      selection.rows = result.history; selection.total = result.total; selection.hasMore = result.hasMore; selection.status = '';
    } catch (error) { if (generation === this.generation && this.history === selection) selection.status = error.message; }
    selection.loading = false;
    if (generation === this.generation && this.history === selection) this.notify();
  }
}

export function mountMemoryPanel({ root, api, getProjectId, getSessions, onChanged = () => {} }) {
  const doc = root.ownerDocument;
  const make = (tag, text, parent = root) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; parent.append(node); return node; };
  const controls = make('div'); controls.className = 'memory-tools';
  const selectLabel = make('label', 'Notas de uma sessão ', controls), sessions = make('select', undefined, selectLabel);
  const archiveLabel = make('label', undefined, controls), archives = make('input', undefined, archiveLabel); archives.type = 'checkbox'; make('span', 'Incluir arquivadas', archiveLabel);
  const refresh = make('button', 'Atualizar', controls); refresh.type = 'button'; refresh.className = 'secondary';
  const message = make('p'); message.className = 'microcopy'; message.setAttribute('role', 'status');
  const list = make('div'), editorHost = make('div'), historyStatus = make('p'), historyHost = make('div');
  historyStatus.setAttribute('role', 'status');
  let editorRendered = null, revision, sessionSignature, shown = 40, renderedHistory, renderedRows, renderedStatus;
  const controller = new MemoryPanelController({ api, changed: onChanged, notify: render });
  function button(parent, text, fn) { const node = make('button', text, parent); node.type = 'button'; node.className = 'secondary'; node.addEventListener('click', fn); return node; }
  function render() {
    message.textContent = controller.message;
    const focused = list.contains(doc.activeElement) ? doc.activeElement?.dataset?.memoryAction : null;
    list.replaceChildren();
    if (!controller.notes.length) make('p', controller.loading ? 'Carregando notas…' : 'Nenhuma nota visível nesta seleção.', list).className = 'empty';
    for (const note of controller.notes.slice().reverse().slice(0, shown)) {
      const row = make('article', undefined, list); row.className = 'list-item';
      make('p', note.text, row);
      make('small', `${note.scope} · revisão ${note.revision} · ${note.source}${note.archivedAt ? ' · arquivada' : ''}`, row);
      const actions = make('div', undefined, row); actions.className = 'memory-tools';
      if (!note.archivedAt) {
        const edit = button(actions, 'Editar', () => controller.edit(note.id)); edit.disabled = controller.busy; edit.dataset.memoryAction = `${note.id}:edit`;
        const archive = button(actions, 'Arquivar…', () => controller.edit(note.id, 'archive')); archive.disabled = controller.busy; archive.dataset.memoryAction = `${note.id}:archive`;
      }
      const history = button(actions, 'Histórico', () => controller.inspect(note.id)); history.disabled = controller.busy; history.dataset.memoryAction = `${note.id}:history`;
    }
    if (controller.notes.length > shown) button(list, `Mostrar mais (${shown} de ${controller.notes.length})`, () => { shown += 40; render(); });
    if (focused) [...list.querySelectorAll('button')].find(node => node.dataset.memoryAction === focused && !node.disabled)?.focus();
    const editor = controller.editor;
    if (editorRendered !== editor) {
      // A closed editor (saved or cancelled) hands keyboard focus back to its note, not to a detached or disabled control.
      const closed = editorRendered && !editor && (!doc.activeElement || doc.activeElement === doc.body || editorHost.contains(doc.activeElement)) ? editorRendered.note.id : null;
      editorRendered = editor; editorHost.replaceChildren();
      if (closed) ([...list.querySelectorAll('button')].find(node => node.dataset.memoryAction?.startsWith(`${closed}:`) && !node.disabled) || refresh).focus();
      if (editor) {
        const form = make('form', undefined, editorHost); form.className = 'memory-editor';
        make('h3', `${editor.kind === 'archive' ? 'Arquivar' : 'Editar'} revisão ${editor.note.revision}`, form);
        if (editor.kind === 'archive') make('p', 'A nota sai do contexto ativo. O texto e todas as revisões continuam no histórico.', form);
        else {
          const label = make('label', 'Texto ', form), text = make('textarea', undefined, label); text.value = editor.text; text.maxLength = 4000; text.required = true;
          text.addEventListener('input', () => { editor.text = text.value; });
        }
        const label = make('label', 'Fonte desta alteração ', form), source = make('input', undefined, label); source.value = editor.source; source.maxLength = 300; source.required = true;
        source.addEventListener('input', () => { editor.source = source.value; });
        const submit = make('button', editor.kind === 'archive' ? 'Confirmar arquivamento' : 'Salvar revisão', form); submit.type = 'submit'; submit.className = 'button';
        button(form, 'Cancelar rascunho', () => controller.cancel());
        form.addEventListener('submit', event => { event.preventDefault(); void controller.save(); });
        (form.querySelector('textarea') || source).focus();
      }
    }
    for (const input of editorHost.querySelectorAll('input,textarea,button')) input.disabled = controller.busy;
    const history = controller.history;
    historyStatus.textContent = history?.status || '';
    // Keep live controls while a page loads; ordinary note refreshes must not
    // rebuild an unchanged history and detach keyboard focus/open revisions.
    if (history?.loading && history.id === renderedHistory?.id) return;
    if (history === renderedHistory && history?.rows === renderedRows && history?.status === renderedStatus) return;
    const historyFocused = historyHost.contains(doc.activeElement), historyAction = historyFocused ? doc.activeElement?.dataset?.historyAction : null;
    renderedHistory = history; renderedRows = history?.rows; renderedStatus = history?.status;
    historyHost.replaceChildren();
    if (history) {
      const heading = make('h3', 'Histórico preservado', historyHost); heading.tabIndex = -1;
      if (history.status) make('p', history.status, historyHost);
      else {
        const page = history;
        make('p', `Revisões ${page.rows.length ? page.offset + 1 : 0}–${page.offset + page.rows.length} de ${page.total}`, historyHost);
        const pages = make('div', undefined, historyHost); pages.className = 'memory-tools';
        const previous = button(pages, 'Revisões anteriores', () => controller.inspect(page.id, Math.max(0, page.offset - 20))); previous.disabled = page.offset === 0; previous.dataset.historyAction = 'previous';
        const next = button(pages, 'Próximas revisões', () => controller.inspect(page.id, page.offset + 20)); next.disabled = !page.hasMore; next.dataset.historyAction = 'next';
      }
      for (const version of history.rows.slice().reverse()) {
        const detail = make('details', undefined, historyHost);
        make('summary', `Revisão ${version.revision} · ${version.operation} · ${version.updatedAt}`, detail).dataset.historyAction = `revision:${version.revision}`;
        make('p', version.text, detail); make('small', version.source, detail);
      }
      if (historyFocused) ([...historyHost.querySelectorAll('button,summary')].find(node => node.dataset.historyAction === historyAction && !node.disabled) || heading).focus();
    }
  }
  const choose = () => { shown = 40; controller.select(getProjectId(), sessions.value || null, archives.checked); void controller.load(); };
  sessions.addEventListener('change', choose); archives.addEventListener('change', choose);
  refresh.addEventListener('click', () => controller.load());
  return {
    load: () => controller.load(),
    sync(memoryRevision) {
      const projectId = getProjectId(), rows = getSessions().filter(session => session.projectId === projectId);
      const signature = JSON.stringify([projectId, rows.map(({ id, name }) => [id, name])]);
      const selected = rows.some(session => session.id === controller.sessionId) ? controller.sessionId : null;
      if (signature !== sessionSignature) {
        sessionSignature = signature; sessions.replaceChildren();
        make('option', 'Globais + projeto', sessions).value = '';
        for (const session of rows) make('option', session.name, sessions).value = session.id;
        sessions.value = selected || '';
      }
      if (projectId !== controller.projectId || selected !== controller.sessionId) shown = 40;
      const changed = controller.select(projectId, selected, archives.checked);
      if (changed || revision !== memoryRevision) { revision = memoryRevision; void controller.load(); }
    },
  };
}
