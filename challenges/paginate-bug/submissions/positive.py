"""Reference solution: fixes the off-by-one and keeps the input validation."""


def paginate(items, page, size):
    """Return the items of 1-based page `page`, exactly `size` per page.

    The last page may be shorter; a page past the end is [].
    """
    if page < 1 or size < 1:
        raise ValueError("page and size must be >= 1")
    start = (page - 1) * size
    return list(items[start:start + size])
