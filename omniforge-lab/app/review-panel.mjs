// Review of a task run (review.mjs): the worktree's diff, the gated "Aprovar e fazer merge", the Gauntlet on demand and
// the task's evidence bundle. Diff, test output, report paths and refusal reasons are untrusted agent output: they reach
// the page as textContent only.
import { one, asArray } from './dom.mjs';
import { runLabel, usageText, HOST, ACTIVE } from './fleet.mjs';

const FILE_STATUS = { A: 'adicionado', M: 'modificado', D: 'removido', T: 'tipo alterado' };
const testKey = projectId => `omniforge-review-test:${projectId}`;
const PRESET = { rapido: 'rápido', padrao: 'padrão' };
const SEVERITY = [['high', 'alta'], ['medium', 'média'], ['low', 'baixa'], ['unverified', 'sem verificação']];
// Changes worth an adversarial look, and the size (changed lines) past which a human review starts missing things.
const SENSITIVE = /auth|token|secret|key|permission|sandbox|credential/i;
const LARGE_DIFF = 400;
const COST = 'custo: desconhecido até terminar; roda na sua sessão Claude';

/** Deterministic reasons to suggest a Gauntlet run, never a model call: a security-sensitive path, a diff over LARGE_DIFF
 * changed lines, or a last merge attempt whose test failed. The owner still decides. */
export function gauntletSignals(diff, attempts) {
  const reasons = [], sensitive = asArray(diff?.files).map(file => file.path).filter(name => SENSITIVE.test(name));
  if (sensitive.length) reasons.push(`mexe em caminho sensível (${[...sensitive.slice(0, 3), ...(sensitive.length > 3 ? ['…'] : [])].join(', ')})`);
  const lines = (diff?.stat?.additions ?? 0) + (diff?.stat?.deletions ?? 0);
  if (lines > LARGE_DIFF) reasons.push(`diff grande: ${lines} linhas alteradas (limite ${LARGE_DIFF})`);
  const test = asArray(attempts).at(-1)?.test;
  if (test && (test.timedOut || test.exitCode !== 0)) reasons.push(`o último merge falhou no teste (${test.timedOut ? 'tempo esgotado' : `código ${test.exitCode ?? 'desconhecido'}`})`);
  return reasons;
}

/** Each patch line with its kind: 'file' (diff --git), 'meta' (the rest of a file header, "\ No newline"), 'hunk', 'add',
 * 'del' or 'context'. In a file header every line is meta, even one starting with +++ or ---; inside a hunk the first
 * character decides, since a content line always starts with ' ', '+', '-' or '\'. */
export function classifyPatch(patch) {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let inHunk = false;
  return lines.map(text => {
    if (text.startsWith('diff --git ')) { inHunk = false; return { kind: 'file', text }; }
    if (text.startsWith('@@')) { inHunk = true; return { kind: 'hunk', text }; }
    return { kind: inHunk ? { '+': 'add', '-': 'del', '\\': 'meta' }[text[0]] ?? 'context' : 'meta', text };
  });
}

const when = at => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? String(at ?? '') : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
};

/** One evidence attempt as display text: merged only when git reported a merge SHA. */
export function describeAttempt(attempt) {
  const { test, diffStat: stat } = attempt, details = [];
  if (attempt.branch) details.push(`${HOST[attempt.host] ?? 'Agente'} · branch ${attempt.branch}${attempt.headSha ? ` · commit ${attempt.headSha}` : ''}`);
  details.push(test ? `Teste: ${test.command} · código ${test.exitCode ?? 'desconhecido'}${test.timedOut ? ' · tempo esgotado' : ''} · SHA-256 da saída ${test.outputSha256}`
    : attempt.mergeSha ? 'Sem comando de teste' : 'Teste não executado');
  if (stat) details.push(`Diff: ${stat.files} arquivo${stat.files === 1 ? '' : 's'}, +${stat.additions} −${stat.deletions}`);
  details.push(usageText(attempt.usage));
  if (attempt.note) details.push(`Nota: ${attempt.note}`);
  const merged = Boolean(attempt.mergeSha);
  return { kind: merged ? 'merged' : 'refused', title: merged ? `Merge ${attempt.mergeSha}` : `Recusado: ${attempt.refused?.reason ?? 'motivo não registrado'}`,
    details, output: test?.outputTail || null, at: attempt.at, when: when(attempt.at) };
}

