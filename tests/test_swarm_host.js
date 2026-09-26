'use strict'
// Drives the real swarm.workflow.js body over SwarmHost's JSON-lines RPC.
// The Python fixture uses fake Docker and a fake model turn: no model, network or real Docker.
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const readline = require('readline')
const {spawn} = require('child_process')
const src = fs.readFileSync(path.join(__dirname, '../swarm/swarm.workflow.js'), 'utf8')
const body = src.replace(/export const meta = \{[\s\S]*?^\}/m, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const driver = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', 'budget', 'isolation', body)
// Same runtime selection as scripts/check.ps1.
const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
const python = process.env.OMNIHARNESS_PYTHON || (fs.existsSync(bundled) ? bundled : 'python')
const tasks = ['a', 'b'].map(id => ({id, prompt: id.toUpperCase(), scope: ['src/' + id + '/**'], dependsOn: []}))

async function drive(scenario) {
  const child = spawn(python, [path.join(__dirname, 'fixtures/swarm_host_fixture.py'), scenario],
    {cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'inherit'], env: {...process.env, PYTHONIOENCODING: 'utf-8'}})
  const pending = new Map()
  let next = 0, summary, ready
  const started = new Promise(resolve => { ready = resolve })
  const closed = new Promise((resolve, reject) => child.on('close', code => {
    for (const {reject: fail} of pending.values()) fail(new Error('fixture exited'))
    code === 0 ? resolve() : reject(new Error(scenario + ' fixture exited ' + code))
  }))
  readline.createInterface({input: child.stdout, crlfDelay: Infinity}).on('line', line => {
    const message = JSON.parse(line)
    if (message.ready) return ready(message.ready)
    if (message.summary) { summary = message.summary; return }
    const call = pending.get(message.id)
    pending.delete(message.id)
    'error' in message ? call.reject(new Error(message.error)) : call.resolve(message.result)
  })
  const rpc = (op, ...args) => new Promise((resolve, reject) => {
    const id = next++
    pending.set(id, {resolve, reject})
    child.stdin.write(JSON.stringify({id, op, args}) + '\n')
  })
  const {base} = await started
  const args = {tasks, baseCommit: base, approvalReference: 'fixture-only', tournament: 2,
    envelope: {mode: 'swarm', remaining: {usd: 2, tokens: 10000}}, perAgent: {usd: 0.1, tokens: 100}}
  const result = await driver((prompt, options) => rpc('agent', prompt, options),
    ts => Promise.all(ts.map(t => t())), () => {}, () => {}, args,
    {reserve: cap => rpc('reserve', cap), settle: lease => rpc('settle', lease), cancel: lease => rpc('cancel', lease)},
    {preflight: attempt => rpc('preflight', attempt), verify: (report, context) => rpc('verify', report, context)})
  child.stdin.end()
  await closed
  return {result, summary, row: label => summary.attempts.find(row => row.label === label)}
}

const wave = ['implement:a:0', 'implement:a:1', 'implement:b:0', 'implement:b:1']
;(async () => {
  const closed = await drive('closed')
  assert.equal(closed.result.parouPor, 'isolation')
  assert.deepEqual([closed.summary.containers, closed.summary.launches.length], [0, 0])
  assert.deepEqual(closed.summary.attempts.map(row => [row.label, row.state]), wave.map(label => [label, 'cancelled']))
  console.log('PASS T3 closed managed admission: no worktree, container or agent; every wave lease cancelled')

  const open = await drive('open')
  assert.equal(open.result.parouPor, 'isolation')
  const implemented = wave.map(open.row)
  assert(implemented.every(row => row.state === 'settled'))
  for (const key of ['docker_id', 'worker_identity', 'session', 'source_sha256']) {
    assert.equal(new Set(implemented.map(row => row[key])).size, 4, key)
  }
  assert.deepEqual([open.summary.containers, open.summary.removed, open.summary.launches.length], [4, 4, 4])
  assert.deepEqual(open.result.attempts.filter(attempt => attempt.usage).map(attempt => attempt.usage.attempt_id).sort(), wave)
  assert.equal(open.result.winners.length, 2)
  assert.deepEqual([open.row('integrate:1').state, open.row('integrate:1').docker_id], ['cancelled', null])
  assert.equal(open.row('review'), undefined)
  assert.equal(open.result.usage.tokens, 60)
  console.log('PASS T4 four candidates settle under distinct identities; integration stays closed with no container')

  const retry = await drive('retry')
  assert.equal(retry.result.parouPor, 'budget')
  assert.deepEqual([retry.summary.containers, retry.row('implement:a:0').state], [0, 'running'])
  console.log('PASS T5 a started label cannot be reserved again')

  for (const scenario of ['crash', 'over']) {
    const stopped = await drive(scenario)
    assert.equal(stopped.result.parouPor, 'accounting', scenario)
    assert.equal(stopped.summary.blocked, true)
    // Which sibling launched before the stop is timing-dependent; the stopped task is not.
    const rows = ['implement:a:0', 'implement:a:1'].map(stopped.row)
    if (scenario === 'crash') {
      assert(rows.some(row => row.state === 'unknown'))
      assert.equal(stopped.result.usage.tokens, null)
    } else {
      assert(rows.some(row => row.reservation_exceeded === true))
      assert(stopped.result.usage.tokens >= 500, 'over-cap usage is reported unclipped')
    }
  }
  console.log('PASS T9/T11 crashed or over-reservation usage blocks the run and stops the driver')

  const small = await drive('small')
  assert.equal(small.result.parouPor, 'budget')
  assert.equal(small.summary.containers, 0)
  assert(small.summary.attempts.every(row => row.state === 'cancelled'))
  console.log('PASS T11 a ledger budget smaller than the wave starts no container')
})().catch(e => { console.error(e); process.exitCode = 1 })
