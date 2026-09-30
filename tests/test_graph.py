from __future__ import annotations

import tempfile
from pathlib import Path

from rulecraft.graph import GraphStore

from tests.support import VaultTestCase, article


class GraphWorkflowTests(VaultTestCase):
    def test_relative_form_and_directory_article_links_resolve_to_distinct_nodes(self) -> None:
        self.write("statutes/개인정보보호법/제15조.md", article("LAW-15", 15, agency="국가", rule="개인정보보호법"))
        self.write("agencies/지침/제7조.md", article(
            "RULE-7", 7,
            delegated_by=["[[/statutes/개인정보보호법#제15조]]"],
            uses_form=["[[./별표/신청서.md]]"],
            body="# 제7조 (반출)\n[[./별표/신청서.md|신청서]]를 제출한다.",
        ))
        self.write("agencies/지침/별표/신청서.md", article("FORM", 1, kind="form", rule="신청서"))
        store = GraphStore(self.vault)

        self.assertEqual(store.graph()["issues"], [])
        edges = {(edge["source"], edge["target"], edge["type"]) for edge in store.graph()["edges"]}
        self.assertIn(("RULE-7", "LAW-15", "delegated_by"), edges)
        self.assertIn(("RULE-7", "FORM", "uses_form"), edges)
        self.assertIn(("RULE-7", "FORM", "REFERENCES"), edges)
        upward = store.query("테스트기관", "공공데이터지침", "7", "UPWARD_PARENT")
        self.assertEqual({node["id"] for node in upward["nodes"]}, {"RULE-7", "LAW-15"})

    def test_sub_article_anchor_never_resolves_to_parent_article(self) -> None:
        self.write("rules/제7조.md", article("RULE-7", 7))
        self.write("rules/제7조의2.md", article("RULE-7-2", "7의2"))
        self.write("forms/신청서.md", article("FORM", 1, kind="form", rule="신청서", cites=["[[/rules#제7조의2]]"]))
        store = GraphStore(self.vault)

        self.assertEqual(store.graph()["issues"], [])
        self.assertEqual([node["id"] for node in store.resolve("/rules#제7조의2")], ["RULE-7-2"])
        self.assertEqual([node["id"] for node in store.backlinks("RULE-7")], [])
        self.assertEqual([node["id"] for node in store.backlinks("RULE-7-2")], ["FORM"])

    def test_transitive_backlinks_include_indirect_forms_and_terminate_on_cycle(self) -> None:
        self.write("rules/a.md", article("A", 1, cites=["[[C]]"]))
        self.write("rules/b.md", article("B", 2, delegated_by=["[[A]]"]))
        self.write("rules/c.md", article("C", 3, cites=["[[B]]"]))
        self.write("forms/request.md", article("FORM", 1, kind="form", rule="반출서식", cites=["[[C]]"]))
        store = GraphStore(self.vault)

        found = {node["id"]: node["depth"] for node in store.backlinks("A")}
        self.assertEqual(found, {"B": 1, "C": 2, "FORM": 3})
        self.assertEqual([node["id"] for node in store.backlinks("A", transitive=False)], ["B"])

    def test_ambiguous_and_missing_citations_are_blocked_without_guessing(self) -> None:
        self.write("agency-a/규정/제7조.md", article("A-7", 7, agency="기관A", rule="보안지침"))
        self.write("agency-b/규정/제7조.md", article("B-7", 7, agency="기관B", rule="보안지침"))
        self.write("forms/신청서.md", article("FORM", 1, kind="form", rule="신청서"))
        store = GraphStore(self.vault)
        candidate = article("FORM", 1, kind="form", rule="신청서", cites=["[[보안지침#제7조]]", "[[/missing#제99조]]"])

        result = store.validate(candidate, "forms/신청서.md")
        self.assertFalse(result["valid"])
        self.assertEqual({issue["code"] for issue in result["issues"]}, {"ambiguous_target", "missing_target"})
        ambiguous = next(issue for issue in result["issues"] if issue["code"] == "ambiguous_target")
        self.assertEqual(set(ambiguous["candidates"]), {"agency-a/규정/제7조.md", "agency-b/규정/제7조.md"})
        self.assertEqual(store.get("FORM")["markdown"], self.vault.joinpath("forms/신청서.md").read_text(encoding="utf-8"))

    def test_changed_anchor_detects_newly_broken_citations_outside_draft(self) -> None:
        self.write("rules/article.md", article("RULE", 7))
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="서식", cites=["[[/rules#제7조]]"]))
        store = GraphStore(self.vault)

        result = store.validate(article("RULE", 8), "rules/article.md")
        self.assertFalse(result["valid"])
        self.assertTrue(any(issue["code"] == "missing_target" and issue["node_id"] == "FORM" for issue in result["issues"]))
        self.assertEqual(store.get("RULE")["article_no"], "제7조")

    def test_duplicate_identity_cannot_be_saved_and_original_file_survives(self) -> None:
        original = article("ONE", 1)
        self.write("rules/one.md", original)
        self.write("rules/two.md", article("TWO", 2))
        store = GraphStore(self.vault)

        with self.assertRaises(ValueError):
            store.save("ONE", article("TWO", 1))
        self.assertEqual(self.vault.joinpath("rules/one.md").read_text(encoding="utf-8"), original)

    def test_traversal_and_symlink_cannot_read_or_write_outside_vault(self) -> None:
        self.write("rules/one.md", article("ONE", 1))
        with tempfile.TemporaryDirectory(prefix="rulecraft-outside-") as outside:
            outside_file = Path(outside) / "secret.md"
            outside_file.write_text(article("OUTSIDE", 3), encoding="utf-8")
            self.vault.joinpath("escape.md").symlink_to(outside_file)
            store = GraphStore(self.vault)

            self.assertIsNone(store.get("OUTSIDE"))
            self.assertTrue(any(issue["code"] == "outside_vault_symlink" for issue in store.graph()["issues"]))
            for path in ("../outside.md", str(outside_file), "escape.md", "rules/output.txt"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    store.validate(article("OTHER", 4), path)
            self.assertEqual(outside_file.read_text(encoding="utf-8"), article("OUTSIDE", 3))

    def test_duplicate_yaml_keys_and_aliases_cannot_hide_document_identity(self) -> None:
        original = article("RULE", 7)
        self.write("rules/article.md", original)
        store = GraphStore(self.vault)
        malformed = {
            "duplicate identity": original.replace("id: RULE\n", "id: RULE\nid: OTHER\n"),
            "metadata alias": original.replace("title: 검증용 조문\n", "title: &shared 검증용 조문\nextra: *shared\n"),
        }
        for case, value in malformed.items():
            with self.subTest(case=case):
                result = store.validate(value, "rules/article.md")
                self.assertFalse(result["valid"])
                self.assertTrue(any(issue["code"] == "invalid_yaml" for issue in result["issues"]))
                with self.assertRaises(ValueError):
                    store.save("RULE", value)
        self.assertEqual(self.vault.joinpath("rules/article.md").read_text(encoding="utf-8"), original)

    def test_embedded_article_link_is_validated_but_escaped_example_is_ignored(self) -> None:
        self.write("rules/sub.md", article("SUB", "7의2"))
        self.write("rules/source.md", article("SOURCE", 8, body="# 제8조\n![[SUB#제7조의2]]\n문법 예시: \\[[없는문서]]"))

        store = GraphStore(self.vault)

        self.assertEqual(store.graph()["issues"], [])
        self.assertEqual([node["id"] for node in store.backlinks("SUB")], ["SOURCE"])

    def test_displayed_article_number_must_match_frontmatter_identity(self) -> None:
        original = article("RULE", 7)
        self.write("rules/article.md", original)
        store = GraphStore(self.vault)

        result = store.validate(article("RULE", 7, body="# 제8조 (반출)\n① 목적을 확인한다."), "rules/article.md")

        self.assertFalse(result["valid"])
        self.assertTrue(any(issue["code"] == "heading_article_mismatch" for issue in result["issues"]))
        self.assertEqual(store.get("RULE")["article_no"], "제7조")
