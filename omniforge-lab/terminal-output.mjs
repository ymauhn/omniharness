import { randomUUID } from 'node:crypto';

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }

// Volatile bounded replay, not a durable transcript or process-containment boundary.
export class TerminalOutputBuffer {
  constructor({ sessionBytes = 256 * 1024, totalBytes = 2 * 1024 * 1024, maxSessions = 32, maxChunks = 512, chunkChars = 8192 } = {}) {
    for (const value of [sessionBytes, totalBytes, maxSessions, maxChunks, chunkChars]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid replay bound');
    }
    if (sessionBytes < 8 || totalBytes < 8 || chunkChars < 2) throw new Error('Replay bounds too small');
    Object.assign(this, { sessionBytes, totalBytes, maxSessions, maxChunks });
    this.chunkChars = Math.min(chunkChars, Math.floor(sessionBytes / 4), Math.floor(totalBytes / 4));
    this.entries = new Map();
    this.bytes = 0;
  }

  entry(sessionId, projectId) {
    if (![sessionId, projectId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 120)) fail('Escopo de saída inválido');
    let entry = this.entries.get(sessionId);
    if (entry && entry.projectId !== projectId) fail('Sessão não encontrada neste projeto', 404);
    if (!entry) {
      while (this.entries.size >= this.maxSessions) {
        const [id, oldest] = this.entries.entries().next().value;
        this.bytes -= oldest.bytes;
        this.entries.delete(id);
      }
      entry = { sessionId, projectId, epoch: randomUUID(), nextSequence: 1, bytes: 0, chunks: [] };
    }
    this.entries.delete(sessionId);
    this.entries.set(sessionId, entry);
    return entry;
  }

  drop(entry) {
    const chunk = entry.chunks.shift();
    if (!chunk) return;
    const bytes = Buffer.byteLength(chunk.text, 'utf8');
    entry.bytes -= bytes;
    this.bytes -= bytes;
  }

  append({ sessionId, projectId, text, stream = 'stdout', at = new Date().toISOString() }) {
    if (typeof text !== 'string' || !['stdout', 'stderr', 'error'].includes(stream) || typeof at !== 'string' || at.length > 64) fail('Quadro de terminal inválido');
    const entry = this.entry(sessionId, projectId);
    const frames = [];
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + this.chunkChars, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
      const frame = { sessionId, projectId, epoch: entry.epoch, sequence: entry.nextSequence++, stream, text: text.slice(offset, end), at };
      const bytes = Buffer.byteLength(frame.text, 'utf8');
      entry.chunks.push(frame); entry.bytes += bytes; this.bytes += bytes;
      while (entry.bytes > this.sessionBytes || entry.chunks.length > this.maxChunks) this.drop(entry);
      for (const oldest of this.entries.values()) {
        while (this.bytes > this.totalBytes && oldest.chunks.length) this.drop(oldest);
        if (this.bytes <= this.totalBytes) break;
      }
      frames.push({ ...frame });
      offset = end;
    }
    return frames;
  }

  read(sessionId, projectId, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) fail('Cursor de saída inválido');
    const entry = this.entry(sessionId, projectId);
    const firstSequence = entry.chunks[0]?.sequence ?? entry.nextSequence;
    const future = after >= entry.nextSequence;
    return {
      sessionId, projectId, epoch: entry.epoch, firstSequence, nextSequence: entry.nextSequence,
      truncated: future || after < firstSequence - 1,
      chunks: entry.chunks.filter(chunk => future || chunk.sequence > after).map(chunk => ({ ...chunk })),
    };
  }
}
