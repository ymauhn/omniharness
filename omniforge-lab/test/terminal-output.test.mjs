import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalOutputBuffer } from '../terminal-output.mjs';

const frame = (sessionId, text, projectId = 'p') => ({ sessionId, projectId, text, stream: 'stdout', at: '2026-09-25T00:00:00Z' });

test('output replay has stable cursors, immutable snapshots and exact scope', () => {
  const buffer = new TerminalOutputBuffer();
  const empty = buffer.read('s', 'p');
  assert.deepEqual([empty.firstSequence, empty.nextSequence, empty.truncated, empty.chunks.length], [1, 1, false, 0]);
  const emitted = buffer.append(frame('s', 'one'));
  buffer.append(frame('s', 'two'));
  const replay = buffer.read('s', 'p', 1);
  assert.equal(replay.epoch, empty.epoch);
  assert.deepEqual(replay.chunks.map(chunk => [chunk.sequence, chunk.text]), [[2, 'two']]);
  emitted[0].text = 'mutated'; replay.chunks[0].text = 'mutated';
  assert.equal(buffer.read('s', 'p').chunks.map(chunk => chunk.text).join(''), 'onetwo');
  assert.throws(() => buffer.read('s', 'other'), error => error.status === 404);
  for (const value of [-1, 1.2, NaN, Infinity, '0']) assert.throws(() => buffer.read('s', 'p', value));
});

test('session byte and frame caps truncate honestly, including future cursors', () => {
  const buffer = new TerminalOutputBuffer({ sessionBytes: 16, totalBytes: 32, maxChunks: 2 });
  for (const text of ['aaaa', 'bbbb', 'cccc']) buffer.append(frame('s', text));
  const replay = buffer.read('s', 'p');
  assert.equal(replay.truncated, true);
  assert.equal(replay.firstSequence, 2);
  assert.deepEqual(replay.chunks.map(chunk => chunk.text), ['bbbb', 'cccc']);
  assert.equal(buffer.read('s', 'p', 1).truncated, false);
  const reset = buffer.read('s', 'p', 100);
  assert.equal(reset.truncated, true);
  assert.equal(reset.chunks.length, 2);
});

test('global/session bounds evict old output and rotate incarnation on full eviction', () => {
  const buffer = new TerminalOutputBuffer({ sessionBytes: 16, totalBytes: 16, maxSessions: 2 });
  const old = buffer.append(frame('a', 'a'.repeat(16)))[0].epoch;
  buffer.append(frame('b', 'b'.repeat(16)));
  assert.equal(buffer.read('a', 'p').truncated, true);
  assert.equal(buffer.read('a', 'p').chunks.length, 0);
  buffer.append(frame('b', 'b'));
  buffer.append(frame('c', 'c'));
  assert.notEqual(buffer.read('a', 'p').epoch, old);
  assert.ok(buffer.bytes <= 16);
  assert.ok(buffer.entries.size <= 2);
});

test('frame boundaries preserve emoji and SSE/replay have identical identities', () => {
  const buffer = new TerminalOutputBuffer({ chunkChars: 4 });
  const text = 'abc🤖def🤖';
  const emitted = buffer.append(frame('s', text));
  assert.equal(emitted.map(chunk => chunk.text).join(''), text);
  assert.ok(emitted.every(chunk => chunk.text.length <= 4 && chunk.text.isWellFormed()));
  assert.deepEqual(buffer.read('s', 'p').chunks, emitted);
  assert.equal(buffer.append(frame('s', '')).length, 0);
  assert.throws(() => buffer.append(frame('s', 'wrong', 'other')));
  const restarted = new TerminalOutputBuffer().read('s', 'p', emitted.length);
  assert.notEqual(restarted.epoch, emitted[0].epoch);
  assert.equal(restarted.truncated, true);
  assert.deepEqual(restarted.chunks, []);
});
