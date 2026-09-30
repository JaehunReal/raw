from __future__ import annotations

import difflib
import subprocess

from rulecraft.delta import PatchError, analyze, analyze_git, apply_unified_diff
from rulecraft.graph import GraphStore

from tests.support import VaultTestCase, article


def patch(before: str, after: str, path: str = "rules/article.md") -> str:
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True), fromfile=f"a/{path}", tofile=f"b/{path}"))


class DeltaWorkflowTests(VaultTestCase):
    def seed_chain(self) -> str:
        original = article("LAW", 15, agency="국가", rule="상위법")
        self.write("laws/article.md", original)
        self.write("rules/article.md", article("RULE", 7, delegated_by=["[[/laws#제15조]]"]))
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="서식", cites=["[[RULE]]"]))
        return original

    def git(self, *arguments: str) -> str:
        result = subprocess.run(["git", "-C", str(self.vault), *arguments], check=True, capture_output=True, text=True)
        return result.stdout

    def commit_vault(self) -> None:
        self.git("init", "-q")
        self.git("config", "user.name", "RuleCraft Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("add", ".")
        self.git("commit", "-qm", "Seed test vault")

    def test_unified_patch_reports_transitive_impacts_without_mutating_source(self) -> None:
        before = self.seed_chain()
        after = before + "\n① 학습 목적은 사전에 확인하여야 한다.\n"
        store = GraphStore(self.vault)

        result = analyze(store, "laws/article.md", patch(before, after, "laws/article.md"))

        self.assertTrue(result["changed"])
        self.assertEqual(result["after"]["markdown"], after)
        self.assertEqual({node["id"]: node["depth"] for node in result["impacted_nodes"]}, {"RULE": 1, "FORM": 2})
        self.assertEqual(result["issues"], [])
        self.assertEqual(self.vault.joinpath("laws/article.md").read_text(encoding="utf-8"), before)

    def test_used_form_is_impacted_even_without_its_own_backlink_to_rule(self) -> None:
        before = article("LAW", 15, agency="국가", rule="상위법")
        self.write("laws/article.md", before)
        self.write("rules/article.md", article("RULE", 7, delegated_by=["[[LAW]]"], uses_form=["[[FORM]]"]))
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="반출신청서"))
        store = GraphStore(self.vault)

        result = analyze(store, "laws/article.md", before + "\n① 학습 목적을 확인하여야 한다.\n")

        self.assertEqual({node["id"]: node["depth"] for node in result["impacted_nodes"]}, {"RULE": 1, "FORM": 2})
        self.assertEqual([node["id"] for node in store.backlinks("LAW")], ["RULE"])

    def test_renumber_proposes_exact_sub_article_anchor_correction(self) -> None:
        before = article("RULE", "7의2")
        self.write("rules/article.md", before)
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="서식", cites=["[[/rules#제7조의2]]"]))
        store = GraphStore(self.vault)

        result = analyze(store, "rules/article.md", article("RULE", "7의3"))

        self.assertEqual([(edit["before"], edit["after"]) for edit in result["suggested_link_edits"]], [("/rules#제7조의2", "/rules#제7조의3")])
        self.assertTrue(any(issue["code"] == "missing_target" and issue["node_id"] == "FORM" for issue in result["issues"]))
        self.assertEqual(store.get("RULE")["article_no"], "제7조의2")

    def test_sub_article_insertion_does_not_shift_existing_numbers_or_citations(self) -> None:
        self.write("rules/seven.md", article("SEVEN", 7))
        self.write("rules/eight.md", article("EIGHT", 8))
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="서식", cites=["[[/rules#제8조]]"]))
        store = GraphStore(self.vault)

        result = analyze(store, "rules/seven-two.md", article("SEVEN-TWO", "7의2"))

        self.assertEqual(result["change_type"], "added")
        self.assertEqual(result["suggested_link_edits"], [])
        self.assertEqual(result["issues"], [])
        self.assertEqual(store.get("EIGHT")["article_no"], "제8조")
        self.assertEqual([node["id"] for node in store.backlinks("EIGHT")], ["FORM"])

    def test_deletion_retains_old_graph_transitive_impact_and_broken_link_report(self) -> None:
        before = self.seed_chain()
        deletion = patch(before, "", "laws/article.md").replace("+++ b/laws/article.md", "+++ /dev/null")

        result = analyze(GraphStore(self.vault), "laws/article.md", deletion)

        self.assertEqual(result["change_type"], "deleted")
        self.assertIsNone(result["after"])
        self.assertEqual({node["id"] for node in result["impacted_nodes"]}, {"RULE", "FORM"})
        self.assertTrue(any(issue["code"] == "missing_target" for issue in result["issues"]))
        self.assertTrue(self.vault.joinpath("laws/article.md").exists())

    def test_malformed_hunks_context_and_extra_files_are_rejected(self) -> None:
        valid = "--- a/article.md\n+++ b/article.md\n@@ -1 +1 @@\n-old\n+new\n"
        cases = {
            "wrong context": valid.replace("-old", "-different"),
            "wrong count": valid.replace("@@ -1 +1 @@", "@@ -1,2 +1 @@"),
            "out of range": valid.replace("@@ -1 +1 @@", "@@ -5 +5 @@"),
            "new range mismatch": valid.replace("@@ -1 +1 @@", "@@ -1 +2 @@"),
            "second file": valid + "--- a/second.md\n+++ b/second.md\n@@ -1 +1 @@\n-old\n+new\n",
            "no hunks": "--- a/article.md\n+++ b/article.md\n",
        }
        for label, malformed in cases.items():
            with self.subTest(label=label), self.assertRaises(PatchError):
                apply_unified_diff("old\n", malformed)

    def test_diff_cannot_silently_name_a_different_target_file(self) -> None:
        original = article("RULE", 7)
        self.write("rules/article.md", original)
        wrong_target = patch(original, original + "\n① 목적을 확인한다.\n", "rules/unrelated.md")

        result = analyze(GraphStore(self.vault), "rules/article.md", wrong_target)

        self.assertFalse(result["changed"])
        self.assertEqual([issue["code"] for issue in result["issues"]], ["invalid_diff"])

    def test_actual_git_diff_with_quoted_korean_filename_is_supported(self) -> None:
        original = article("RULE", 7)
        self.write("rules/제7조.md", original)
        self.commit_vault()
        revised = original + "\n① 담당자는 목적을 확인하여야 한다.\n"
        self.vault.joinpath("rules/제7조.md").write_text(revised, encoding="utf-8")
        git_patch = self.git("diff", "--", "rules/제7조.md")
        self.vault.joinpath("rules/제7조.md").write_text(original, encoding="utf-8")

        result = analyze(GraphStore(self.vault), "rules/제7조.md", git_patch)

        self.assertTrue(result["changed"])
        self.assertEqual(result["after"]["markdown"], revised)
        self.assertEqual(result["issues"], [])

    def test_no_final_newline_marker_preserves_actual_text(self) -> None:
        change = "--- a/article.md\n+++ b/article.md\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n"
        self.assertEqual(apply_unified_diff("old", change), ("new", False))

    def test_preview_path_traversal_reports_error_without_creating_file(self) -> None:
        self.seed_chain()

        result = analyze(GraphStore(self.vault), "../../outside.md", article("OUTSIDE", 1))

        self.assertFalse(result["changed"])
        self.assertEqual([issue["code"] for issue in result["issues"]], ["unsafe_path"])

    def test_git_worktree_deletion_uses_committed_backlinks(self) -> None:
        self.seed_chain()
        self.commit_vault()
        self.vault.joinpath("laws/article.md").unlink()

        result = analyze_git(GraphStore(self.vault))

        self.assertEqual(len(result["changes"]), 1)
        self.assertEqual(result["changes"][0]["change_type"], "deleted")
        self.assertEqual({node["id"] for node in result["impacted_nodes"]}, {"RULE", "FORM"})
        self.assertTrue(any(issue["code"] == "missing_target" for issue in result["issues"]))

    def test_git_rename_proposes_relative_citation_path_correction(self) -> None:
        self.write("rules/old.md", article("RULE", 7))
        self.write("rules/source.md", article("SOURCE", 8, cites=["[[./old.md#제7조]]"]))
        self.commit_vault()
        self.vault.joinpath("rules/old.md").rename(self.vault.joinpath("rules/new.md"))

        result = analyze_git(GraphStore(self.vault))

        self.assertEqual(result["changes"][0]["change_type"], "renamed")
        self.assertEqual([(edit["before"], edit["after"]) for edit in result["changes"][0]["suggested_link_edits"]], [("./old.md#제7조", "./new.md#제7조")])
        self.assertTrue(any(issue["code"] == "missing_target" for issue in result["issues"]))

    def test_git_committed_edited_rename_compares_requested_snapshots(self) -> None:
        original = article("RULE", 7)
        self.write("rules/old.md", original)
        self.write("rules/source.md", article("SOURCE", 8, cites=["[[./old.md#제7조]]"]))
        self.commit_vault()
        baseline = self.git("rev-parse", "HEAD").strip()
        self.vault.joinpath("rules/old.md").rename(self.vault.joinpath("rules/new.md"))
        revised = original + "\n① 담당자는 처리 목적을 확인하여야 한다.\n"
        self.vault.joinpath("rules/new.md").write_text(revised, encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-qm", "Rename and revise article")

        result = analyze_git(GraphStore(self.vault), baseline, "HEAD")

        self.assertEqual(len(result["changes"]), 1)
        changed = result["changes"][0]
        self.assertEqual(changed["change_type"], "renamed")
        self.assertEqual(changed["before"]["path"], "rules/old.md")
        self.assertEqual(changed["after"]["path"], "rules/new.md")
        self.assertEqual(changed["after"]["markdown"], revised)
        self.assertEqual({node["id"] for node in result["impacted_nodes"]}, {"SOURCE"})
