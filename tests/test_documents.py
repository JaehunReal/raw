from __future__ import annotations

import unittest

from rulecraft.documents import generate_statutory_diff

from tests.support import article


class StatutoryComparisonTests(unittest.TestCase):
    def test_comparison_preserves_change_reason_and_escapes_user_table_content(self) -> None:
        before = article("RULE", 7, body="# 제7조 (반출)\n기존 신청서를 사용하여야 한다.")
        after = article("RULE", 7, body="# 제7조 (반출)\nAI | 학습 목적과 <script>alert(1)</script>를 확인하여야 한다.")

        result = generate_statutory_diff(before, after, "AI 활용 | 안전성 확보")

        self.assertIn("| 현행 | 개정안 | 개정이유 |", result)
        self.assertIn("기존 신청서를 사용하여야 한다.", result)
        self.assertIn("AI &#124; 학습 목적과 &lt;script&gt;", result)
        self.assertIn("AI 활용 &#124; 안전성 확보", result)
        self.assertNotIn("<script>", result)
        self.assertNotIn("article_no:", result)
        self.assertNotIn("rule_name:", result)
