'use strict'
const fs = require('fs')
const assert = require('assert')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '../swarm/swarm.workflow.js'), 'utf8')
const body = src.replace(/export const meta = \{[\s\S]*?^\}/m, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const driver = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', 'budget', 'isolation', body)
const tests = {command: 'local-check', exit_code: 0, passed: true, count: 3}
const tasks = [{id: 'a', prompt: 'A', scope: ['src/a/**'], dependsOn: []},
               {id: 'b', prompt: 'B', scope: ['src/b.py'], dependsOn: ['a']}]
async function run(options = {}, transform = x => x, host = true, settlement = {usd: 0.01, tokens: 20}, verified = true, preflight = true) {
  const calls = [], leases = []
  let base = 'a'.repeat(40)
  const args = {tasks, baseCommit: base, approvalReference: 'fixture-only',
    envelope: {mode: 'swarm', remaining: {usd: 2, tokens: 10000}}, perAgent: {usd: 0.1, tokens: 100}, ...options}
  const budget = host ? {
    reserve: async cap => { const id = leases.length; leases.push(cap); return id },
    settle: async () => settlement,
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
    return transform(result, o, prompt)
  }
  const isolation = preflight === null ? undefined : {preflight: async () => ({os_sandbox_verified: preflight}), verify: async () => ({scope_ok: verified, os_sandbox_verified: verified})}
  const result = await driver(agent, ts => Promise.all(ts.map(t => t())), () => {}, () => {}, args, budget, isolation)
  return {result, calls, leases}
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
  let reserved = 0
  const cancelled = []
  const partial = await run({tasks: [tasks[0]], tournament: 2}, x => x, {
    reserve: async () => reserved++ === 0 ? 'lease-a' : null,
    cancel: async lease => cancelled.push(lease),
  })
  assert.equal(partial.calls.length, 0)
  assert.deepEqual(cancelled, ['lease-a'])
  console.log('PASS partial wave reservation releases only unstarted leases')
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
