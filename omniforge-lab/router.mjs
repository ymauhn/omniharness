// System-1 router: for one task it SUGGESTS a host, an installed skill and an effort tier. It never starts a run and
// grants no authority; the owner still clicks "Rodar com …". Laya answers when the owner has loaded it (local, free);
// JEV only with a key in the Windows vault AND the owner's opt-in for this one request. An abstention, a low score or
// any failure falls back to the lexical catalog match, which covers the skill only: host and effort stay unsuggested.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runCatalog, harnessPython } from './catalog-service.mjs';
import { skillCandidates } from './copilot-classification.mjs';
import { utf8Excerpt } from './copilot-provider.mjs';

// What the classifier reads; routing policy text, uncalibrated like the adapter's thresholds.
const HOSTS = [
  { source_id: 'host:claude', description: 'Claude Code: planning, open-ended design, writing, explanation and review across a project' },
  { source_id: 'host:codex', description: 'Codex: a focused code change, bug fix, test or refactor inside a repository' },
];
const EFFORTS = [
  { source_id: 'effort:baixo', description: 'Small, well-defined change: a few lines or one file, such as a typo, a rename or a setting' },
  { source_id: 'effort:medio', description: 'A feature or bug fix across several files, with tests' },
  { source_id: 'effort:alto', description: 'Large or ambiguous work: architecture, migration, research or many modules' },
];
const VALUE = { 'host:claude': 'claude', 'host:codex': 'codex', 'effort:baixo': 'baixo', 'effort:medio': 'médio', 'effort:alto': 'alto' };
const REASONS = new Set(['selected', 'none', 'below_threshold', 'selected_fit_failed', 'invalid_response', 'provider_failed', 'missing_key', 'invalid_input']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// JEV through the harness adapter's stdin bridge: the key travels on stdin, never on a command line or to the page.
export function jevBridge({ repoRoot, python = harnessPython(), run = runCatalog }) {
  return (prompt, questions, apiKey) => run(python, ['-I', path.join(repoRoot, 'harness', 'prompt_classifier.py')],
    { cwd: repoRoot, input: { api_key: apiKey, prompt, questions }, timeout: 30000 });
}

export async function routeTask({ task, input }, { catalog, classifier, keys, jevSelect }) {
  if (Object.keys(input).some(key => key !== 'jev') || (input.jev !== undefined && typeof input.jev !== 'boolean')) fail(400, 'Pedido de sugestão inválido.');
  const started = performance.now();
  const jevKey = keys.list().find(row => row.provider === 'jev');
  if (input.jev && !jevKey) fail(409, 'Nenhuma chave Jev no cofre do Windows.');
  const prompt = utf8Excerpt(task.details ? `${task.title}\n\n${task.details}` : task.title);
  const { rows, candidates } = await skillCandidates(catalog, prompt);
  const questions = { host: HOSTS, effort: EFFORTS, ...(candidates.length && { skill: candidates }) };
  let provider = null, answers = {};
  if (input.jev) {
    provider = 'jev';
    const secret = await keys.secretFor(jevKey.ref).catch(() => null);
    if (secret) answers = await jevSelect(prompt, questions, secret).catch(() => ({}));
  } else if (classifier.status().enabled) {
    provider = 'laya';
    // One at a time: the worker queue (one active, two waiting) is shared with the Copilot.
    for (const [name, list] of Object.entries(questions)) answers[name] = await classifier.select(prompt, list).catch(() => null);
  }
  const field = (name, lexical = null) => {
    const answer = answers?.[name], list = questions[name];
    if (!list) return { value: lexical, source: 'lexical', probability: null, reason: 'no_candidates' };
    if (!provider) return { value: lexical, source: 'lexical', probability: null, reason: null };
    const valid = answer?.provider === provider && answer.runnable === false && REASONS.has(answer.reason) &&
      (answer.reason !== 'selected' || list.some(row => row.source_id === answer.source_id));
    if (!valid) return { value: lexical, source: 'lexical', probability: null, reason: 'unavailable' };
    const probability = typeof answer.probability === 'number' && answer.probability >= 0 && answer.probability <= 1 ? answer.probability : null;
    if (answer.reason === 'selected') return { value: VALUE[answer.source_id] ?? answer.source_id, source: provider, probability, reason: 'selected' };
    return { value: lexical, source: 'lexical', probability, reason: answer.reason };
  };
  const skill = field('skill', rows[0]?.skill_id ?? null);
  return { taskId: task.id, provider, host: field('host'), skill: { ...skill, name: rows.find(row => row.skill_id === skill.value)?.name ?? null },
    effort: field('effort'), latencyMs: Math.round(performance.now() - started), jevAvailable: Boolean(jevKey), runnable: false };
}
