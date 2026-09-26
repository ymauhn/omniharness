"""Plausible wrong fix: the slice removes the off-by-one but drops the validation.

paginate(items, 0, 3) now returns items[-3:0] == [] instead of raising, so a caller's bad page number goes unnoticed.
"""


def paginate(items, page, size):
    """Return the items of 1-based page `page`, exactly `size` per page.

    The last page may be shorter; a page past the end is [].
    """
    return list(items[(page - 1) * size:page * size])
