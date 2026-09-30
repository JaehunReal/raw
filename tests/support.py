from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml


def article(
    node_id: str,
    number: int | str,
    *,
    agency: str = "테스트기관",
    rule: str = "공공데이터지침",
    body: str | None = None,
    **metadata: object,
) -> str:
    """Build a small realistic article; tests supply references explicitly."""
    fields = {
        "id": node_id,
        "agency": agency,
        "rule_name": rule,
        "article_no": number,
        "title": "검증용 조문",
        "status": "active",
        **metadata,
    }
    frontmatter = yaml.safe_dump(fields, allow_unicode=True, sort_keys=False)
    parts = str(number).split("의", 1)
    label = f"제{parts[0]}조" + (f"의{parts[1]}" if len(parts) == 2 else "")
    return f"---\n{frontmatter}---\n\n{body or f'# {label} (검증용 조문)'}\n"


class VaultTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="rulecraft-test-")
        self.addCleanup(self.temp.cleanup)
        self.vault = Path(self.temp.name)

    def write(self, path: str, text: str) -> Path:
        file = self.vault / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8")
        return file
