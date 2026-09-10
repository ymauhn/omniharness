import unittest

from mod import paginate, parse_header, read_config


class PaginateTests(unittest.TestCase):
    @unittest.expectedFailure  # planted bug L1: returns size+1 items
    def test_page_has_exactly_size_items(self):
        self.assertEqual(paginate(list(range(10)), 1, 3), [0, 1, 2])

    def test_last_page_is_short(self):
        self.assertEqual(paginate(list(range(10)), 4, 3), [9])

    def test_page_past_end_is_empty(self):
        self.assertEqual(paginate(list(range(10)), 9, 3), [])


class ParseHeaderTests(unittest.TestCase):
    def test_parses_pairs(self):
        self.assertEqual(parse_header("Host: a\nX-Id: 7\nnoise"), {"host": "a", "x-id": "7"})

    @unittest.expectedFailure  # planted bug L2: None.splitlines()
    def test_none_yields_empty(self):
        self.assertEqual(parse_header(None), {})


class ReadConfigTests(unittest.TestCase):
    def test_missing_file_yields_empty(self):
        self.assertEqual(read_config("does/not/exist.cfg"), {})


if __name__ == "__main__":
    unittest.main()
