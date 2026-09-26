import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readCodexRateLimits, usageFigures } from '../usage.mjs';

// A stand-in App Server: answers initialize, then account/rateLimits/read with the given reply.
const fake = reply => (command, args, options) => spawn(process.execPath, ['-e', `
  const rl = require('node:readline').createInterface({ input: process.stdin });
  rl.on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake', codexHome: 'x', platformFamily: 'windows', platformOs: 'windows' } }));
    if (message.method === 'account/rateLimits/read') { const reply = ${JSON.stringify(reply)}; if (reply !== 'hang') console.log(JSON.stringify({ id: message.id, ...reply })); }
  });`], options);

test('Codex quota is read from the App Server with its source, scope and time, never as a task receipt', async () => {
  const figure = await readCodexRateLimits({ codexPath: 'codex.exe', spawnProcess: fake({ result: { rateLimits: {
    planType: 'plus', primary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: 1790500000 }, secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: null } } } }), now: () => new Date('2026-09-26T05:00:00Z') });
  assert.equal(figure.kind, 'subscription-quota');
  assert.equal(figure.status, 'observado');
  assert.equal(figure.source, 'codex app-server account/rateLimits/read');
  assert.match(figure.scope, /conta/);
  assert.equal(figure.observedAt, '2026-09-26T05:00:00.000Z');
  assert.deepEqual(figure.windows, [{ label: 'principal', usedPercent: 96, windowMinutes: 10080, resetsAt: '2026-09-27T09:06:40.000Z' }]);
  assert.equal(figure.plan, 'plus');
});

test('a missing, failing, malformed or silent App Server yields an explicit unknown, never zero', async () => {
  for (const [name, spawnProcess] of [
    ['error', fake({ error: { code: -32000, message: 'not logged in' } })],
    ['malformed', fake({ result: { rateLimits: { primary: { usedPercent: 'many' } } } })],
    ['silent', fake('hang')],
    ['absent', () => { throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }); }],
  ]) {
    const figure = await readCodexRateLimits({ codexPath: 'codex.exe', spawnProcess, timeoutMs: 1500 });
    assert.equal(figure.status, 'desconhecido', name);
    assert.equal(figure.windows, null, name);
    assert.ok(figure.reason, name);
  }
});

test('an App Server that exits before replying is reported as such, not as a timeout', async () => {
  const started = Date.now();
  const figure = await readCodexRateLimits({ codexPath: 'codex.exe', spawnProcess: (command, args, options) => spawn(process.execPath, ['-e', 'process.exit(3)'], options), timeoutMs: 5000 });
  assert.equal(figure.status, 'desconhecido');
  assert.match(figure.reason, /encerrou sem responder \(código 3\)/);
  assert.ok(Date.now() - started < 4000, `${Date.now() - started} ms`);
});

test('the four usage figures stay separate and unknown values are null with a reason', () => {
  const figures = usageFigures({ codexQuota: null });
  assert.deepEqual(figures.map(figure => figure.kind), ['subscription-quota', 'measured-tokens', 'estimated-cost', 'confirmed-billing']);
  for (const figure of figures) {
    assert.equal(figure.value ?? null, null, figure.kind);
    assert.equal(figure.status, figure.kind === 'subscription-quota' ? 'não consultado' : 'desconhecido');
    assert.ok(figure.reason && figure.source, figure.kind);
  }
});
