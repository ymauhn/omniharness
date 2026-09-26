"""Hidden acceptance tests for the paginate-bug challenge. The verifier copies the submission beside this file as mod.py."""
import unittest

from mod import paginate

TEN = list(range(10))


class Paginate(unittest.TestCase):
    def test_first_page_has_exactly_size_items(self):
        self.assertEqual(paginate(TEN, 1, 3), [0, 1, 2])

    def test_middle_page(self):
        self.assertEqual(paginate(TEN, 2, 3), [3, 4, 5])

    def test_last_page_is_short(self):
        self.assertEqual(paginate(TEN, 4, 3), [9])

    def test_page_past_the_end_is_empty(self):
        self.assertEqual(paginate(TEN, 5, 3), [])
        self.assertEqual(paginate([], 1, 5), [])

    def test_size_larger_than_the_list(self):
        self.assertEqual(paginate([7, 8], 1, 5), [7, 8])

    def test_pages_cover_every_item_once(self):
        self.assertEqual([x for p in range(1, 5) for x in paginate(TEN, p, 3)], TEN)

    def test_invalid_page_or_size_raises(self):
        for page, size in ((0, 3), (-1, 3), (1, 0), (2, -4)):
            with self.subTest(page=page, size=size), self.assertRaises(ValueError):
                paginate(TEN, page, size)


if __name__ == "__main__":
    unittest.main()
