/* Original, deterministic design prototype. No network or model calls. */
'use strict';
const $ = selector => document.querySelector(selector);
const draft = $('#draft');
const M = window.MascotDraft;
const projectId = 'omniharness-demo';
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const labels = { resting: 'De boa · aqui quando precisar', thinking: 'Pensando · acompanhando seu rascunho', suggestion: 'Uma ideia · você decide', selection: 'Um trecho · atenção ao que importa', accepted: 'Boa! · rascunho atualizado', dismissed: 'Entendi · vamos no seu ritmo', muted: 'Em silêncio · assistência desligada' };
let skin = 'modern', revision = 0, selection = null, pending = null, receipt = null;
let lastSuggestedRevision = -1, cooldownUntil = 0, lastFollowupRevision = null;
let pauseTimer, animationTimer, stageVisible = true;

function robot(kind, id) {
  if (kind === 'pixel') return `<svg class="robot pixel" viewBox="0 0 40 40" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
    <path fill="var(--robot-dark)" opacity=".25" d="M10 36h20v2H10z"/>
    <path fill="var(--robot-dark)" d="M12 32h6v4h-8v-2h2zm10 0h6v2h2v2h-8z"/>
    <path fill="var(--robot-mid)" d="M12 26h16v7H12z"/><path fill="var(--robot-light)" d="M12 26h16v2H12z"/>
    <path class="arm arm-left" fill="var(--robot-mid)" d="M8 26h4v6H8v-2H6v-2h2z"/><path class="arm arm-right" fill="var(--robot-mid)" d="M28 26h4v2h2v2h-2v2h-4z"/>
    <g class="antenna"><path fill="var(--robot-dark)" d="M19 5h2v6h-2z"/><path fill="var(--eye)" d="M19 1h2v2h2v2h-2v2h-2V5h-2V3h2z"/></g>
    <path fill="var(--robot-dark)" d="M8 10h24v2h2v12h-2v3H8v-3H6V12h2z"/>
    <path fill="var(--robot-light)" d="M10 9h20v2h2v12h-2v2H10v-2H8V11h2z"/>
    <path fill="var(--robot-mid)" d="M10 23h20v2H10zM8 11h2v12H8z"/>
    <path fill="#172130" d="M12 13h16v2h2v7h-2v1H12v-1h-2v-7h2z"/>
    <path fill="#314059" d="M12 13h16v2H12z"/>
    <path class="eye" fill="var(--eye)" d="M14 17h3v4h-3z"/><path class="eye" fill="var(--eye)" d="M23 17h3v4h-3z"/>
    <path class="sleep-line" stroke="var(--eye)" d="M13 20h5m4 0h5"/>
    <path class="smile" fill="var(--eye)" d="M19 21h2v1h-2z"/>
    <path fill="var(--robot-dark)" d="M16 28h8v4h-8z"/><path fill="var(--eye)" d="M17 29h2v1h-1v1h-1zm4 0h2v2h-1v-1h-1z"/>
    <path class="question-mark" fill="var(--accent)" d="M34 6h4v1h1v3h-2v2h-2V9h2V8h-3zm1 8h2v2h-2z"/>
  </svg>`;
  return `<svg class="robot modern" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs><linearGradient id="shell-${id}" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="var(--robot-light)"/><stop offset=".55" stop-color="var(--robot-mid)"/><stop offset="1" stop-color="var(--robot-dark)"/></linearGradient><linearGradient id="visor-${id}" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#34405a"/><stop offset="1" stop-color="#111927"/></linearGradient><radialGradient id="floor-${id}"><stop stop-color="var(--robot-dark)" stop-opacity=".38"/><stop offset="1" stop-color="var(--robot-dark)" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="100" cy="181" rx="62" ry="11" fill="url(#floor-${id})"/>
    <path d="M71 158v15q-18 1-20 7h34v-22m30 0v22h34q-2-6-20-7v-15" fill="var(--robot-dark)"/>
    <path d="M67 157v13q-8 2-9 5h26v-18m32 0v18h26q-2-4-9-5v-13" fill="var(--robot-mid)"/>
    <g class="arm arm-left"><path d="M61 134q-15 1-16 17" stroke="var(--robot-dark)" stroke-width="14" fill="none" stroke-linecap="round"/><ellipse cx="42" cy="154" rx="11" ry="13" fill="url(#shell-${id})" transform="rotate(18 42 154)"/></g>
    <g class="arm arm-right"><path d="M139 134q15 1 16 17" stroke="var(--robot-dark)" stroke-width="14" fill="none" stroke-linecap="round"/><ellipse cx="158" cy="154" rx="11" ry="13" fill="url(#shell-${id})" transform="rotate(-18 158 154)"/></g>
    <rect x="63" y="116" width="74" height="49" rx="22" fill="url(#shell-${id})"/><path d="M76 135q24 10 48 0" stroke="var(--robot-light)" stroke-opacity=".3" fill="none"/>
    <rect x="85" y="138" width="30" height="17" rx="7" fill="#263044"/><path d="m96 143-5 3 5 3m8-6 5 3-5 3" stroke="var(--eye)" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="antenna"><path d="M100 51V32" stroke="var(--robot-dark)" stroke-width="6" stroke-linecap="round"/><rect x="94" y="19" width="13" height="13" rx="4" fill="var(--eye)" transform="rotate(45 100.5 25.5)"/><path d="m98 21 4-1" stroke="var(--robot-light)" stroke-width="2" stroke-linecap="round"/></g>
    <rect x="27" y="76" width="21" height="35" rx="10" fill="var(--robot-dark)"/><rect x="152" y="76" width="21" height="35" rx="10" fill="var(--robot-dark)"/>
    <rect x="29" y="78" width="8" height="28" rx="4" fill="var(--robot-mid)"/><rect x="163" y="78" width="8" height="28" rx="4" fill="var(--robot-mid)"/>
    <rect x="38" y="44" width="124" height="91" rx="31" fill="url(#shell-${id})"/>
    <path d="M51 72q0-16 18-18h62q11 0 18 10" fill="none" stroke="var(--robot-light)" stroke-opacity=".65" stroke-width="3" stroke-linecap="round"/>
    <rect x="47" y="61" width="106" height="61" rx="23" fill="url(#visor-${id})" stroke="#141d2b" stroke-opacity=".6"/>
    <path d="M58 79q1-9 11-9h59" fill="none" stroke="#697793" stroke-width="2" stroke-opacity=".35" stroke-linecap="round"/>
    <rect class="eye" x="69" y="83" width="15" height="23" rx="7.5" fill="var(--eye)"/><rect class="eye" x="116" y="83" width="15" height="23" rx="7.5" fill="var(--eye)"/>
    <path class="sleep-line" d="M68 96h17m30 0h17" stroke="var(--eye)" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="62" cy="106" rx="5" ry="2.5" fill="var(--eye)" opacity=".18"/><ellipse cx="139" cy="106" rx="5" ry="2.5" fill="var(--eye)" opacity=".18"/>
    <path class="smile" d="M95 106q5 4 10 0" fill="none" stroke="var(--eye)" stroke-width="2" stroke-linecap="round"/>
    <path class="question-mark" d="M172 44q0-8 7-8t7 7q0 5-7 8v3m0 7v1" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function renderRobots() {
  document.querySelectorAll('[data-robot]').forEach((el, index) => { el.innerHTML = robot(el.dataset.robot, `stage-${index}`); });
  document.querySelectorAll('[data-mini]').forEach((el, index) => { el.innerHTML = robot(skin, `mini-${index}`); });
}

function setState(state, animate = true, preview = false) {
  if ($('#mode').value === 'off') { state = 'muted'; preview = false; }
  document.body.dataset.state = state;
  document.body.dataset.preview = String(preview);
  $('#state-label').textContent = preview ? (state === 'muted' ? 'Prévia · expressão em silêncio' : `Prévia · ${labels[state]}`) : labels[state];
  document.querySelectorAll('[data-state]').forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.state === state));
  });
  clearTimeout(animationTimer);
  document.body.classList.remove('animate');
  if (animate && M.canAnimate({ state, visible: !document.hidden && stageVisible, reduced: motionPreference.matches || $('#motion').checked })) {
    void document.body.offsetWidth; // One event-driven animation restart; no render loop.
    document.body.classList.add('animate');
    animationTimer = setTimeout(() => document.body.classList.remove('animate'), 1800);
  }
}

function announce(message, spoken = message) { $('#feedback').textContent = message; $('#announcement').textContent = spoken; }
function clearTimer() { clearTimeout(pauseTimer); }
function clearSelection() { selection = null; $('#selection-actions').hidden = true; }
function count() { $('#char-count').textContent = `${Array.from(draft.value).length} caracteres · somente local`; }
function captureSelection() {
  clearTimer();
  if ($('#mode').value === 'off' || !$('#selection-enabled').checked || draft.selectionStart === draft.selectionEnd) { clearSelection(); return; }
  selection = { start: draft.selectionStart, end: draft.selectionEnd, draft: draft.value, revision };
  $('#selection-label').textContent = `Trecho: “${draft.value.slice(selection.start, selection.end)}”`;
  $('#selection-actions').hidden = false;
  setState('selection');
}

function schedulePause() {
  clearTimer();
  if (!$('#pause').checked || !draft.value.trim() || $('#mode').value === 'off') return;
  pauseTimer = setTimeout(() => {
    const allowed = M.canSuggest({ mode: $('#mode').value, visible: !document.hidden && stageVisible, focused: document.activeElement === draft, selected: draft.selectionStart !== draft.selectionEnd, now: Date.now(), cooldownUntil, revision, lastSuggestedRevision, pending: !!pending });
    if (allowed) suggest('clarify', false);
  }, $('#mode').value === 'active' ? 700 : 1700);
}

function suggest(action, explicit = true) {
  clearTimer();
  if ($('#mode').value === 'off' || !draft.value.trim()) return;
  const chosen = explicit && selection;
  if (chosen && (chosen.revision !== revision || chosen.draft !== draft.value)) { clearSelection(); announce('O texto mudou. Selecione o trecho novamente.'); return; }
  const start = chosen ? chosen.start : 0, end = chosen ? chosen.end : draft.value.length;
  const text = draft.value.slice(start, end);
  const choices = {
    clarify: { title: 'Uma estrutura mais clara', reason: 'Separe a intenção do critério de sucesso. Este exemplo usa apenas o trecho escolhido.', replacement: `Objetivo: ${text.trim()}\nCritério de sucesso: [como vou verificar o resultado?]`, source: 'Modelo local demonstrativo · sem refinamento semântico' },
    context: { title: 'Um pouco de contexto', reason: 'Uma restrição concreta ajuda a orientar o trabalho.', replacement: `${text}\nContexto: projeto OmniHarness.\nRestrições: [o que deve ser preservado?]`, source: 'Contexto de exemplo · não consulta a memória real do projeto' },
    research: { title: 'Abrir um caminho de pesquisa', reason: 'Transforme uma ideia em uma pergunta verificável antes de pesquisar.', replacement: `${text}\nPesquisar: referências, alternativas e critérios de comparação.\nVerificar: fontes primárias e evidências reproduzíveis.`, source: 'Roteiro de pesquisa demonstrativo · nenhuma busca foi executada' },
    skills: { title: 'Uma habilidade para investigar', reason: 'Exemplo de descoberta: checkpoint-build organiza implementação e validação em etapas.', replacement: `${text}\nHabilidade candidata: checkpoint-build. Verificar adequação e disponibilidade antes de usar.`, source: 'Skill de exemplo · disponibilidade e relevância não foram consultadas' }
  };
  const idea = choices[action];
  pending = M.proposal(draft.value, start, end, idea.replacement, projectId, revision);
  lastSuggestedRevision = revision;
  $('#proposal-type').textContent = `${chosen ? 'TRECHO' : explicit ? 'PEDIDO MANUAL' : 'APÓS UMA PAUSA'} / ${idea.title}`;
  $('#proposal-rationale').textContent = idea.reason;
  $('#proposal-text').textContent = idea.replacement;
  $('#proposal-source').textContent = idea.source;
  $('#proposal').hidden = false;
  $('#welcome').hidden = true;
  $('#followup').hidden = true;
  $('#apply').disabled = false;
  announce('Proposta pronta. Seu rascunho continua intacto.');
  setState('suggestion');
}

$('#apply').addEventListener('click', () => {
  const result = M.apply(draft.value, pending, projectId, revision);
  if (!result.ok) { $('#apply').disabled = true; announce('Proposta expirada: o rascunho mudou. Peça uma nova ideia.'); return; }
  draft.value = result.text;
  receipt = result.receipt;
  revision++;
  lastSuggestedRevision = revision;
  pending = null;
  lastFollowupRevision = null;
  $('#proposal').hidden = true;
  $('#followup').hidden = true;
  $('#undo').disabled = false;
  clearSelection();
  count();
  draft.focus();
  draft.setSelectionRange(draft.value.length, draft.value.length);
  setState('accepted');
  announce('Aplicado. Você pode desfazer; nada foi enviado.');
});

$('#dismiss').addEventListener('click', () => {
  pending = null;
  $('#proposal').hidden = true;
  cooldownUntil = Date.now() + 30000;
  const followup = M.dismissFollowup(revision, lastFollowupRevision);
  $('#followup').hidden = !followup.ask;
  lastFollowupRevision = followup.lastFollowupRevision;
  draft.focus();
  setState('dismissed');
  const message = 'Tudo bem. O texto foi preservado. Sugestões automáticas em pausa por 30 segundos.';
  announce(message, followup.ask ? `${message} ${$('#followup').textContent}` : message);
});

$('#undo').addEventListener('click', () => {
  const result = M.undo(draft.value, receipt, projectId, revision);
  if (!result.ok) { announce('Há edições posteriores. Não vou sobrescrevê-las.'); $('#undo').disabled = true; return; }
  draft.value = result.text;
  revision++;
  lastSuggestedRevision = revision;
  pending = null;
  receipt = null;
  $('#undo').disabled = true;
  $('#proposal').hidden = true;
  $('#followup').hidden = true;
  $('#welcome').hidden = false;
  clearSelection();
  count();
  draft.focus();
  draft.setSelectionRange(draft.value.length, draft.value.length);
  setState('resting');
  announce('Rascunho anterior restaurado.');
});

draft.addEventListener('input', () => {
  revision++;
  clearSelection();
  $('#undo').disabled = true;
  if (pending) {
    pending = null;
    $('#apply').disabled = true;
    announce('O rascunho mudou. Esta prévia expirou; peça uma nova ideia.');
  }
  $('#followup').hidden = true;
  count();
  setState('thinking', false);
  schedulePause();
});
for (const event of ['select', 'pointerup', 'keyup']) draft.addEventListener(event, () => {
  if (draft.selectionStart !== draft.selectionEnd) captureSelection();
  else { clearSelection(); if (event !== 'keyup' || !pending) schedulePause(); }
});
draft.addEventListener('blur', clearTimer);
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#draft, #selection-actions')) clearSelection();
});
document.addEventListener('focusin', event => {
  if (event.target.closest('.terminal-example')) { clearSelection(); clearTimer(); setState('resting', false); }
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => suggest(button.dataset.action)));
$('#ask').addEventListener('click', () => suggest('clarify'));

document.querySelectorAll('[data-skin]').forEach(button => button.addEventListener('click', () => {
  skin = button.dataset.skin;
  document.querySelectorAll('[data-skin]').forEach(card => { const active = card.dataset.skin === skin; card.classList.toggle('selected', active); card.setAttribute('aria-pressed', String(active)); });
  renderRobots();
  setState(document.body.dataset.state, true, document.body.dataset.preview === 'true');
}));
$('#state-buttons').addEventListener('click', event => { const button = event.target.closest('button'); if (button) setState(button.dataset.state, true, true); });
$('#theme').addEventListener('change', event => { document.body.dataset.theme = event.target.value; });
$('#mode').addEventListener('change', () => {
  clearTimer();
  const off = $('#mode').value === 'off';
  $('#ask').disabled = off;
  if (off) {
    pending = null;
    clearSelection();
    $('#proposal').hidden = true;
    $('#followup').hidden = true;
    $('#welcome').hidden = false;
    announce('Assistência desligada. Continue escrevendo normalmente.');
  } else announce('Assistência local ativada. Peça uma ideia ou continue escrevendo.');
  setState(off ? 'muted' : 'resting');
});
$('#pause').addEventListener('change', () => { clearTimer(); if ($('#pause').checked && document.activeElement === draft) schedulePause(); });
$('#selection-enabled').addEventListener('change', () => { if (!$('#selection-enabled').checked) clearSelection(); });
function updateMotion() {
  const reduced = $('#motion').checked || motionPreference.matches;
  document.body.dataset.reduced = String(reduced);
  document.documentElement.style.scrollBehavior = reduced ? 'auto' : '';
  $('#motion-note').textContent = motionPreference.matches ? 'O sistema está com movimento reduzido' : 'Também respeita seu sistema';
}
$('#motion').addEventListener('change', updateMotion);
motionPreference.addEventListener('change', updateMotion);
document.addEventListener('visibilitychange', () => { document.body.dataset.paused = String(document.hidden); if (document.hidden) { clearTimer(); document.body.classList.remove('animate'); } });
const visibleSurfaces = new Map();
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    visibleSurfaces.set(entry.target, entry.isIntersecting);
    entry.target.dataset.offscreen = String(!entry.isIntersecting);
  });
  stageVisible = [...visibleSurfaces.values()].some(Boolean);
  if (!stageVisible) document.body.classList.remove('animate');
}, { threshold: 0 });
observer.observe($('.playground'));
observer.observe($('.showcase'));
renderRobots();
updateMotion();
count();
setState('resting', false);
