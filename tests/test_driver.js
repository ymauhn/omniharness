'use strict'
// Zero-token stub harness for gauntlet/gauntlet.workflow.js (docs/PHASE0_AUDIT.md section 9, B2 part A).
const fs = require('fs')
const path = require('path')
const assert = require('assert')

// optional argv[2]: another driver copy to prove (e.g. the installed ~/.claude/workflows/gauntlet-driver.js)
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'gauntlet', 'gauntlet.workflow.js'), 'utf8')
const lines = src.split(/\r?\n/)
const metaStart = lines.findIndex((l) => l.startsWith('export const meta'))
assert(metaStart >= 0, 'export const meta not found')
let metaEnd = metaStart + 1
while (lines[metaEnd] !== '}') metaEnd++
const body = lines.slice(0, metaStart).concat(lines.slice(metaEnd + 1)).join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const driver = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', body)

const LENTE1 = 'o código já trata este caso'
const LENTE2 = 'o cenário não é alcançável usando o software de verdade'
const achado = (linha, gravidade = 'media') => ({
  area: 'logic', gravidade, arquivo: 'mod.py', linha, titulo: 't' + linha, cenario: 'c', evidencia: 'e', correcao: 'f',
})

// script = { hunters: {key: {round: reply|null}}, lenses: {'file:line': [reply|null per lens]} }
// An unscripted label throws synchronously inside the thunk, so parallel() cannot swallow it as null.
async function run(script, extra) {
  let counter = 0
  const phases = []
  const logs = []
  const agent = (prompt, opts) => {
    counter += 1000
    const [kind, ...rest] = String(opts.label).split(':')
    let table, key
    if (kind === 'caçar') [table, key] = [script.hunters[rest[0]], Number(rest[1].slice(1))]
    else if (kind === 'refutar') [table, key] = [script.lenses[rest[0] + ':' + rest[1]], Number(rest[2].slice(1)) - 1]
    if (!table || !(key in table)) throw new Error('label sem script: ' + opts.label)
    return Promise.resolve(table[key])
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const args = Object.assign(
    { preset: 'rapido', areas: [{ key: 'logic', prompt: 'p' }, { key: 'nulls', prompt: 'p' }], janelaDup: 4, contexto: 'stub', raiz: 'C:/x' },
    extra,
  )
  const budget = { total: null, spent: () => counter }
  const out = await driver(agent, parallel, null, (s) => phases.push(s), (s) => logs.push(s), args, budget, null)
  return Object.assign(out, { phases, logs, agentCalls: counter / 1000 })
}

const at = (list, linha) => list.find((f) => f.arquivo === 'mod.py' && f.linha === linha)
const identity = (r) => {
  const { achadosBrutos, duplicadosFundidos, descartadosJanela } = r.resumo
  assert.strictEqual(achadosBrutos - duplicadosFundidos - descartadosJanela, r.confirmados.length + r.refutados.length + r.naoVerificados.length, 'identity')
}

const scenarios = {
  async 'S1 null round'() {
    const r = await run({
      hunters: {
        logic: { 1: null, 2: { findings: [achado(10, 'alta'), achado(12), achado(30), achado(50)] } },
        nulls: { 1: null, 2: { findings: [] } },
      },
      lenses: {
        'mod.py:10': [null, { refutado: false, porque: 'ok' }],
        'mod.py:30': [null, null],
        'mod.py:50': [{ refutado: true, porque: 'no' }, { refutado: false, porque: 'ok' }],
      },
    })
    assert.strictEqual(r.resumo.agentesFalhos, 2, 'agentesFalhos')
    assert.strictEqual(r.resumo.lentesFalhas, 3, 'lentesFalhas')
    assert.strictEqual(r.resumo.rodadas, 2, 'rodadas')
    assert.strictEqual(r.resumo.parouPor, 'rodadas', 'parouPor')
    const c10 = at(r.confirmados, 10)
    assert(c10, 'mod.py:10 confirmado')
    assert.strictEqual(c10.votos.length, 1, 'votos de :10')
    assert.strictEqual(c10.votos[0].lente, LENTE2, 'rótulo da lente sobrevivente')
    assert(at(r.naoVerificados, 30) && !at(r.refutados, 30), 'mod.py:30 em naoVerificados, não em refutados')
    const r50 = at(r.refutados, 50)
    assert(r50 && r50.votos.length === 2, 'mod.py:50 refutado com 2 votos')
    assert.strictEqual(r.resumo.duplicadosFundidos, 1, 'duplicadosFundidos')
    identity(r)
    assert(!('maxIteracoesPorCorrecao' in r.resumo), 'maxIteracoesPorCorrecao ausente')
  },
  async 'S2 dry round + window'() {
    const r = await run({
      hunters: {
        logic: { 1: { findings: [achado(30)] }, 2: { findings: [achado(33)] } },
        nulls: { 1: { findings: [] }, 2: { findings: [] } },
      },
      lenses: { 'mod.py:30': [{ refutado: false, porque: 'ok' }, { refutado: false, porque: 'ok' }] },
    })
    assert.strictEqual(r.resumo.descartadosJanela, 1, 'descartadosJanela')
    assert.strictEqual(r.resumo.parouPor, 'secou', 'parouPor')
    identity(r)
    assert.strictEqual(r.confirmados.length, 1, 'um confirmado')
    assert.deepStrictEqual(r.confirmados[0].votos.map((v) => v.lente), [LENTE1, LENTE2], 'dois rótulos distintos de lente')
  },
  async 'S3 ceiling'() {
    const r = await run(
      { hunters: { logic: { 1: { findings: [achado(30)] } }, nulls: { 1: { findings: [] } } }, lenses: {} },
      { tetoTokens: 2000 },
    )
    assert.strictEqual(r.resumo.parouPor, 'teto', 'parouPor')
    assert.strictEqual(r.refutados.length, 0, 'refutados vazio')
    assert.strictEqual(r.naoVerificados.length, r.resumo.achadosBrutos - r.resumo.duplicadosFundidos - r.resumo.descartadosJanela, 'tudo em naoVerificados')
    assert.strictEqual(r.agentCalls, 2, 'só os dois caçadores rodaram')
  },
}

;(async () => {
  let failed = 0
  for (const [name, fn] of Object.entries(scenarios)) {
    try {
      await fn()
      console.log('PASS ' + name)
    } catch (e) {
      failed++
      console.log('FAIL ' + name + ': ' + (e && e.message))
    }
  }
  process.exit(failed ? 1 : 0)
})()
