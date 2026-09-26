// Shared durable/atomic file-write primitives for the Lab. Every JSON or state write in the app
// goes through one of these two functions so the fsync-before-visible contract lives in one place.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Write `data` to `file` (create or truncate), fsync it, then close. Not atomic on its own: a reader
 * can see a partial file while this runs. Use `writeFileAtomic` when that must never happen. */
export function writeFileDurable(file, data, { mode = 0o666 } = {}) {
  const fd = fs.openSync(file, 'w', mode);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

/** Atomically replace `file`: write `data` to a fresh temp file in the same directory, fsync it, then
 * rename it over `file`. A reader always sees either the old content or the fully-written new content.
 * The temp file is removed if anything fails before the rename. */
export function writeFileAtomic(file, data, { mode = 0o666 } = {}) {
  const temp = path.join(path.dirname(file), `${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    writeFileDurable(temp, data, { mode });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