/** One Gauntlet evidence entry as display text; a severity the report did not state is left out, never shown as 0. */
export function describeGauntlet(entry) {
  const counts = SEVERITY.filter(([key]) => Number.isSafeInteger(entry.summary?.[key])).map(([key, label]) => `${label} ${entry.summary[key]}`);
  const details = [entry.reportPath ? `Relatório: ${entry.reportPath}` : 'Relatório não encontrado na worktree', `Saída: código ${entry.exitCode ?? 'desconhecido'}`,
    usageText(entry.usage)];
  return { kind: 'gauntlet', title: `Gauntlet ${PRESET[entry.preset] ?? entry.preset}: ${counts.join(' · ') || 'gravidades desconhecidas'}`, details, at: entry.at, when: when(entry.at) };
}

/** `getGauntlet(taskId)` is the task's latest Gauntlet run as the fleet holds it, live from the agent SSE, or null. */
export function createReviewPanel({ root, api, getProjectId, getTask, toast = () => {}, storage, getGauntlet = () => null, getSessions = () => [] }) {
  let store = storage;
  if (store === undefined) { try { store = localStorage; } catch { /* private mode or storage disabled */ } }
  const lastTest = projectId => { try { return store?.getItem(testKey(projectId)) ?? ''; } catch { return ''; } };
  const keepTest = (projectId, value) => { try { store?.setItem(testKey(projectId), value); } catch { /* private mode or storage disabled */ } };
  let taskId = null, projectId = null, revision = null, diff = null, evidence = null, errors = {}, draft = null, request = 0, merging = null, focusKey = null;
  // The last merge outcome is drawn in the panel and announced once through the page's persistent toast live region.
  let outcome = null;
  // Gauntlet: its evidence entries, the chosen preset, the confirmation step, the request in flight (a task id, one per
  // page) and its outcome; `shownRun` is the run state last drawn, so only a change of it redraws the panel.
  let gauntlets = null, preset = 'rapido', confirming = false, starting = null, gauntletNote = null, shownRun = '';
  const current = (id, owner) => id === taskId && owner === projectId && owner === getProjectId();

  function open(id) {
    const task = getTask(id);
    if (!task || task.projectId !== getProjectId()) return;
    errors = {};
    [taskId, projectId, revision, diff, evidence, outcome] = [id, task.projectId, task.revision, null, null, null];
    [gauntlets, confirming, gauntletNote] = [null, false, null];
    draft = { testCommand: lastTest(task.projectId), note: '' };
    root.hidden = false;
    render();
    // The panel sits below the task list (and below the new-task form on a phone): show its top, then focus its heading.
    root.scrollIntoView({ block: 'start' });
    [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === 'heading')?.focus({ preventScroll: true });
    void load();
  }

  function close() {
    [taskId, projectId, diff, evidence, draft, focusKey, outcome] = [null, null, null, null, null, null, null];
    [gauntlets, confirming, gauntletNote] = [null, false, null];
    request++;
    root.replaceChildren();
    root.hidden = true;
  }

  // Only the latest reply for the task still open, in the project still selected, may render.
  async function load() {
    const serial = ++request, id = taskId, owner = projectId, route = `/api/tasks/${encodeURIComponent(id)}`;
    const [diffReply, evidenceReply] = await Promise.allSettled([api(`${route}/diff`), api(`${route}/evidence`)]);
    if (serial !== request || !current(id, owner)) return;
    diff = diffReply.value ?? null; evidence = evidenceReply.status === 'fulfilled' ? asArray(evidenceReply.value.attempts) : null;
    gauntlets = evidence && asArray(evidenceReply.value.gauntlet);
    errors = { diff: diffReply.reason?.message, evidence: evidenceReply.reason?.message };
    render();
  }

  // Only the second, confirming click gets here; its outcome is drawn only for the task and project still open.
  async function startGauntlet() {
    const id = taskId, owner = projectId, task = getTask(id), chosen = preset;
    if (starting || !task) return;
    starting = id; confirming = false; gauntletNote = null; render();
    let note;
    try {
      await api(`/api/tasks/${encodeURIComponent(id)}/gauntlet`, { method: 'POST', body: { expectedRevision: task.revision, preset: chosen } });
      note = 'Gauntlet iniciado na sua sessão Claude.';
    } catch (error) { note = `Gauntlet não iniciado: ${error.message}`; }
    finally { starting = null; }
    if (current(id, owner)) { gauntletNote = note; toast(note); }
    if (taskId) render();
  }

  // The approval names the content it approves: the tree of the diff on screen. The server refuses it when the worktree
  // changed since then (409), so after any attempt the diff is dropped and read again before another approval.
  async function merge() {
    const id = taskId, owner = projectId, task = getTask(id), reviewedTree = diff?.tree ?? null;
    if (merging || !task || !diff) return;
    const testCommand = draft.testCommand.trim(), note = draft.note.trim();
    keepTest(owner, testCommand);
    merging = id; outcome = null; render(); // one merge at a time in this page; only its own task shows it running
    let result, failure;
    const body = { expectedRevision: task.revision, testCommand: testCommand || null, note: note || null, reviewedTree };
    try { result = await api(`/api/tasks/${encodeURIComponent(id)}/merge`, { method: 'POST', body }); }
    catch (error) { failure = error; }
    finally { merging = null; }
    if (current(id, owner)) {
      if (failure) outcome = { kind: 'refused', text: `${failure.status === 409 ? 'Merge recusado' : 'Merge não concluído'}: ${failure.message}` };
      else { outcome = { kind: 'merged', text: `Merge concluído: ${result.attempt?.mergeSha}` }; draft.note = ''; }
      toast(outcome.text);
      diff = null; void load();
    }
    if (taskId) render();
  }

  const keyed = (node, key) => { node.dataset.focusKey = key; return node; };
  const button = (parent, className, text, key, onClick) => {
    const node = keyed(one(parent, 'button', className, text), key);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  function renderDiff(section) {
    one(section, 'h3', '', 'Arquivos alterados');
    if (!diff) return one(section, 'p', 'microcopy', errors.diff ? `Diff indisponível: ${errors.diff}` : 'Carregando diff…');
    const { stat } = diff;
    one(section, 'p', 'microcopy', `${stat.files} arquivo${stat.files === 1 ? '' : 's'} · +${stat.additions} −${stat.deletions} · branch ${diff.branch} contra ${diff.baseSha.slice(0, 12)}`);
    if (!diff.files.length) return one(section, 'p', 'empty', 'Nenhuma mudança na worktree em relação à base.');
    const files = one(section, 'ul', 'review-files');
    for (const file of diff.files) {
      const item = one(files, 'li');
      one(item, 'span', 'scope-badge', FILE_STATUS[file.status] ?? file.status).dataset.status = file.status;
      one(item, 'code', '', file.path);
      one(item, 'span', 'microcopy', file.binary ? 'binário' : `+${file.additions} −${file.deletions}`);
    }
    if (diff.truncated) one(section, 'p', 'review-truncated', 'Patch truncado em 256 KiB: a lista de arquivos acima está completa, o texto abaixo não.');
    const patch = keyed(one(section, 'pre', 'review-patch'), 'patch');
    patch.tabIndex = 0; patch.setAttribute('aria-label', 'Patch da tarefa');
    for (const line of classifyPatch(diff.patch)) one(patch, 'span', '', `${line.text}\n`).dataset.kind = line.kind;
  }

  // An agent that ended on its own leaves its session interrupted: the server refuses the merge until the owner records
  // how they checked that nothing of it still runs. That check is taken here, with the same route as the session rail.
  function uncertainSession() {
    const worktree = getTask(taskId)?.worktree;
    return worktree ? getSessions().find(item => item.cwd === worktree && item.status === 'interrupted') ?? null : null;
  }

  function renderUncertain(parent, session) {
    const form = one(parent, 'form', 'review-uncertain');
    one(form, 'p', 'microcopy', `A sessão “${session.name}” terminou sem o Lab confirmar o fim dos processos dela. `
      + 'Confira que nada dela ficou rodando na worktree (por exemplo, um servidor iniciado pelo agente) e registre como verificou.');
    const field = keyed(one(one(form, 'label', 'field', 'Como você verificou'), 'input'), 'verification');
    Object.assign(field, { value: draft.verification ?? '', maxLength: 500, required: true });
    field.addEventListener('input', () => { draft.verification = field.value; });
    keyed(one(form, 'button', 'secondary', 'Confirmar verificação'), 'acknowledge').type = 'submit';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const id = taskId, owner = projectId, verification = field.value.trim();
      if (!verification) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(session.id)}/acknowledge`, { method: 'POST', body: { verification } });
        if (current(id, owner)) { draft.verification = ''; toast(`Verificação registrada para ${session.name}.`); render(); }
      } catch (error) { if (current(id, owner)) toast(error.message); }
    });
  }

  function renderMerge(parent) {
    const uncertain = uncertainSession();
    if (uncertain) renderUncertain(parent, uncertain);
    const form = one(parent, 'form', 'review-merge');
    form.setAttribute('aria-busy', String(merging === taskId));
    one(form, 'h3', '', 'Aprovar e fazer merge');
    one(form, 'p', 'microcopy', 'Faz commit do trabalho da worktree, roda o comando de teste nela e integra na branch base. Conflito ou teste falhando recusa o merge.');
    const command = keyed(one(one(form, 'label', 'field', 'Comando de teste (opcional)'), 'input'), 'test-command');
    Object.assign(command, { value: draft.testCommand, maxLength: 2000, placeholder: 'Ex.: npm test', spellcheck: false });
    command.addEventListener('input', () => { draft.testCommand = command.value; });
    const note = keyed(one(one(form, 'label', 'field', 'Nota do revisor (opcional)'), 'textarea'), 'note');
    Object.assign(note, { value: draft.note, maxLength: 2000 });
    note.addEventListener('input', () => { draft.note = note.value; });
    const submit = keyed(one(form, 'button', 'button', merging === taskId ? 'Executando teste e merge…' : merging ? 'Aguardando outro merge…' : 'Aprovar e fazer merge'), 'merge');
    submit.type = 'submit'; submit.disabled = Boolean(merging) || !diff || Boolean(uncertain);
    if (outcome) one(form, 'p', 'review-outcome', outcome.text).dataset.kind = outcome.kind;
    form.addEventListener('submit', event => { event.preventDefault(); void merge(); });
  }

  // An evidence list, newest first: each entry's title, time and detail lines, then any test output tail.
  function renderEntries(section, views) {
    const list = one(section, 'ul', 'review-attempts');
    for (const view of views.reverse()) {
      const item = one(list, 'li', 'list-item review-attempt');
      item.dataset.kind = view.kind;
      const top = one(item, 'div', 'topline');
      one(top, 'strong', 'title', view.title);
      one(top, 'time', 'meta', view.when).dateTime = view.at;
      for (const line of view.details) one(item, 'div', 'meta', line);
      if (!view.output) continue;
      const output = one(item, 'pre', 'review-output', view.output);
      output.tabIndex = 0; output.setAttribute('aria-label', 'Final da saída do teste');
    }
  }

  function renderEvidence(section) {
    one(section, 'h3', '', 'Evidências');
    if (!evidence) return one(section, 'p', 'microcopy', errors.evidence ? `Evidências indisponíveis: ${errors.evidence}` : 'Carregando evidências…');
    if (!evidence.length) return one(section, 'p', 'empty', 'Nenhuma tentativa de merge registrada.');
    renderEntries(section, evidence.map(describeAttempt));
  }

  // Runs only on the owner's second, confirming click (the token policy); a suggestion appears only on a deterministic signal.
  function renderGauntlet(section) {
    const run = getGauntlet(taskId), running = ACTIVE.has(run?.state);
    one(section, 'h3', '', 'Revisão adversarial (Gauntlet)');
    one(section, 'p', 'microcopy', 'Abre uma sessão Claude na worktree da tarefa com o Gauntlet só em relatório: ele não corrige nada. '
      + 'O agente precisa estar ocioso ou encerrado, e uma sessão dele que terminou sozinha precisa da verificação acima antes.');
    const reasons = gauntletSignals(diff, evidence);
    if (reasons.length) one(section, 'p', 'review-suggestion', `Sugestão: rodar o Gauntlet — ${reasons.join('; ')} — ${COST}.`);
    const select = keyed(one(one(section, 'label', 'field', 'Profundidade'), 'select'), 'gauntlet-preset');
    for (const [value, label] of Object.entries(PRESET)) one(select, 'option', '', label).value = value;
    select.value = preset; select.disabled = confirming || Boolean(starting);
    select.addEventListener('change', () => { preset = select.value; });
    const actions = one(section, 'div', 'review-actions');
    const start = button(actions, 'secondary', confirming ? `Confirmar: rodar Gauntlet (${PRESET[preset]})` : 'Rodar Gauntlet (revisão adversarial)', 'gauntlet', event => {
      if (starting || running) return;
      if (!confirming) { confirming = true; render(); return; }
      // A double-click's second click lands on the relabelled button: it is no confirmation.
      if (event.detail > 1) return;
      void startGauntlet();
    });
    // A held Enter repeats its keydown and the browser clicks on each one: only the first press counts.
    start.addEventListener('keydown', event => { if (event.repeat) event.preventDefault(); });
    // The merge's test runs in this worktree, and the server refuses a Gauntlet meanwhile.
    start.disabled = !diff?.files.length || Boolean(starting) || running || merging === taskId;
    if (confirming) {
      // Same focus key: after cancelling, focus returns to the Gauntlet button.
      button(actions, 'ghost', 'Cancelar', 'gauntlet', () => { confirming = false; render(); });
      one(section, 'p', 'microcopy', `Confirme para rodar /gauntlet-loop ${preset} so-relatorio sem-perguntas na worktree desta tarefa — ${COST}.`);
    }
    if (gauntletNote) one(section, 'p', 'microcopy', gauntletNote);
    if (run) {
      one(section, 'p', 'meta', `Gauntlet: ${runLabel(run)}`);
      if (running) one(section, 'p', 'microcopy', 'Acompanhe no terminal dele (Agentes → Abrir terminal); depois do relatório, encerre-o (/exit) para registrar a evidência.');
    }
    if (gauntlets && !gauntlets.length) one(section, 'p', 'empty', 'Nenhuma revisão do Gauntlet registrada.');
    else if (gauntlets) renderEntries(section, gauntlets.map(describeGauntlet));
  }

  // Every render rebuilds the panel; keyboard focus returns to the control with the same data-focus-key (the
  // extensions-panel pattern), waiting while that control is disabled, and is never pulled back from elsewhere.
  function render() {
    const active = document.activeElement;
    if (active && root.contains(active)) focusKey = active.dataset?.focusKey ?? null;
    else if (active && active !== document.body) focusKey = null;
    root.replaceChildren();
    if (!taskId) return;
    const head = one(root, 'div', 'card-head'), titles = one(head, 'div');
    const heading = keyed(one(titles, 'h2', '', `Revisão: ${getTask(taskId)?.title ?? ''}`), 'heading');
    heading.id = 'review-title'; heading.tabIndex = -1;
    one(titles, 'small', '', 'Diff da worktree da tarefa contra a base, Gauntlet sob demanda, merge com portões e evidências');
    const actions = one(head, 'div', 'review-actions');
    button(actions, 'secondary', 'Atualizar', 'refresh', () => void load());
    button(actions, 'ghost', 'Fechar revisão', 'close', () => {
      const key = `task:${taskId}:review`;
      close();
      [...document.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key)?.focus();
    });
    const body = one(root, 'div', 'card-body review-body');
    renderDiff(one(body, 'section', 'review-diff'));
    const side = one(body, 'div', 'review-side');
    renderMerge(side);
    shownRun = runKey();
    renderGauntlet(one(side, 'section', 'review-gauntlet'));
    renderEvidence(one(side, 'section', 'review-evidence'));
    const target = focusKey && [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey);
    if (target && !target.disabled) { target.focus(); focusKey = null; }
  }

  const runKey = () => { const run = taskId && getGauntlet(taskId); return run ? `${run.id}:${run.state}:${run.detail}` : ''; };

  /** Called when the fleet's runs change (agent SSE): redraws only when the open task's Gauntlet run changed. */
  function onRuns() {
    if (taskId && runKey() !== shownRun) render();
  }

  /** Called on every state render: a project switch or a removed task closes the panel; a new task revision reloads it. */
  function sync() {
    if (!taskId) return;
    const task = getTask(taskId);
    if (projectId !== getProjectId() || task?.projectId !== projectId) return close();
    if (task.revision !== revision) { revision = task.revision; void load(); }
  }

  function onEvidence(event) {
    if (taskId && event?.taskId === taskId && event.projectId === projectId) void load();
  }

  return { open, close, sync, onEvidence, onRuns };
}
