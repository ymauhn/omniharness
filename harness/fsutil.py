"""Shared durable/atomic file-write primitives for the harness's Python evidence and state writers.

Two shapes cover every existing site: a replace that must never leave a half-written file at the
final path (`write_atomic`), and a create that must never silently overwrite an existing one
(`write_exclusive`). Both write through `flush_durable`, so a caller that already holds an open
stream (an append-only event log) can use that piece directly.
"""
import os
import time
import uuid
from pathlib import Path


def flush_durable(stream, data):
    """Write `data` (str or bytes, matching the stream's mode) to an already-open `stream`, then
    flush and fsync it so the bytes are durable before this returns."""
    stream.write(data)
    stream.flush()
    os.fsync(stream.fileno())


def _open_new(path, data, mode, newline):
    """Create `path` (fails if it exists) and return its stream, in binary or text mode to match
    `data`. `mode` is the file's permission bits; None leaves the OS default (0o666 & ~umask,
    matching every plain `open(path, "x")` site this replaces). `newline` matches the builtin
    `open()` argument of the same name and is ignored for binary `data`."""
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    fd = os.open(path, flags, 0o666 if mode is None else mode)
    return os.fdopen(fd, "wb") if isinstance(data, bytes) else os.fdopen(fd, "w", encoding="utf-8", newline=newline)


def write_exclusive(path, data, *, mode=None):
    """Create `path` once and fsync `data` into it before returning. No temp file or rename: an
    existing file must never be silently replaced, so this simply refuses (FileExistsError) instead."""
    with _open_new(Path(path), data, mode, None) as stream:
        flush_durable(stream, data)


def write_atomic(path, data, *, mode=None, newline=None, max_replace_attempts=1, retry_delay=0.05):
    """Write `data` (str or bytes) to `path` durably and atomically: a fresh, exclusively-created
    temp file next to `path`, flushed and fsynced, then os.replace over the target. A reader always
    sees either the previous content or the fully-written new content; the temp file is removed on
    any failure. `mode` restricts the temp (and so the final) file's permission bits; omitted, the
    OS default applies. `newline` is passed through to the text-mode open() (skill_catalog.py's
    snapshot must stay LF-only regardless of platform). `max_replace_attempts` > 1 retries
    os.replace on PermissionError, which Windows raises while another process still holds the
    target open."""
    path = Path(path)
    temp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with _open_new(temp, data, mode, newline) as stream:
            flush_durable(stream, data)
        for attempt in range(max_replace_attempts):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt == max_replace_attempts - 1:
                    raise
                time.sleep(retry_delay)
    except BaseException:
        try:
            os.remove(temp)
        except OSError:
            pass
        raise
