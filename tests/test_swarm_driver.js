'use strict'
const fs = require('fs')
const assert = require('assert')
const path = require('path')
const {createHash} = require('crypto')
const src = fs.readFileSync(path.join(__dirname, '../swarm/swarm.workflow.js'), 'utf8')
const body = src.replace(/export const meta = \{[\s\S]*?^\}/m, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const driver = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', 'budget', 'isolation', body)
const tests = {command: 'local-check', exit_code: 0, passed: true, count: 3}
const tasks = [{id: 'a', prompt: 'A', scope: ['src/a/**'], dependsOn: []},
               {id: 'b', prompt: 'B', scope: ['src/b.py'], dependsOn: ['a']}]
async function run(options = {}, transform = x => x, host = true, settlement = {usd: 0.01, tokens: 20}, verified = true, preflight = true) {
  const calls = [], leases = []
  const checks = []
  let base = 'a'.repeat(40)
  const args = {tasks, baseCommit: base, approvalReference: 'fixture-only',
    envelope: {mode: 'swarm', remaining: {usd: 2, tokens: 10000}}, perAgent: {usd: 0.1, tokens: 100}, ...options}
  const budget = host ? {
    reserve: async cap => { const id = leases.length; leases.push(cap); return id },
    settle: async lease => {
      if (settlement === null) return null
      const call = calls.find(call => call.reservation === lease)
      const label = call?.label
      const override = typeof settlement === 'function' ? settlement(label, lease) : settlement
      return {usd: 0.01, tokens: 20, usage_complete: true, usage_scope: 'whole-tree', attempt_id: label,
        reservation: lease, worker_identity: call?.worker_identity,
        source_sha256: createHash('sha256').update(label).digest('hex'), ...override}
    },
    cancel: async id => { leases[id].cancelled = true },
    ...(typeof host === 'object' ? host : {}),
  } : {spent: () => 0}
  const agent = async (prompt, o) => {
    calls.push(o)
    let result
    if (o.label.startsWith('implement:')) {
      const [, id, candidate] = o.label.split(':')
      const task = args.tasks.find(t => t.id === id)
      assert.equal(o.isolation, 'worktree')
      assert(prompt.includes(base), 'dependent worker must use the integrated base')
      result = {task: id, worktree: '/worktrees/' + id + candidate, branch: 'codex/' + id + candidate,
        base_commit: base, changed_files: [task.scope[0].replace('/**', '/file.py')], tests,
        net_lines: Number(candidate) + 1, execution_valid: true}
    } else if (o.label.startsWith('integrate:')) {
      base = String(calls.length).repeat(40).slice(0, 40)
      result = {execution_valid: true, conflicts: [], tests, commit: base}
    } else {
      result = {execution_valid: true, approved: true, findings: [], checks: ['ponytail-review', 'code-review']}
    }
    return transform({...result, worker_identity: o.worker_identity}, o, prompt)
  }
  const isolation = preflight === null ? undefined : {
    preflight: async context => {
      checks.push(['preflight', context.label])
      const result = typeof preflight === 'function' ? preflight(context) : preflight
      return result === null ? null : {os_sandbox_verified: result === false ? false : true,
        attempt_id: context.label, reservation: context.reservation,
        worker_identity: 'worker-' + context.label,
        ...(typeof result === 'object' ? result : {})}
    },
    verify: async (report, context) => {
      checks.push(['verify', context.label])
      const result = typeof verified === 'function' ? verified(context) : verified
      return result === null ? null : {scope_ok: result === false ? false : true,
        os_sandbox_verified: result === false ? false : true,
        attempt_id: context.label, reservation: context.reservation,
        worker_identity: context.admission.worker_identity,
        ...(typeof result === 'object' ? result : {})}
    },
  }
  const result = await driver(agent, ts => Promise.all(ts.map(t => t())), () => {}, () => {}, args, budget, isolation)
  return {result, calls, leases, checks}
}
;(async () => {
  await assert.rejects(() => run({tasks: [tasks[0], {...tasks[1], scope: ['src/a/nested/**']}]}), /overlap/)
  await assert.rejects(() => run({tasks: [{...tasks[0], dependsOn: ['b']}, tasks[1]]}), /cycle/)
  await assert.rejects(() => run({tasks: [{...tasks[0], scope: ['../outside/**']}]}), /scope/)
  await assert.rejects(() => run({tasks: [{...tasks[0], scope: ['.agents/skills/**']}]}), /scope/)
  console.log('PASS scope and dependency validation before spawning')
  const good = await run()
  assert.equal(good.result.parouPor, 'complete')
  assert.deepEqual(good.calls.map(c => c.label), ['implement:a:0', 'integrate:1', 'implement:b:0', 'integrate:2', 'review'])
  assert.equal(good.result.usage.tokens, 100)
  assert.equal(good.leases.length, 5)
  assert(good.calls.every(call => call.worker_identity === 'worker-' + call.label))
  assert.deepEqual(good.checks, good.calls.flatMap(call =>
    [['preflight', call.label], ['verify', call.label]]))
  console.log('PASS worktree request, dependency waves, integration, review and all-role usage')
  const missing = await run({}, x => x, false)
  assert.equal(missing.result.parouPor, 'budget-unavailable')
  assert.equal(missing.calls.length, 0)
  const conflict = await run({}, (r, o) => o.label.startsWith('integrate:') ? {...r, conflicts: ['src/a/file.py']} : r)
  assert.equal(conflict.result.parouPor, 'conflict')
  assert(!conflict.calls.some(c => c.label === 'review'))
  const bad = await run({}, (r, o) => o.label.startsWith('implement:') ? {...r, changed_files: ['secrets.txt']} : r)
  assert.equal(bad.result.parouPor, 'invalid-report')
  console.log('PASS unavailable accounting, conflicts and scope violations stop')
  const unverified = await run({}, x => x, true, {usd: 0.01, tokens: 20}, false)
  assert.equal(unverified.result.parouPor, 'isolation')
  assert(!unverified.calls.some(c => c.label.startsWith('integrate:')))
  for (const preflight of [false, null]) {
    const refused = await run({}, x => x, true, {usd: 0.01, tokens: 20}, true, preflight)
    assert.equal(refused.calls.length, 0)
    assert.equal(refused.result.parouPor, preflight === null ? 'isolation-unavailable' : 'isolation')
  }
  console.log('PASS model reports cannot certify scope or OS isolation')
  for (const missingRole of ['integrate:1', 'review']) {
    const missingProof = await run({}, x => x, true, {usd: 0.01, tokens: 20},
      context => context.label === missingRole ? null : true)
    assert.equal(missingProof.result.parouPor, 'isolation')
    assert(missingProof.checks.some(([kind, label]) => kind === 'verify' && label === missingRole))
    assert(!missingProof.result.parouPor.includes('complete'))
    const missingAdmission = await run({}, x => x, true, {usd: 0.01, tokens: 20}, true,
      context => context.label === missingRole ? null : true)
    assert.equal(missingAdmission.result.parouPor, 'isolation')
    assert(!missingAdmission.calls.some(call => call.label === missingRole))
  }
  console.log('PASS integration and review each require per-attempt isolation admission and verification')
  const missingWorker = await run({}, x => x, true, {usd: 0.01, tokens: 20}, true,
    context => context.label === 'integrate:1' ? {worker_identity: ''} : true)
  assert.equal(missingWorker.result.parouPor, 'isolation')
  assert(!missingWorker.calls.some(call => call.label === 'integrate:1'))
  const reportedB = await run({}, (report, call) => call.label === 'integrate:1'
    ? {...report, worker_identity: 'worker-B'} : report)
  assert.equal(reportedB.result.parouPor, 'isolation')
  assert(reportedB.calls.some(call => call.label === 'integrate:1' &&
    call.worker_identity === 'worker-integrate:1'))
  assert(!reportedB.calls.some(call => call.label === 'implement:b:0'))
  const verifiedB = await run({}, x => x, true, {usd: 0.01, tokens: 20},
    context => context.label === 'review' ? {worker_identity: 'worker-B'} : true)
  assert.equal(verifiedB.result.parouPor, 'isolation')
  assert(verifiedB.calls.some(call => call.label === 'review'))
  console.log('PASS admitted worker identity must match agent report and host verification')
  let reserved = 0
  const cancelled = []
  const partial = await run({tasks: [tasks[0]], tournament: 2}, x => x, {
    reserve: async () => reserved++ === 0 ? 'lease-a' : null,
    cancel: async lease => cancelled.push(lease),
  })
  assert.equal(partial.calls.length, 0)
  assert.deepEqual(cancelled, ['lease-a'])
  console.log('PASS partial wave reservation releases only unstarted leases')
  const duplicateCancels = []
  const duplicate = await run({tasks: [tasks[0]], tournament: 2}, x => x, {
    reserve: async () => 'shared-lease',
    cancel: async lease => duplicateCancels.push(lease),
  })
  assert.equal(duplicate.result.parouPor, 'budget')
  assert.equal(duplicate.calls.length, 0)
  assert.deepEqual(duplicateCancels, ['shared-lease'])
  const reusedCancels = []
  let reuseCount = 0
  const reused = await run({}, x => x, {
    reserve: async () => reuseCount++ === 0 ? 'lease-1' : 'lease-1',
    cancel: async lease => reusedCancels.push(lease),
  })
  assert.equal(reused.result.parouPor, 'budget')
  assert.deepEqual(reused.calls.map(call => call.label), ['implement:a:0'])
  assert.deepEqual(reusedCancels, [])
  const unsafeLease = await run({}, x => x, {
    reserve: async () => ({id: 'lease-1'}),
  })
  assert.equal(unsafeLease.result.parouPor, 'budget')
  assert.equal(unsafeLease.calls.length, 0)
  console.log('PASS duplicate and unsafe reservation identities stop before agent launch')
  const tournament = await run({tasks: [tasks[0]], tournament: 2}, (r, o) => o.label === 'implement:a:0' ? {...r, tests: {...tests, passed: false, exit_code: 1}} : r)
  assert.equal(tournament.result.parouPor, 'complete')
  assert.equal(tournament.result.winners[0].branch, 'codex/a1')
  assert.equal(tournament.result.usage.tokens, 80)
  console.log('PASS tournament chooses passing candidate and counts losing candidate')
  const exhausted = await run({envelope: {mode: 'swarm', remaining: {usd: 0.01, tokens: 2}}})
  assert.equal(exhausted.result.parouPor, 'budget')
  assert.equal(exhausted.calls.length, 0)
  const unknown = await run({}, x => x, true, null)
  assert.equal(unknown.result.parouPor, 'accounting')
  assert.equal(unknown.result.usage.tokens, null)
  assert.equal(unknown.calls.length, 1)
  for (const settlement of [{usage_complete: false}, {usage_scope: 'reported-turn'},
                            {attempt_id: 'foreign'},
                            {reservation: 'other'}, {worker_identity: 'worker-B'},
                            {source_sha256: 'unbound'}]) {
    const unbound = await run({}, x => x, true, settlement)
    assert.equal(unbound.result.parouPor, 'accounting')
    assert.equal(unbound.result.usage.tokens, null)
    assert.equal(unbound.calls.length, 1)
  }
  const replayed = await run({}, x => x, true, {source_sha256: 'a'.repeat(64)})
  assert.equal(replayed.result.parouPor, 'accounting')
  assert.equal(replayed.result.usage.tokens, null)
  assert.equal(replayed.calls.length, 2)
  for (const missingRole of ['integrate:1', 'review']) {
    const incomplete = await run({}, x => x, true,
      label => label === missingRole ? {usage_complete: false} : {})
    assert.equal(incomplete.result.parouPor, 'accounting')
    assert.equal(incomplete.result.usage.tokens, null)
    assert(incomplete.calls.some(call => call.label === missingRole))
  }
  const over = await run({}, x => x, true, {usd: 1, tokens: 200})
  assert.equal(over.result.parouPor, 'accounting')
  const failing = await run({}, (r, o) => o.label.startsWith('implement:') ? {...r, tests: {...tests, count: 0}} : r)
  assert.equal(failing.result.parouPor, 'tests-failed')
  const reviewed = await run({}, (r, o) => o.label === 'review' ? {...r, checks: []} : r)
  assert.equal(reviewed.result.parouPor, 'review-failed')
  const milestone = await run({tasks: [{...tasks[0], stop: 'owner checkpoint'}]})
  assert.equal(milestone.result.parouPor, 'milestone')
  assert.equal(milestone.calls.length, 0)
  console.log('PASS budget admission, unknown/over-cap usage, empty tests, missing review and milestone')
})().catch(e => { console.error(e); process.exitCode = 1 })
