from __future__ import annotations

import io
import json
import os
from unittest.mock import patch
import zipfile

from rulecraft import adapters
from rulecraft.graph import GraphStore
from rulecraft.workflow import PackageWorkflow

from tests.support import VaultTestCase, article


class PackageWorkflowTests(VaultTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.original = article("RULE", 7, uses_form=["[[FORM]]"], body="# 제7조 (반출)\n① 신청서를 제출하여야 한다.")
        self.write("rules/article.md", self.original)
        self.write("forms/form.md", article("FORM", 1, kind="form", rule="반출신청서", body="# 반출신청서\n| 신청인 | 반출 목적 |\n| --- | --- |\n| | |"))
        self.workflow = PackageWorkflow(GraphStore(self.vault), self.vault / "packages")
        self.request = {
            "agency": "테스트기관", "rule_name": "공공데이터지침", "article_id": "RULE",
            "objective": "AI 학습 목적의 신청 절차 정비", "amendment_type": "partial",
            "effective_date": "2026-11-01", "amendment_reason": "신청 목적과 책임 확인",
            "revised_markdown": self.original + "\n② 반출 목적과 책임자를 확인하여야 한다.\n",
        }

    def test_valid_package_persists_complete_review_zip_and_leaves_vault_unchanged(self) -> None:
        result = self.workflow.run(self.request)
        self.assertEqual(result["status"], "draft")
        self.assertTrue(result["verification"]["valid"])
        self.assertTrue(result["verification"]["requires_human_review"])
        self.assertFalse(result["verification"]["legal_authority_verified"])
        self.assertEqual(len(result["documents"]), 7)
        self.assertEqual(self.workflow.get(result["id"]), result)
        self.assertEqual(self.workflow.archive(result["id"]), self.workflow.archive(result["id"]))
        with zipfile.ZipFile(io.BytesIO(self.workflow.archive(result["id"]))) as archive:
            self.assertEqual(set(archive.namelist()), {document["name"] for document in result["documents"]} | {"manifest.json"})
            for document in result["documents"]:
                self.assertEqual(archive.read(document["name"]).decode("utf-8"), document["content"])
            self.assertIn("| 현행 | 개정안 | 개정이유 |", archive.read("02_신구조문대비표.md").decode("utf-8"))
            self.assertIn("반출신청서", archive.read("06_별지서식정비안.md").decode("utf-8"))
            self.assertEqual(json.loads(archive.read("manifest.json"))["verification"]["legal_authority_verified"], False)
        self.assertEqual(self.vault.joinpath("rules/article.md").read_text(encoding="utf-8"), self.original)

    def test_unknown_wikilink_blocks_documents_and_download(self) -> None:
        request = {**self.request, "revised_markdown": self.original + "\n[[/不存在#제99조]]에 따른다.\n"}

        result = self.workflow.run(request)

        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["verification"]["valid"])
        self.assertEqual(result["documents"], [])
        self.assertTrue(any(issue["code"] == "missing_target" for issue in result["verification"]["issues"]))
        with self.assertRaises(ValueError):
            self.workflow.archive(result["id"])

    def test_malformed_frontmatter_is_reported_and_blocks_package_without_crash(self) -> None:
        malformed = "---\nid: RULE\nagency: [unterminated\n---\n\n# 제7조\n개정 문안\n"

        result = self.workflow.run({**self.request, "revised_markdown": malformed})

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["documents"], [])
        self.assertTrue(any(issue["code"] == "invalid_yaml" for issue in result["verification"]["issues"]))
        self.assertEqual(self.vault.joinpath("rules/article.md").read_text(encoding="utf-8"), self.original)

    def test_false_citation_cannot_enter_package_through_reason_or_objective(self) -> None:
        for field, value in (("objective", "[[/missing#제99조]]에 따른 개정"), ("amendment_reason", "「존재하지않는법」 제99조에 따른 개정")):
            with self.subTest(field=field):
                result = self.workflow.run({**self.request, field: value})
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["documents"], [])
                self.assertFalse(result["verification"]["valid"])

    def test_template_and_unavailable_model_are_distinguished(self) -> None:
        without_draft = {key: value for key, value in self.request.items() if key != "revised_markdown"}
        with patch.dict(os.environ, {}, clear=True):
            template = self.workflow.run(without_draft)
        self.assertEqual(template["status"], "draft")
        self.assertEqual(template["provenance"], "template")
        self.assertTrue(any(agent["name"] == "vision" and agent["status"] == "skipped" for agent in template["agents"]))
        with patch.dict(os.environ, {"RULECRAFT_LLM_BASE_URL": "http://localhost:1234/v1", "RULECRAFT_LLM_MODEL": "test-model"}), patch.object(adapters, "draft_article", side_effect=adapters.AdapterUnavailable("연결 실패")):
            unavailable = self.workflow.run(without_draft)
        self.assertEqual(unavailable["status"], "blocked")
        self.assertEqual(unavailable["documents"], [])
        self.assertTrue(any(issue["code"] == "drafting_unavailable" for issue in unavailable["verification"]["issues"]))

    def test_model_generated_broken_citation_is_gated_before_document_export(self) -> None:
        without_draft = {key: value for key, value in self.request.items() if key != "revised_markdown"}
        invented = self.original + "\n「허위법」 제42조에 따라 [[missing]]를 확인한다.\n"
        with patch.dict(os.environ, {"RULECRAFT_LLM_BASE_URL": "http://localhost:1234/v1", "RULECRAFT_LLM_MODEL": "test-model"}), patch.object(adapters, "draft_article", return_value=invented):
            result = self.workflow.run(without_draft)

        self.assertEqual(result["provenance"], "openai_compatible")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["documents"], [])
        self.assertEqual({issue["code"] for issue in result["verification"]["issues"]}, {"missing_target", "unverified_text_citation"})

    def test_package_read_path_rejects_traversal(self) -> None:
        with self.assertRaises(ValueError):
            self.workflow.get("../../secret")
        with self.assertRaises(ValueError):
            self.workflow.archive("../../secret")
