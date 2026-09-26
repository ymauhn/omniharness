"""Zero-token check: every relative Markdown link under docs/ and the root docs resolves to a real file.

Scope excludes site/public/** (the built Pages edition, never hand-edited) and site/showcase source
that intentionally links into that built tree. External (http/https/mailto) links and pure in-page
anchors are not fetched or validated here; only the file-path part of a link is checked to exist.
"""
import re
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ROOT_DOCS = ["README.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "PRODUCT.md"]
LINK = re.compile(r"\[[^\]\n]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
EXCLUDED_DIRS = {"node_modules", ".git", "site/public", "site/showcase"}


def markdown_files():
    files = [ROOT / name for name in ROOT_DOCS if (ROOT / name).is_file()]
    for path in (ROOT / "docs").rglob("*.md"):
        rel = path.relative_to(ROOT).as_posix()
        if any(rel.startswith(f"{excluded}/") for excluded in EXCLUDED_DIRS):
            continue
        files.append(path)
    return files


def local_targets(text):
    for match in LINK.finditer(text):
        target = match.group(1)
        if urlsplit(target).scheme or target.startswith(("mailto:", "#", "//")):
            continue
        yield target


class MarkdownLinks(unittest.TestCase):
    def test_relative_links_resolve(self):
        broken = []
        for path in markdown_files():
            text = path.read_text(encoding="utf-8")
            for target in local_targets(text):
                file_part = unquote(target.split("#", 1)[0])
                if not file_part:  # "file.md#anchor" with an empty file part means "this file"
                    continue
                resolved = (path.parent / file_part).resolve()
                if not resolved.exists():
                    broken.append(f"{path.relative_to(ROOT).as_posix()} -> {target}")
        self.assertFalse(broken, "broken relative Markdown link(s):\n" + "\n".join(broken))


if __name__ == "__main__":
    unittest.main()
