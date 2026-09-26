"""Starter for the paginate-bug challenge, taken from evals/cases/gauntlet-rapido/buggy/mod.py.

Fix paginate so it honours its docstring. Keep the name and signature; the verifier imports it as `mod.paginate`.
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
