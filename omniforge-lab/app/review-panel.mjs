// Review of a task run (review.mjs): the worktree's diff, the gated "Aprovar e fazer merge" and the task's evidence
// bundle. Diff, test output and refusal reasons are untrusted agent output: they reach the page as textContent only.
import { one, asArray } from './dom.mjs';

const FILE_STATUS = { A: 'adicionado', M: 'modificado', D: 'removido', T: 'tipo alterado' };
const HOST = { claude: 'Claude', codex: 'Codex' };
const testKey = projectId => `omniforge-review-test:${projectId}`;

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

/** Token usage as the engine recorded it; unknown (or a field the CLI did not report) is never shown as zero. */
export function usageText(usage) {
  if (usage?.status !== 'observed') return `desconhecido: ${usage?.reason || 'sem registro de uso'}`;
  const figures = [['entrada', usage.inputTokens, 'desconhecida'], ['saída', usage.outputTokens, 'desconhecida'],
    ['cache lido', usage.cacheReadTokens, 'desconhecido'], ['cache criado', usage.cacheCreationTokens, 'desconhecido']];
  return `observado: ${figures.map(([label, value, unknown]) => `${label} ${Number.isSafeInteger(value) ? value.toLocaleString('pt-BR') : unknown}`).join(' · ')}`;
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
  details.push(`Uso: ${usageText(attempt.usage)}`);
  if (attempt.note) details.push(`Nota: ${attempt.note}`);
  const merged = Boolean(attempt.mergeSha);
  return { kind: merged ? 'merged' : 'refused', title: merged ? `Merge ${attempt.mergeSha}` : `Recusado: ${attempt.refused?.reason ?? 'motivo não registrado'}`,
    details, output: test?.outputTail || null, at: attempt.at, when: when(attempt.at) };
}

export function createReviewPanel({ root, api, getProjectId, getTask, toast = () => {}, storage }) {
  let store = storage;
  if (store === undefined) { try { store = localStorage; } catch { /* private mode or storage disabled */ } }
  const lastTest = projectId => { try { return store?.getItem(testKey(projectId)) ?? ''; } catch { return ''; } };
  const keepTest = (projectId, value) => { try { store?.setItem(testKey(projectId), value); } catch { /* private mode or storage disabled */ } };
  let taskId = null, projectId = null, revision = null, diff = null, evidence = null, errors = {}, draft = null, request = 0, merging = null, focusKey = null;
  // The last merge outcome is drawn in the panel and announced once through the page's persistent toast live region.
  let outcome = null;
  const current = (id, owner) => id === taskId && owner === projectId && owner === getProjectId();

  function open(id) {
    const task = getTask(id);
    if (!task || task.projectId !== getProjectId()) return;
    errors = {};
    [taskId, projectId, revision, diff, evidence, outcome] = [id, task.projectId, task.revision, null, null, null];
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
    errors = { diff: diffReply.reason?.message, evidence: evidenceReply.reason?.message };
    render();
  }

  async function merge() {
    const id = taskId, owner = projectId, task = getTask(id);
    if (merging || !task) return;
    const testCommand = draft.testCommand.trim(), note = draft.note.trim();
    keepTest(owner, testCommand);
    merging = id; outcome = null; render(); // one merge at a time in this page; only its own task shows it running
    let result, failure;
    try { result = await api(`/api/tasks/${encodeURIComponent(id)}/merge`, { method: 'POST', body: { expectedRevision: task.revision, testCommand: testCommand || null, note: note || null } }); }
    catch (error) { failure = error; }
    finally { merging = null; }
    if (current(id, owner)) {
      if (failure) outcome = { kind: 'refused', text: `${failure.status === 409 ? 'Merge recusado' : 'Merge não concluído'}: ${failure.message}` };
      else { outcome = { kind: 'merged', text: `Merge concluído: ${result.attempt?.mergeSha}` }; draft.note = ''; }
      toast(outcome.text);
      void load();
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

  function renderMerge(parent) {
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
    submit.type = 'submit'; submit.disabled = Boolean(merging);
    if (outcome) one(form, 'p', 'review-outcome', outcome.text).dataset.kind = outcome.kind;
    form.addEventListener('submit', event => { event.preventDefault(); void merge(); });
  }

  function renderEvidence(section) {
    one(section, 'h3', '', 'Evidências');
    if (!evidence) return one(section, 'p', 'microcopy', errors.evidence ? `Evidências indisponíveis: ${errors.evidence}` : 'Carregando evidências…');
    if (!evidence.length) return one(section, 'p', 'empty', 'Nenhuma tentativa de merge registrada.');
    const list = one(section, 'ul', 'review-attempts');
    for (const attempt of [...evidence].reverse()) {
      const view = describeAttempt(attempt), item = one(list, 'li', 'list-item review-attempt');
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
    one(titles, 'small', '', 'Diff da worktree da tarefa contra a base, merge com portões e evidências');
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
    renderEvidence(one(side, 'section', 'review-evidence'));
    const target = focusKey && [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey);
    if (target && !target.disabled) { target.focus(); focusKey = null; }
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

  return { open, close, sync, onEvidence };
}
