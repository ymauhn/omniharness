// Área de trabalho: terminal panes (line shell + interactive PTY), the project/session
// rail, and the "Coordenação" composer card that lives inside the same view.
import { $, make, one, keepFocus, fillSelect } from './dom.mjs';
import { local, api, action, toast, log, sessionById, projectById, statusLabel, currentProjectSessions } from './state.mjs';
import { TerminalLayout, TerminalTranscript, terminalWindowUrl, canControlTerminal, splitTerminalInput, terminalTextTail, mountGridControls } from '../terminal-grid.mjs';

export function createWorkspace({ renderAll, loadMemory, clearContext, showView, copilot, storage } = {}) {
  let terminalStorage = storage;
  if (terminalStorage === undefined) { try { terminalStorage = sessionStorage; } catch { /* private mode or storage disabled */ } }
  const terminalLayout = new TerminalLayout(terminalStorage), terminalStreams = new Map();
  const windowSeed = new URLSearchParams(location.search);
  let seedPending = true, gridControlsKey = '';
  let ptyModulesPromise;

  // The url/localStorage-seeded project the first reconcile should honour; consumed once.
  function seededProjectId() { return seedPending ? windowSeed.get('project') || terminalLayout.preferredProject : null; }

  function reconcilePanes() {
    terminalLayout.switchProject(local.projectId, local.state.sessions, seedPending && windowSeed.get('project') === local.projectId ? windowSeed.get('session') : null);
    if (local.projectId) seedPending = false;
    local.paneSessions = terminalLayout.value.panes;
    const visible = new Set(local.paneSessions.filter(Boolean));
    for (const id of terminalStreams.keys()) if (!visible.has(id)) { clearTimeout(terminalStreams.get(id).retryTimer); terminalStreams.delete(id); local.buffers.delete(id); }
    for (const id of visible) if (!terminalStreams.has(id)) {
      terminalStreams.set(id, { transcript: new TerminalTranscript(id, local.projectId), pending: false, ready: false, status: 'Consultando saída recente…' });
    }
  }
  function assignPane(index, id) {
    try { terminalLayout.assign(index, id, local.state.sessions); local.paneSessions = terminalLayout.value.panes; return true; }
    catch { toast('Selecione uma sessão do projeto atual.'); return false; }
  }
  function selectProject(id) {
    if (!projectById(id)) return;
    if (id !== local.projectId) {
      clearContext(); local.projectId = id; local.inventory = null; local.inventoryProjectId = null;
      local.notes = []; local.memoryProjectId = null; reconcilePanes();
    }
    renderAll(); loadMemory();
  }

  function renderSidebar() {
    const projects = $('#project-list'), sessions = $('#session-list'), restore = [keepFocus(projects), keepFocus(sessions)];
    projects.replaceChildren();
    if (!local.state.projects.length) one(projects, 'p', 'rail-empty', 'Nenhum projeto ainda. Adicione uma pasta local.');
    for (const p of local.state.projects) {
      const button = make('button', 'rail-item'); button.type = 'button'; button.dataset.focusKey = `project:${p.id}`;
      button.setAttribute('aria-current', String(p.id === local.projectId));
      one(button, 'span', 'name', p.name); button.title = p.root;
      button.addEventListener('click', () => selectProject(p.id));
      projects.append(button);
    }
    sessions.replaceChildren();
    const visible = local.state.sessions.filter(s => s.projectId === local.projectId);
    if (!visible.length) one(sessions, 'p', 'rail-empty', 'Abra uma sessão para este projeto.');
    for (const s of visible) {
      const button = make('button', 'rail-item'); button.type = 'button'; button.dataset.focusKey = `session:${s.id}`;
      button.setAttribute('aria-current', String(local.paneSessions.includes(s.id)));
      one(button, 'span', 'name', s.name);
      const state = one(button, 'small', '', statusLabel(s.status));
      if (s.status === 'stopped') state.title = 'Subprocessos desacoplados do shell podem continuar ativos no Windows.';
      button.addEventListener('click', () => { assignPane(terminalLayout.value.focus, s.id); renderWorkspace(); showView('workspace'); });
      sessions.append(button);
    }
    for (const done of restore) done();
    // An open form keeps the user's valid project choice; state events must not retarget the new session.
    const sessionProject = $('#session-project'), formOpen = !$('#session-form').hidden;
    const projectChoice = formOpen && projectById(sessionProject.value) ? sessionProject.value : local.projectId;
    fillSelect(sessionProject, local.state.projects.map(p => ({ value: p.id, label: p.name })), projectChoice, 'Selecione projeto');
  }

  const isPtySession = session => session?.host === 'local-pty';
  const ptyTheme = () => ({
    operations: { background: '#080c12', foreground: '#dce8ea', cursor: '#97a5ff' },
    atelier: { background: '#1b282c', foreground: '#e8eef1', cursor: '#64c7d3' },
    bridge: { background: '#0b1518', foreground: '#edf4f4', cursor: '#64ced1' },
  })[document.body.dataset.theme] || { background: '#080c12', foreground: '#dce8ea', cursor: '#97a5ff' };
  function ptyModules() {
    if (!ptyModulesPromise) ptyModulesPromise = Promise.all([import('/vendor/xterm.mjs'), import('/vendor/addon-fit.mjs')])
      .then(([terminal, fit]) => ({ Terminal: terminal.Terminal, FitAddon: fit.FitAddon }))
      .catch(error => { ptyModulesPromise = null; throw error; });
    return ptyModulesPromise;
  }
  // Test-only seam: lets a test hand mounted PTYs a fake xterm module without touching /vendor.
  function setPtyModules(promise) { ptyModulesPromise = promise; }
  function disposePty(index) {
    const view = local.ptyViews.get(index); if (!view) return;
    view.disposed = true; view.observer?.disconnect(); view.inputDisposable?.dispose(); view.term.dispose();
    local.ptyViews.delete(index);
  }
  function mayControl(index, sessionId) {
    if (local.view !== 'workspace') return false;
    return canControlTerminal({
      focused: document.hasFocus(), index, focusIndex: terminalLayout.value.focus, sessionId,
      panes: local.paneSessions, projectId: local.projectId, sessions: local.state.sessions,
    });
  }
  function fitPty(view) {
    if (view.disposed || !view.pane.isConnected || local.view !== 'workspace') return;
    if (!view.host.clientWidth || !view.host.clientHeight) return;
    try { view.fit.fit(); } catch { return; }
    const cols = view.term.cols, rows = view.term.rows, key = `${cols}x${rows}`;
    if (!mayControl(view.index, view.sessionId) || key === view.lastSize || view.resizePending) return;
    view.resizePending = true;
    api(`/api/sessions/${encodeURIComponent(view.sessionId)}/resize`, { method: 'POST', body: { cols, rows } })
      .then(() => { view.lastSize = key; if (`${view.term.cols}x${view.term.rows}` !== key) scheduleFit(view); })
      .catch(error => { if (error.status !== 409 && !local.tokenInvalid && !view.disposed) toast(`Redimensionamento não confirmado: ${error.message}`); })
      .finally(() => { view.resizePending = false; });
  }
  function scheduleFit(view) { if (view.disposed || view.fitPending) return; view.fitPending = true; requestAnimationFrame(() => { view.fitPending = false; fitPty(view); }); }
  function fitTerminals() { for (const view of local.ptyViews.values()) scheduleFit(view); }
  function applyTheme() { for (const view of local.ptyViews.values()) view.term.options.theme = ptyTheme(); fitTerminals(); }
  function sendPtyInput(view, data) {
    if (view.disposed || view.inputFailed || !data || !mayControl(view.index, view.sessionId)) return;
    let chunks;
    try { chunks = splitTerminalInput(data); if (view.queuedInput + data.length > 65536) throw Error(); }
    catch { toast('Entrada não enviada: limite de 64 Ki caracteres pendentes.'); return; }
    view.queuedInput += data.length; view.interruptedNotice = false;
    view.writeQueue = view.writeQueue.then(async () => {
      for (const chunk of chunks) {
        if (view.disposed || view.inputFailed || !mayControl(view.index, view.sessionId)) {
          if (!view.interruptedNotice) {
            view.interruptedNotice = true;
            const message = 'Entrada do terminal interrompida: o foco, painel ou sessão mudou. O restante não foi enviado; confira a parte já enviada antes de repetir.';
            toast(message); log('Aviso', message);
          }
          return;
        }
        await api(`/api/sessions/${encodeURIComponent(view.sessionId)}/write`, { method: 'POST', body: { data: chunk } });
      }
    }).catch(error => {
      if (view.disposed) return;
      view.inputFailed = true; view.term.options.disableStdin = true;
      toast(`Entrada do terminal interrompida: ${error.message}`); log('Erro', `Entrada do terminal ${view.sessionId} não foi confirmada.`);
    }).finally(() => { view.queuedInput -= data.length; });
  }
  // Tab stays with the shell (completion) until Ctrl+M, per page, makes Tab/Shift+Tab move focus;
  // xterm then writes nothing (no ESC[Z).
  let tabMovesFocus = false;
  const tabModeText = () => tabMovesFocus ? 'Tab move o foco (Ctrl+M devolve o Tab ao shell).' : 'Tab completa no shell; Shift+Tab sai do terminal; Ctrl+M faz o Tab mover o foco.';
  function ptyKey(event) {
    if (event.type === 'keydown' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key?.toLowerCase() === 'm') {
      event.preventDefault(); tabMovesFocus = !tabMovesFocus;
      for (const node of document.querySelectorAll('.terminal-tab-mode')) node.textContent = tabModeText();
      toast(tabModeText()); return false;
    }
    return !(event.key === 'Tab' && (tabMovesFocus || event.shiftKey));
  }
  async function mountPty(index, pane, session) {
    let modules;
    try { modules = await ptyModules(); }
    catch (error) {
      const host = pane.querySelector('.terminal-xterm');
      if (host && pane.isConnected) host.textContent = `Terminal interativo indisponível: ${error.message}. Use o comando por linha abaixo.`;
      return;
    }
    const stillCurrent = pane.isConnected && $('#terminal-grid').children[index] === pane && local.paneSessions[index] === session.id
      && session.projectId === local.projectId && local.ptyViews.get(index)?.pane !== pane;
    if (!stillCurrent) return;
    disposePty(index);
    const host = pane.querySelector('.terminal-xterm'); host.replaceChildren();
    let term;
    try {
      term = new modules.Terminal({ cursorBlink: false, fontFamily: "Consolas, 'Cascadia Code', monospace", fontSize: 12, scrollback: 2000, screenReaderMode: true, theme: ptyTheme() });
      const fit = new modules.FitAddon(); term.loadAddon(fit); term.open(host);
      term.textarea?.setAttribute('aria-describedby', `terminal-tab-mode-${index}`);
      term.attachCustomKeyEventHandler(ptyKey);
      const view = { index, pane, host, sessionId: session.id, term, fit, disposed: false, inputFailed: false, fitPending: false, lastSize: null, queuedInput: 0, writeQueue: Promise.resolve() };
      local.ptyViews.set(index, view);
      view.inputDisposable = term.onData(data => sendPtyInput(view, data));
      view.observer = new ResizeObserver(() => scheduleFit(view)); view.observer.observe(host);
      const buffered = local.buffers.get(session.id); if (buffered) term.write(buffered);
      scheduleFit(view);
    } catch (error) {
      if (local.ptyViews.has(index)) disposePty(index); else term?.dispose();
      host.textContent = `Terminal interativo indisponível: ${error.message}. Use o comando por linha abaixo.`;
      toast('Falha ao abrir o terminal interativo.');
    }
  }
  function appendOutput(sessionId, text, reset = false) {
    if (!local.paneSessions.includes(sessionId) || sessionById(sessionId)?.projectId !== local.projectId) return;
    const next = terminalTextTail((reset ? '' : local.buffers.get(sessionId) || '') + text);
    local.buffers.set(sessionId, next);
    for (const view of local.ptyViews.values()) if (view.sessionId === sessionId && !view.disposed) { if (reset) view.term.reset(); view.term.write(text); }
    document.querySelectorAll('.terminal-output').forEach(node => {
      if (node.dataset.sessionId !== sessionId) return;
      const atBottom = node.scrollHeight - node.clientHeight - node.scrollTop <= 12;
      node.textContent = next;
      if (atBottom) node.scrollTop = node.scrollHeight;
    });
  }
  function replayStatus(id) {
    for (const pane of $('#terminal-grid').children) {
      if (pane.dataset.sessionId !== id) continue;
      const node = pane.querySelector('.terminal-replay-status'), text = terminalStreams.get(id)?.status || '';
      if (node.textContent !== text) node.textContent = text;
    }
  }
  function terminalStatus(entry, { gap = false, error = false } = {}) {
    const parts = [];
    if (entry.transcript.epochChanged) parts.push('Histórico recente reiniciado: possível reinício do servidor ou descarte da saída retida.');
    if (error) parts.push('Histórico recente indisponível; a saída ao vivo pode ter lacunas.');
    if (gap) parts.push('Recuperando lacuna de saída…');
    if (entry.transcript.truncated) parts.push('Saída recente limitada; o início foi descartado.');
    if (!error && !gap && !entry.transcript.truncated) parts.push('Saída recente em memória; não é um arquivo de histórico.');
    return parts.join(' ');
  }
  function displayTranscript(id, result) {
    if (!result) return;
    appendOutput(id, result.text, result.reset);
    const entry = terminalStreams.get(id); entry.status = terminalStatus(entry, { gap: result.gap }); replayStatus(id);
  }
  function acceptTerminal(payload) {
    const entry = terminalStreams.get(payload.sessionId);
    if (!entry || sessionById(payload.sessionId)?.projectId !== local.projectId) return;
    const result = entry.transcript.live(payload);
    if (!result) return;
    displayTranscript(payload.sessionId, result);
    if (result.gap) replayTerminal(payload.sessionId);
  }
  async function replayTerminal(id) {
    const entry = terminalStreams.get(id); if (!entry || entry.pending || entry.retryTimer) return;
    entry.pending = true; let retry = false;
    const current = () => terminalStreams.get(id) === entry && sessionById(id)?.projectId === local.projectId && local.paneSessions.includes(id);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = entry.transcript.begin(), result = await api(`/api/sessions/${encodeURIComponent(id)}/output?projectId=${encodeURIComponent(entry.transcript.projectId)}&after=${token.cursor}`);
        if (!current()) return;
        const update = entry.transcript.replay(result, token); retry = !update || update.gap;
        if (update) { entry.ready = true; displayTranscript(id, update); if (!retry) break; }
      }
    } catch { retry = false; if (current()) { entry.status = terminalStatus(entry, { error: true }); replayStatus(id); } }
    finally { entry.pending = false; if (retry && current()) entry.retryTimer = setTimeout(() => { entry.retryTimer = null; if (current()) void replayTerminal(id); }, 250); }
  }
  function focusPane(index) {
    if (terminalLayout.value.focus !== index) { terminalLayout.focus(index); for (const view of local.ptyViews.values()) view.lastSize = null; }
    for (const [i, pane] of [...$('#terminal-grid').children].entries()) pane.dataset.focused = String(i === index);
    fitTerminals();
  }
  function sizeTerminalGrid() {
    const { weights, heights } = terminalLayout.value, columns = terminalLayout.columns;
    $('#terminal-grid').style.setProperty('--grid-columns', weights.slice(0, columns).map(n => `minmax(260px,${n}fr)`).join(' '));
    $('#terminal-grid').style.setProperty('--grid-rows', heights.slice(0, Math.ceil(local.paneSessions.length / columns)).map(n => `${n}px`).join(' '));
    fitTerminals();
  }
  function openTerminalWindow(sessionId) {
    if (!local.projectId) return;
    window.open(terminalWindowUrl(location.href, local.projectId, sessionId), '_blank', 'noopener');
    toast('Nova janela solicitada. Se necessário, permita pop-ups deste endereço local.');
  }
  function renderWorkspace() {
    reconcilePanes();
    const grid = $('#terminal-grid'), active = document.activeElement, drafts = new Map();
    for (const old of grid.children) {
      const output = old.querySelector('.terminal-output'), command = old.querySelector('.command-line input'), verification = old.querySelector('.recovery-form textarea');
      if (old.dataset.sessionId) drafts.set(old.dataset.sessionId, {
        command: command?.value || '', verification: verification?.value || '', scrollTop: output?.scrollTop || 0,
        atBottom: output ? output.scrollHeight - output.clientHeight - output.scrollTop <= 12 : true,
        focus: active === command ? 'command' : active === verification ? 'verification' : active === old.querySelector('.pane-select') ? 'session' : null,
        selectionStart: active?.selectionStart, selectionEnd: active?.selectionEnd,
      });
    }
    for (let index = 0; index < local.paneSessions.length; index++) {
      const id = local.paneSessions[index], session = sessionById(id), mode = isPtySession(session) ? 'pty' : 'line', status = session?.status || '', old = grid.children[index];
      if (old && old.dataset.projectId === (local.projectId || '') && old.dataset.sessionId === (id || '') && old.dataset.mode === mode && old.dataset.status === status) {
        const select = old.querySelector('.pane-select'); fillSelect(select, currentProjectSessions().map(s => ({ value: s.id, label: s.name })), id, 'Selecione uma sessão');
        if (mode === 'pty' && !local.ptyViews.has(index)) mountPty(index, old, session);
        continue;
      }
      disposePty(index); const pane = terminalPane(index); if (old) grid.replaceChild(pane, old); else grid.append(pane);
      const draft = drafts.get(id);
      if (draft) {
        const nextCommand = pane.querySelector('.command-line input'), nextVerification = pane.querySelector('.recovery-form textarea'), nextOutput = pane.querySelector('.terminal-output');
        if (nextCommand) nextCommand.value = draft.command;
        if (nextVerification) nextVerification.value = draft.verification;
        if (nextOutput) nextOutput.scrollTop = draft.atBottom ? nextOutput.scrollHeight : draft.scrollTop;
        const target = draft.focus === 'command' ? nextCommand
          : draft.focus === 'verification' ? nextVerification
          : draft.focus === 'session' ? pane.querySelector('.pane-select') : null;
        if (target && !target.disabled) {
          target.focus();
          if (typeof target.setSelectionRange === 'function' && Number.isInteger(draft.selectionStart)) target.setSelectionRange(draft.selectionStart, draft.selectionEnd);
        }
      }
      if (mode === 'pty') mountPty(index, pane, session);
    }
    while (grid.children.length > local.paneSessions.length) { disposePty(grid.children.length - 1); grid.lastElementChild.remove(); }
    const controlsKey = JSON.stringify([local.projectId, local.paneSessions.length, terminalLayout.value.columns, terminalLayout.persistent]);
    if (controlsKey !== gridControlsKey) { gridControlsKey = controlsKey; gridControls.render(); }
    for (const pane of grid.children) {
      const index = [...grid.children].indexOf(pane);
      pane.querySelector('[data-pane-close]').disabled = local.paneSessions.length === 1;
      pane.querySelector('[data-pane-next]').disabled = index === local.paneSessions.length - 1;
    }
    sizeTerminalGrid(); focusPane(terminalLayout.value.focus);
    for (const id of local.paneSessions) if (id && !terminalStreams.get(id)?.ready) replayTerminal(id);
  }
  function terminalPane(index) {
    const id = local.paneSessions[index], session = sessionById(id), project = projectById(session?.projectId), pane = make('section', 'card terminal-pane');
    pane.dataset.projectId = local.projectId || ''; pane.dataset.sessionId = id || ''; pane.dataset.mode = isPtySession(session) ? 'pty' : 'line'; pane.dataset.status = session?.status || '';
    pane.setAttribute('aria-label', `Terminal ${index + 1}`);
    pane.addEventListener('pointerdown', () => focusPane(index)); pane.addEventListener('focusin', () => focusPane(index));
    const head = one(pane, 'div', 'card-head'); const group = one(head, 'div', 'pane-head-meta'); const title = one(group, 'div', 'pane-title');
    one(title, 'h2', '', `Terminal ${index + 1}`);
    const state = one(title, 'span', 'session-tag', statusLabel(session?.status) || 'sem sessão');
    if (session?.status === 'stopped') state.title = 'O PTY encerrou; subprocessos desacoplados exigem verificação separada.';
    const select = one(group, 'select', 'pane-select'); select.setAttribute('aria-label', `Sessão do terminal ${index + 1}`);
    fillSelect(select, currentProjectSessions().map(s => ({ value: s.id, label: s.name })), id, 'Selecione uma sessão');
    select.addEventListener('change', () => { assignPane(index, select.value); renderWorkspace(); });
    const paneActions = one(head, 'div', 'pane-window-controls');
    const paneButton = (label, callback) => { const button = one(paneActions, 'button', 'ghost', label); button.type = 'button'; button.addEventListener('click', callback); return button; };
    const focusFocusedSelect = () => $('#terminal-grid').children[terminalLayout.value.focus]?.querySelector('.pane-select').focus();
    paneButton('←', () => { terminalLayout.move(index, -1); renderWorkspace(); focusFocusedSelect(); }).disabled = index === 0;
    paneActions.lastElementChild.setAttribute('aria-label', `Mover terminal ${index + 1} para antes`);
    const next = paneButton('→', () => { terminalLayout.move(index, 1); renderWorkspace(); focusFocusedSelect(); });
    next.dataset.paneNext = ''; next.setAttribute('aria-label', `Mover terminal ${index + 1} para depois`);
    paneButton('Abrir em janela', () => openTerminalWindow(id)).disabled = !session;
    const newSession = () => {
      $('#session-form').hidden = false; $('#toggle-session').setAttribute('aria-expanded', 'true');
      $('#session-project').value = local.projectId; $('#session-form').querySelector('input')?.focus();
    };
    paneButton('Nova sessão', newSession).disabled = !local.projectId;
    const close = paneButton('Fechar painel', () => {
      terminalLayout.remove(index); renderWorkspace(); focusFocusedSelect();
      toast('Painel fechado. A sessão continua disponível na lista.');
    });
    close.dataset.paneClose = ''; close.setAttribute('aria-label', `Fechar painel ${index + 1} sem parar a sessão`);
    if (isPtySession(session)) {
      const host = one(pane, 'div', 'terminal-xterm', 'Carregando terminal interativo…');
      host.setAttribute('aria-label', `Terminal interativo ${index + 1} de ${session.name}`);
    } else {
      const placeholder = id ? (local.buffers.get(id) || 'Consultando a saída recente mantida em memória pelo servidor.\n') : 'Crie ou selecione uma sessão para executar comandos locais.\n';
      const output = one(pane, 'pre', 'terminal-output', placeholder);
      output.dataset.sessionId = id || ''; output.setAttribute('role', 'log'); output.setAttribute('aria-label', `Saída do terminal ${index + 1}`);
    }
    const controls = one(pane, 'div', 'terminal-controls'); const form = one(controls, 'form', 'command-line'); const command = one(form, 'input');
    command.type = 'text'; command.autocomplete = 'off'; command.maxLength = 4096;
    command.placeholder = session ? (isPtySession(session) ? 'Comando rápido; ou digite no terminal' : 'Comando para o shell local') : 'Selecione uma sessão';
    command.setAttribute('aria-label', `Comando do terminal ${index + 1}`); command.disabled = !session || session.status !== 'running';
    const send = one(form, 'button', 'button', 'Executar'); send.type = 'submit'; send.disabled = command.disabled;
    form.addEventListener('submit', async event => {
      event.preventDefault(); const value = command.value.trim();
      if (!value || !session || !pane.isConnected || !mayControl(index, session.id)) return;
      if (!isPtySession(session)) appendOutput(session.id, `\n> ${value}\n`);
      command.value = ''; command.focus();
      try {
        await api(`/api/sessions/${encodeURIComponent(session.id)}/command`, { method: 'POST', body: { command: value } });
        log('Ação local', `Comando enviado para ${session.name} (${project?.name || 'projeto'}).`);
      } catch (error) { appendOutput(session.id, `\r\n[erro] ${error.message}\r\n`); toast(error.message); log('Erro', error.message); }
    });
    const replay = one(controls, 'p', 'terminal-replay-status', terminalStreams.get(id)?.status || ''); replay.setAttribute('role', 'status');
    if (isPtySession(session)) one(controls, 'p', 'terminal-tab-mode', tabModeText()).id = `terminal-tab-mode-${index}`;
    const footer = one(controls, 'div', 'terminal-actions');
    const footNote = session
      ? `${project?.root || ''} · ${session.host || 'local-shell'} · Parar encerra o shell; subprocessos desacoplados exigem verificação.`
      : 'Comandos executam na pasta do projeto';
    one(footer, 'small', '', footNote);
    const stop = one(footer, 'button', 'ghost', 'Parar shell'); stop.type = 'button'; stop.disabled = !session || session.status !== 'running';
    stop.setAttribute('aria-label', `Parar shell do terminal ${index + 1}`);
    stop.addEventListener('click', () => {
      if (session && pane.isConnected && mayControl(index, session.id)) action(`/api/sessions/${encodeURIComponent(session.id)}/stop`, {}, `Parada solicitada para ${session.name}.`);
    });
    if (session?.status === 'interrupted') {
      const recovery = one(controls, 'form', 'recovery-form'); one(recovery, 'label', '', `Sessão ${session.name} interrompida`);
      one(recovery, 'p', '', 'Verifique no sistema operacional se o processo anterior terminou. O reconhecimento registra sua verificação; não encerra processos.');
      const verification = one(recovery, 'textarea'); verification.required = true; verification.maxLength = 500;
      verification.placeholder = 'Descreva o que verificou no sistema operacional'; verification.setAttribute('aria-label', `Verificação manual da sessão ${session.name}`);
      const acknowledge = one(recovery, 'button', 'secondary', local.confirmedAcks.has(session.id) ? 'Reconhecimento confirmado' : 'Reconhecer interrupção');
      acknowledge.type = 'submit'; acknowledge.disabled = local.confirmedAcks.has(session.id); verification.disabled = acknowledge.disabled;
      recovery.addEventListener('submit', async event => {
        event.preventDefault(); const value = verification.value.trim();
        if (!value || !pane.isConnected || local.paneSessions[index] !== session.id || sessionById(session.id)?.projectId !== local.projectId || local.confirmedAcks.has(session.id)) return;
        const result = await action(`/api/sessions/${encodeURIComponent(session.id)}/acknowledge`, { verification: value }, `Verificação manual registrada para ${session.name}.`);
        if (result) { local.confirmedAcks.add(session.id); verification.disabled = true; acknowledge.disabled = true; acknowledge.textContent = 'Reconhecimento confirmado'; }
      });
    }
    return pane;
  }

  const gridControls = mountGridControls({
    root: $('#terminal-grid-controls'), layout: terminalLayout, getSessions: () => local.state.sessions, getProjectId: () => local.projectId,
    changed: render => { if (render === false) { sizeTerminalGrid(); return; } renderWorkspace(); }, openWindow: openTerminalWindow,
  });

  for (const name of ['project', 'session']) {
    $(`#toggle-${name}`).addEventListener('click', () => {
      const form = $(`#${name}-form`); form.hidden = !form.hidden; $(`#toggle-${name}`).setAttribute('aria-expanded', String(!form.hidden));
      if (form.hidden) return;
      if (name === 'session') $('#session-project').value = local.projectId || '';
      form.querySelector('input,select')?.focus();
    });
  }
  $('#project-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const result = await action('/api/projects', { name: form.elements.name.value, root: form.elements.root.value }, project => `Projeto “${project.name}” selecionado.`);
    if (result) { selectProject(result.id); form.reset(); form.hidden = true; $('#toggle-project').setAttribute('aria-expanded', 'false'); }
  });
  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, projectId = form.elements.projectId.value, name = form.elements.name.value, submit = form.querySelector('button[type="submit"]');
    if (submit.disabled || !projectById(projectId)) return;
    selectProject(projectId);
    const targetLayout = terminalLayout.value, index = terminalLayout.value.focus, previous = local.paneSessions[index];
    submit.disabled = true;
    try {
      const result = await action('/api/sessions', { projectId, name }, `Sessão “${name}” aberta.`), id = result?.id || result?.session?.id;
      if (result && local.projectId === projectId && terminalLayout.value === targetLayout && (local.paneSessions[index] === previous || local.paneSessions[index] === id)) {
        if (id && sessionById(id)?.projectId === projectId) assignPane(index, id);
        if (form.elements.name.value === name) { form.reset(); form.hidden = true; $('#toggle-session').setAttribute('aria-expanded', 'false'); }
        renderAll(); showView('workspace');
      }
    } finally { submit.disabled = false; }
  });
  // A composer task takes its first line (the server caps titles at 240) and keeps the whole draft as details.
  $('#coord-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!local.projectId) return toast('Selecione um projeto.');
    const form = event.currentTarget, submit = form.querySelector('button[type="submit"]'), text = form.elements.text.value.trim();
    if (!text || form.busy) return;
    const kind = form.elements.action.value, submittedRevision = copilot.revision(), title = text.split('\n').map(line => line.trim()).find(Boolean).slice(0, 240);
    form.busy = submit.disabled = true;
    try {
      if (kind === 'minitool') {
        const minitoolMessage = row => `Mini-tool versão ${row.version} criado a partir do template revisado do verificador de links; ` +
          'o pedido só seleciona o template e não altera o código. Revise o código antes de ativar.';
        const version = await action('/api/extensions/generate', { projectId: local.projectId, request: text }, minitoolMessage);
        if (version) { if (copilot.revision() === submittedRevision) { form.reset(); copilot.sync(); } showView('assets'); }
        return;
      }
      const result = kind === 'task'
        ? await action('/api/tasks', { projectId: local.projectId, title, details: text === title ? undefined : text }, `Tarefa “${title}” registrada.`)
        : await action('/api/memory', { scope: 'project', projectId: local.projectId, source: 'Coordenação manual', text }, 'Decisão guardada na memória do projeto.');
      if (result) { if (copilot.revision() === submittedRevision) { form.reset(); copilot.sync(); } if (kind === 'memory') loadMemory(); }
    } finally { form.busy = submit.disabled = false; }
  });
  window.addEventListener('focus', () => { for (const view of local.ptyViews.values()) view.lastSize = null; fitTerminals(); });

  return {
    layout: terminalLayout, streams: terminalStreams, seededProjectId, reconcilePanes, assignPane, renderSidebar, renderWorkspace,
    fitTerminals, applyTheme, setPtyModules, acceptTerminal, replayTerminal, appendOutput, displayTranscript, fitPty, sendPtyInput,
  };
}
