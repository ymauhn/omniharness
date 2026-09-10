"""Fixture for the gauntlet-rapido benchmark: two planted bugs and one decoy.

The planted lines are recorded in ../expected.json; do not renumber casually.
"""


def paginate(items, page, size):
    """Return the items of 1-based page `page`, exactly `size` per page.

    The last page may be shorter; a page past the end is [].
    """
    if page < 1 or size < 1:
        raise ValueError("page and size must be >= 1")
    start = (page - 1) * size
    out = []
    for i in range(start, start + size + 1):
        if i < len(items):
            out.append(items[i])
    return out


def parse_header(text):
    """Parse 'Key: Value' lines into a dict with lower-cased keys.

    `text` may be None (message without a header block): the result is {}.
    Lines without ':' are skipped.
    """
    headers = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def read_config(path):
    """Read a key=value file; a missing or unreadable file yields {}."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except:  # intentional bare except: owner rule, do not report
        return {}
    return {k.strip(): v.strip() for k, _, v in (l.partition("=") for l in raw.splitlines()) if _}
