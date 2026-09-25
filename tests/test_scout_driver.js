'use strict'
// Zero-token stub harness for scout/scout.workflow.js: the driver body runs against a scripted agent keyed by label.
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'scout', 'scout.workflow.js'), 'utf8')
const lines = src.split(/\r?\n/)
const metaStart = lines.findIndex((l) => l.startsWith('export const meta'))
assert(metaStart >= 0, 'export const meta not found')
let metaEnd = metaStart + 1
while (lines[metaEnd] !== '}') metaEnd++
assert(/name:\s*'scout-driver'/.test(lines.slice(metaStart, metaEnd).join('\n')), 'meta.name must be scout-driver')
assert(!/`/.test(src), 'no template literals in the driver (harness parser gotcha)')
const body = lines.slice(0, metaStart).concat(lines.slice(metaEnd + 1)).join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const driver = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', body)

const ref = (url, extra) => Object.assign({ titulo: 't', url, porque: 'p', padrao: 'x', evidencia: 'e' }, extra)
const fontes = [{ key: 'github', prompt: 'g' }, { key: 'hn', prompt: 'h' }, { key: 'producthunt', prompt: 'ph' }]

// script = { fontes: {key: reply|null}, sintese: reply|undefined }; an unscripted label throws inside the thunk.
async function run(script, extra) {
  let counter = 0
  const phases = []
  const agent = (prompt, o) => {
    counter += 1000
    const [kind, key] = String(o.label).split(':')
    if (kind === 'vasculhar') {
      if (!(key in script.fontes)) throw new Error('label sem script: ' + o.label)
      return Promise.resolve(script.fontes[key])
    }
    if (kind === 'sintetizar') {
      if (!('sintese' in script)) throw new Error('síntese não deveria rodar: ' + o.label)
      assert(/REFERÊNCIAS:\n1\./.test(prompt), 'synthesis prompt carries the numbered list')
      return Promise.resolve(script.sintese)
    }
    throw new Error('label desconhecido: ' + o.label)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const args = Object.assign({ demanda: 'landing pages de comunidades', fontes, porFonte: 2 }, extra)
  const budget = { total: null, spent: () => counter }
  const out = await driver(agent, parallel, null, (s) => phases.push(s), () => {}, args, budget, null)
  return Object.assign(out, { phases, agentCalls: counter / 1000 })
}

const scenarios = {
  async 'S1 dedupe across sources and per-source cap'() {
    const r = await run({
      fontes: {
        github: { referencias: [ref('https://github.com/a/b'), ref('https://GITHUB.com/a/b#readme'), ref('https://github.com/c/d?utm_source=x'), ref('https://github.com/e/f')], degradado: false },
        hn: { referencias: [ref('https://github.com/c/d?utm_source=x#section'), ref('https://news.ycombinator.com/item?id=1')], degradado: false },
        producthunt: { referencias: [], degradado: true, motivo: 'sem chave de API, WebSearch site:producthunt.com' },
      },
      sintese: { padroes: [{ nome: 'P', descricao: 'd', urls: ['https://github.com/a/b', 'https://nao.esta/na/lista'] }], lacunas: ['l'], recomendacoes: ['r'] },
    })
    assert.strictEqual(r.parouPor, 'sintetizado')
    assert.deepStrictEqual(r.referencias.map((x) => x.url), ['https://github.com/a/b', 'https://github.com/c/d?utm_source=x', 'https://news.ycombinator.com/item?id=1'])
    assert.strictEqual(r.resumo.duplicatasRemovidas, 2) // host case/fragment only; path and query still identify pages
    assert.deepStrictEqual(r.resumo.porFonte, { github: 2, hn: 1, producthunt: 0 }) // cap 2 dropped e/f
    assert.deepStrictEqual(r.padroes[0].urls, ['https://github.com/a/b']) // foreign URL filtered out
    assert.deepStrictEqual(r.resumo.fontesDegradadas, ['producthunt (sem chave de API, WebSearch site:producthunt.com)'])
    assert.deepStrictEqual(r.resumo.fontesFalhas, [])
    assert.deepStrictEqual(r.phases, ['Vasculhar', 'Sintetizar'])
    assert.strictEqual(r.agentCalls, 4)
    assert(/## Padrões/.test(r.dossieMarkdown) && /\| 1 \| github \|/.test(r.dossieMarkdown), 'markdown carries patterns and the table')
  },
  async 'S2 a dead source does not stop the others'() {
    const r = await run({
      fontes: { github: null, hn: { referencias: [ref('https://x.y/1')], degradado: false }, producthunt: { referencias: [ref('https://x.y/2')], degradado: false } },
      sintese: { padroes: [], lacunas: [], recomendacoes: [] },
    })
    assert.deepStrictEqual(r.resumo.fontesFalhas, ['github'])
    assert.strictEqual(r.referencias.length, 2)
    assert.strictEqual(r.parouPor, 'sintetizado')
  },
  async 'S3 ceiling before synthesis keeps the references'() {
    const r = await run(
      { fontes: { github: { referencias: [ref('https://x.y/1')], degradado: false }, hn: { referencias: [], degradado: false }, producthunt: { referencias: [], degradado: false } } },
      { tetoTokens: 3000 }, // three search agents cost 3000 stub tokens: 80% margin is reached before synthesis
    )
    assert.strictEqual(r.parouPor, 'teto')
    assert.strictEqual(r.referencias.length, 1)
    assert.deepStrictEqual(r.padroes, [])
    assert.deepStrictEqual(r.phases, ['Vasculhar'])
    assert(/Parou por: teto/.test(r.dossieMarkdown))
  },
  async 'S4 no references means no synthesis'() {
    const r = await run({ fontes: { github: { referencias: [], degradado: false }, hn: null, producthunt: null } })
    assert.strictEqual(r.parouPor, 'sem-referencias')
    assert.deepStrictEqual(r.resumo.fontesFalhas, ['hn', 'producthunt'])
    assert.strictEqual(r.agentCalls, 3)
  },
  async 'S5 args are validated'() {
    await assert.rejects(() => run({ fontes: {} }, { fontes: [] }), /precisa de args.demanda/)
  },
  async 'S6 cold/warm history preserves distinct query IDs and scope'() {
    const script = { fontes: { github: { referencias: [ref('https://news.ycombinator.com/item?id=1'), ref('https://news.ycombinator.com/item?id=2')], degradado: false }, hn: { referencias: [] }, producthunt: { referencias: [] } }, sintese: { padroes: [], lacunas: [], recomendacoes: [] } }
    const cold = await run(script)
    assert.strictEqual(cold.referencias.length, 2)
    assert.strictEqual(cold.resumo.agentes, 4)
    assert.strictEqual(cold.seenUpdates.length, 2)
    const scope = { seenScope: 'one', seenContext: 'a'.repeat(64) }
    const seen = { consumer: 'scout', scope: scope.seenScope, context: scope.seenContext, records: cold.seenUpdates }
    const warm = await run(script, { ...scope, seen })
    assert.strictEqual(warm.resumo.reused, 2)
    assert.strictEqual(warm.agentCalls, 3)
    assert.deepStrictEqual(warm.seenUpdates, [])
    await assert.rejects(() => run(script, { ...scope, seen, seenContext: 'b'.repeat(64) }), /seen/)
    const failed = await run({ ...script, sintese: {} })
    assert.deepStrictEqual(failed.seenUpdates, [])
    console.log('MEASURE scout offline: cold=' + cold.agentCalls + ' warm=' + warm.agentCalls + ' calls; reused=' + warm.resumo.reused)
  },
}

;(async () => {
  let failed = 0
  for (const [name, fn] of Object.entries(scenarios)) {
    try { await fn(); console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e)) }
  }
  process.exit(failed ? 1 : 0)
})()
