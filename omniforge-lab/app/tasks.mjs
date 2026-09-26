// Tarefas view: the project's task queue, its per-task owner/handoff controls and the new-task form.
import { $, make, one, keepFocus, fillSelect, asArray } from './dom.mjs';
import { local, api, action, toast, refreshState, sessionById, taskById, statusLabel, time, currentProjectSessions } from './state.mjs';

export function createTasks({ showView, runControls, reviewPanel, arsenal }) {
  // Unsent handoff forms (open state, host, note) by task id, so a state re-render never discards what is being typed.
  const handoffDrafts = new Map();

  // Owner session, worktree and handoffs come from recorded task fields and live session events, never from chat text.
  function renderTaskOwner(item, task) {
    const owner = sessionById(task.sessionId), row = one(item, 'div', 'task-owner');
    const label = one(row, 'label', 'field', 'Sessão responsável'); const select = one(label, 'select');
    select.dataset.focusKey = `task:${task.id}:owner`; select.setAttribute('aria-label', `Sessão responsável por ${task.title}`);
    fillSelect(select, currentProjectSessions().map(s => ({ value: s.id, label: `${s.name} · ${statusLabel(s.status)}` })), task.sessionId, 'Sem sessão responsável');
    select.addEventListener('change', async () => {
      const body = { sessionId: select.value || null, worktree: task.worktree ?? null, expectedRevision: task.revision };
      const result = await action(`/api/tasks/${encodeURIComponent(task.id)}/assign`, body, `Responsável por “${task.title}” atualizado.`);
      if (!result) select.value = task.sessionId || '';
    });
    one(item, 'div', 'meta', `${owner ? `Em ${owner.name}: ${statusLabel(owner.status)} (evento do shell)` : 'Nenhuma sessão responsável'}${task.worktree ? ` · worktree ${task.worktree}` : ''}`);
    const last = asArray(task.handoffs).at(-1);
    if (last) one(item, 'div', 'meta', `Último handoff → ${last.to} em ${time(last.at)}: ${last.summary}`);
    const draft = handoffDrafts.get(task.id) || { open: false, host: 'codex', note: '' };
    const focusIn = key => [...$('#task-list').querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === `task:${task.id}:${key}`)?.focus();
    const handoff = one(item, 'details', 'task-handoff'); handoff.open = draft.open;
    const summary = one(handoff, 'summary', '', 'Registrar handoff Claude ↔ Codex'); summary.dataset.focusKey = `task:${task.id}:handoff`;
    const form = one(handoff, 'form', 'task-handoff-form');
    const hostField = one(form, 'label', 'field', 'Para'); const host = one(hostField, 'select');
    host.dataset.focusKey = `task:${task.id}:handoff-host`;
    for (const [value, text] of [['codex', 'Codex'], ['claude', 'Claude Code']]) { const option = make('option', '', text); option.value = value; host.append(option); }
    host.value = draft.host;
    const noteField = one(form, 'label', 'field', 'Estado e próximo passo'); const note = one(noteField, 'input');
    note.dataset.focusKey = `task:${task.id}:handoff-note`; note.maxLength = 500; note.required = true; note.value = draft.note;
    const send = one(form, 'button', 'secondary', 'Registrar handoff');
    send.dataset.focusKey = `task:${task.id}:handoff-send`; send.type = 'submit'; send.disabled = Boolean(draft.sending);
    const keep = () => handoffDrafts.set(task.id, { ...handoffDrafts.get(task.id), open: handoff.open, host: host.value, note: note.value });
    handoff.addEventListener('toggle', keep); host.addEventListener('change', keep); note.addEventListener('input', keep);
    // "Sending" lives in the draft, not on this form: a state re-render mid-request rebuilds the form and must not re-arm it.
    // The draft is dropped between the confirmed write and the refresh; focus then returns to the handoff summary (or the note on failure).
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!note.value.trim() || handoffDrafts.get(task.id)?.sending) return;
      handoffDrafts.set(task.id, { open: handoff.open, host: host.value, note: note.value, sending: true }); send.disabled = true;
      let result;
      try {
        const body = { toHost: host.value, summary: note.value.trim(), expectedRevision: task.revision };
        const successMessage = () => { handoffDrafts.delete(task.id); return `Handoff de “${task.title}” registrado para ${host.value}.`; };
        result = await action(`/api/tasks/${encodeURIComponent(task.id)}/handoff`, body, successMessage);
      } finally {
        const kept = handoffDrafts.get(task.id); if (kept) kept.sending = false;
        const current = [...$('#task-list').querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === `task:${task.id}:handoff-send`);
        if (current) current.disabled = false;
      }
      focusIn(result ? 'handoff' : 'handoff-note');
    });
  }

  function renderTasks() {
    const tasks = local.state.tasks.filter(task => task.projectId === local.projectId);
    $('#task-count').textContent = `${tasks.length} tarefa${tasks.length === 1 ? '' : 's'}`;
    const list = $('#task-list'), restore = keepFocus(list);
    list.replaceChildren();
    if (!local.projectId) one(list, 'div', 'empty', 'Selecione um projeto.');
    else if (!tasks.length) one(list, 'div', 'empty', 'Nenhuma tarefa registrada para este projeto.');
    for (const task of tasks) {
      const item = make('article', 'list-item'); const top = one(item, 'div', 'topline');
      one(top, 'strong', 'title', task.title);
      const select = one(top, 'select'); select.dataset.focusKey = `task:${task.id}:status`; select.setAttribute('aria-label', `Estado de ${task.title}`);
      for (const status of ['open', 'running', 'done', 'blocked']) {
        const option = make('option', '', { open: 'Aberta', running: 'Em andamento', done: 'Concluída', blocked: 'Bloqueada' }[status]); option.value = status; select.append(option);
      }
      select.value = task.status || 'open';
      select.addEventListener('change', async () => {
        const value = select.value, body = { status: value, expectedRevision: task.revision };
        const result = await action(`/api/tasks/${encodeURIComponent(task.id)}/status`, body, `Tarefa “${task.title}” alterada para ${value}.`);
        if (!result) { select.value = task.status || 'open'; void refreshState().catch(() => {}); }
      });
      const dependencies = asArray(task.dependsOn).map(id => taskById(id)?.title || id);
      one(item, 'div', 'meta', dependencies.length ? `Depende de: ${dependencies.join(' · ')}` : 'Sem dependências');
      if (task.blockedBy) one(item, 'div', 'meta task-replan', `Bloqueada automaticamente: o pré-requisito “${taskById(task.blockedBy)?.title || task.blockedBy}” está bloqueado.`);
      if (task.hasDetails) {
        const more = one(item, 'details'); one(more, 'summary', '', 'Detalhes').dataset.focusKey = `task:${task.id}:details`;
        const text = one(more, 'p', 'meta', 'Carregando…'); text.style.whiteSpace = 'pre-wrap';
        more.addEventListener('toggle', async () => {
          if (!more.open || more.requested) return;
          more.requested = true;
          try { text.textContent = (await api(`/api/tasks/${encodeURIComponent(task.id)}/details`)).details; }
          catch (error) { more.requested = false; text.textContent = `Detalhes não carregados: ${error.message}`; }
        });
      }
      renderTaskOwner(item, task);
      const actions = runControls(item, task) ?? item;
      const agent = one(actions, 'button', 'secondary', 'Vincular agente'); agent.type = 'button'; agent.dataset.focusKey = `task:${task.id}:agent`;
      agent.addEventListener('click', () => {
        showView('arsenal'); arsenal.focusTask(task.id);
        // This button is hidden now: focus goes to the preselected task picker, or the Arsenal heading when no profile is open.
        ($('#arsenal-panel').querySelector('[data-focus-key="pin-task"]') ?? $('#arsenal-title')).focus();
      });
      if (task.worktree) {
        const review = one(item, 'button', 'secondary', 'Revisar'); review.type = 'button'; review.dataset.focusKey = `task:${task.id}:review`;
        review.setAttribute('aria-label', `Revisar ${task.title}`); review.addEventListener('click', () => reviewPanel.open(task.id));
      }
      list.append(item);
    }
    restore();
    const dep = $('#task-depends'), selected = new Set([...dep.selectedOptions].map(option => option.value));
    dep.replaceChildren();
    for (const task of tasks) { const option = make('option', '', task.title); option.value = task.id; option.selected = selected.has(task.id); dep.append(option); }
    $('#task-form').querySelector('button').disabled = !local.projectId;
  }

  $('#task-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!local.projectId) return toast('Selecione um projeto.');
    const form = event.currentTarget, submit = form.querySelector('button[type="submit"]');
    if (form.busy) return;
    const title = form.elements.title.value.trim();
    const dependsOn = [...$('#task-depends').selectedOptions].map(option => option.value);
    form.busy = submit.disabled = true;
    try {
      const result = await action('/api/tasks', { projectId: local.projectId, title, dependsOn }, `Tarefa “${title}” registrada.`);
      if (result) { form.reset(); renderTasks(); }
    } finally { form.busy = submit.disabled = false; }
  });
  $('#show-task-graph').addEventListener('click', () => { local.graph = 'task'; local.graphNode = null; showView('graphs'); });

  return { renderTasks };
}
