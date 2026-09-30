"""Synthetic source fixtures verify grounding plumbing, never actual legal authority."""
from __future__ import annotations

from copy import deepcopy
import os
from unittest.mock import patch

from rulecraft import adapters
from rulecraft.graph import GraphStore
from rulecraft.legal_grounding import add_text_impact, check_citations, collect_grounding, compact_name, extract_citations
from rulecraft.workflow import PackageWorkflow

from tests.support import VaultTestCase, article


class FixtureLawStore:
    """In-memory synthetic official-source-shaped data; no API or real-law claims."""
    def __init__(self, *, available=True, structured=True, complete=False):
        self.available = available
        self.complete = complete
        self.calls = []
        self.law = {
            "law_id": "law:synthetic-test", "source": "law", "source_id": "synthetic-test",
            "version_id": "synthetic-2026", "title": "가상 데이터법",
            "publication_date": "2026-01-01", "effective_date": "2026-03-01",
            "source_url": "https://www.law.go.kr/synthetic-test-only", "sha256": "a" * 64,
            "fetched_at": "2026-09-30T00:00:00Z", "temporal_verified": True,
            "metadata": {"synthetic_test_fixture": True},
            "provisions": [{"article_no": "제15조", "title": "가상 처리 기준",
                            "text": "[합성 테스트 원문] AI 데이터 처리는 목적과 책임자를 사전에 확인하여야 한다.",
                            "paragraphs": [{"paragraph_no": "①", "text": "가상 1항", "items": [{"item_no": "1.", "text": "가상 1호"}]},
                                           {"paragraph_no": "②", "text": "가상 2항", "items": [{"item_no": "3.", "text": "가상 3호"}]}]}],
        }
        if not structured:
            self.law["provisions"][0]["paragraphs"] = []
            self.law["provisions"][0]["parse_warnings"] = ["unstructured_paragraphs"]

    def coverage(self):
        return {"complete": self.complete, "scope": "synthetic_test_only", "sources": {}, "limitations": ["테스트 합성 자료"]}

    def get(self, law_id, as_of=None):
        self.calls.append(("get", law_id, as_of))
        return deepcopy(self.law) if self.available and law_id == self.law["law_id"] and str(as_of) >= "2026-03-01" else None

    def search(self, query="", as_of=None, source=None, limit=20, offset=0):
        self.calls.append(("search", query, as_of))
        available = self.available and str(as_of) >= "2026-03-01"
        return {"items": [deepcopy(self.law)] if available else [], "total": int(available), "coverage": self.coverage()}

    def resolve_citation(self, law_name, article_no, as_of=None):
        self.calls.append(("resolve", law_name, article_no, as_of))
        matches = self.available and str(as_of) >= "2026-03-01" and compact_name(law_name) == compact_name(self.law["title"])
        law = deepcopy(self.law) if matches else None
        provision = next((item for item in (law or {}).get("provisions", []) if item["article_no"] == article_no), None)
        return {"law": law, "article": provision, "found": bool(provision), "ambiguous": False, "coverage": self.coverage()}


class GroundingTests(VaultTestCase):
    def setUp(self):
        super().setUp()
        self.markdown = article("RULE", 7, body="# 제7조 (반출)\n「가상 데이터법」 제15조에 따른 사전 확인을 수행하여야 한다.", demo=True)
        self.write("rules/seven.md", self.markdown)
        self.store = GraphStore(self.vault)
        self.node = self.store.get("RULE")
        self.source = FixtureLawStore()
        self.request = {"agency": "테스트기관", "rule_name": "공공데이터지침", "article_id": "RULE",
                        "objective": "AI 데이터 처리 기준 정비", "amendment_type": "partial",
                        "effective_date": "2026-11-01", "amendment_reason": "합성 원문 연결 검사",
                        "revised_markdown": self.markdown}

    def test_official_article_not_in_local_vault_is_valid_and_documents_show_dated_evidence(self):
        before = self.store.graph()
        result = PackageWorkflow(self.store, self.vault / "packages", self.source).run(self.request)
        self.assertTrue(result["verification"]["valid"])
        self.assertEqual(result["status"], "draft")
        grounding = result["verification"]["legal_coverage"]
        self.assertEqual(grounding["status"], "coverage_incomplete")
        self.assertEqual(grounding["as_of"], "2026-11-01")
        self.assertIn("[합성 테스트 원문]", grounding["sources"][0]["passage"])
        report = result["documents"][-1]["content"]
        self.assertIn("law:synthetic-test", report)
        self.assertIn(self.source.law["source_url"], report)
        self.assertIn("전체 적용법", report)
        self.assertEqual(len(result["documents"]), 7)
        self.assertFalse(result["verification"]["legal_authority_verified"])
        self.assertEqual(self.store.graph(), before)
        self.assertTrue(self.store.get("RULE")["metadata"]["demo"])

    def test_structured_official_paragraphs_and_items_are_checked_and_number_formats_normalized(self):
        valid = check_citations(self.store, self.source, "「가상 데이터법」 제15조 제2항 제3호", "rule.md", "2026-11-01")
        self.assertEqual(valid, [])
        invalid = check_citations(self.store, self.source, "「가상 데이터법」 제15조 제999항", "rule.md", "2026-11-01")
        self.assertEqual([issue["code"] for issue in invalid], ["official_paragraph_missing"])
        invalid_item = check_citations(self.store, self.source, "「가상 데이터법」 제15조 제2항 제999호", "rule.md", "2026-11-01")
        self.assertEqual([issue["code"] for issue in invalid_item], ["official_item_missing"])

    def test_unparsed_official_units_report_unknown_instead_of_false_absence(self):
        source = FixtureLawStore(structured=False)
        issues = check_citations(self.store, source, "「가상 데이터법」 제15조 제999항 제999호", "rule.md", "2026-11-01")
        self.assertEqual([issue["code"] for issue in issues], ["citation_unit_unverified"])
        self.assertEqual(issues[0]["severity"], "warning")

    def test_unavailable_official_corpus_leaves_local_demo_draft_downloadable_with_missing_coverage(self):
        source = FixtureLawStore(available=False)
        local = article("RULE", 7, body="# 제7조 (반출)\n검토 절차를 정한다.", demo=True)
        self.write("rules/seven.md", local)
        self.store.refresh()
        workflow = PackageWorkflow(self.store, self.vault / "packages", source)
        result = workflow.run({**self.request, "revised_markdown": local})
        self.assertEqual(result["status"], "draft")
        self.assertTrue(result["verification"]["valid"])
        self.assertEqual(result["verification"]["legal_coverage"]["status"], "source_unavailable")
        self.assertFalse(result["verification"]["legal_authority_verified"])
        self.assertTrue(workflow.archive(result["id"]))

    def test_bare_official_title_with_lawryul_and_leading_prose_are_resolved(self):
        text = "근거는 가상 데이터법 제15조 제2항 제3호에 따른다."
        self.assertEqual(check_citations(self.store, self.source, text, "rule.md", "2026-11-01"), [])
        unknown = "공공데이터의 제공 및 이용 활성화에 관한 법률 제999조에 따른다."
        citations = extract_citations(unknown)
        self.assertEqual(citations[0]["law_name"], "공공데이터의 제공 및 이용 활성화에 관한 법률")
        self.assertEqual(citations[0]["article_no"], "제999조")
        self.assertEqual(check_citations(self.store, self.source, unknown, "rule.md", "2026-11-01")[0]["code"], "unverified_text_citation")

    def test_plain_text_citations_are_included_in_transitive_impact_without_rewriting_vault(self):
        self.write("laws/fifteen.md", article("LAW", 15, rule="가상 데이터법", agency="국가법령"))
        self.write("rules/eight.md", article("OTHER", 8, body="# 제8조\n「공공데이터지침」 제7조에 따른다."))
        self.store.refresh()
        result = add_text_impact(self.store, self.store.get("LAW"), {"impacted_nodes": [], "changed": True})
        self.assertEqual({node["id"]: node["depth"] for node in result["impacted_nodes"]}, {"RULE": 1, "OTHER": 2})

    def test_model_request_receives_actual_official_passage_and_source_identity(self):
        class Response:
            def json(inner_self):
                return {"choices": [{"message": {"content": self.markdown}}]}
        request = {key: value for key, value in self.request.items() if key != "revised_markdown"}
        with patch.dict(os.environ, {"RULECRAFT_LLM_BASE_URL": "http://localhost:9001/v1", "RULECRAFT_LLM_MODEL": "fixture"}), patch.object(adapters, "_request", return_value=Response()) as model_request:
            result = PackageWorkflow(self.store, self.vault / "packages", self.source).run(request)
        self.assertTrue(result["verification"]["valid"])
        prompt = model_request.call_args.kwargs["json"]["messages"][1]["content"]
        self.assertIn(self.source.law["provisions"][0]["text"], prompt)
        self.assertIn("law:synthetic-test", prompt)
        self.assertIn("2026-11-01", prompt)
        self.assertIn(self.source.law["source_url"], prompt)

    def test_requested_effective_date_is_passed_to_every_official_lookup(self):
        collect_grounding(self.store, self.node, self.request, self.source)
        self.assertTrue(self.source.calls)
        self.assertTrue(all(call[-1] == "2026-11-01" for call in self.source.calls))

    def test_unverified_historical_snapshot_is_warning_not_false_missing_article(self):
        class HistoricalSource(FixtureLawStore):
            def resolve_citation(self, law_name, article_no, as_of=None):
                result = super().resolve_citation(law_name, article_no, as_of=as_of)
                if result["law"]:
                    result["law"]["temporal_verified"] = False
                    result.update(found=False, temporal_verified=False, reason="historical_snapshot_unverified")
                return result
        issues = check_citations(self.store, HistoricalSource(), "「가상 데이터법」 제15조 제999항", "rule.md", "2026-11-01")
        self.assertEqual([issue["code"] for issue in issues], ["official_citation_temporal_unverified"])
        self.assertEqual(issues[0]["severity"], "warning")

    def test_real_law_store_interface_preserves_original_hash_in_grounding(self):
        from rulecraft.law_store import LawStore
        source = LawStore(self.vault / "official-corpus")
        document = {**self.source.law, "raw": b"<synthetic-test-source/>", "raw_format": "xml"}
        saved = source.save_document(document)
        source.save_manifest("law", [{"source_id": document["source_id"], "version_id": document["version_id"]}], "test-run")
        source.mark_snapshot("law", "test-run", [{"source_id": document["source_id"], "version_id": document["version_id"]}])
        grounding = collect_grounding(self.store, self.node, {**self.request, "effective_date": "2099-01-01"}, source)
        self.assertTrue(grounding["sources"])
        self.assertEqual(grounding["sources"][0]["law_id"], saved["law_id"])
        self.assertEqual(len(grounding["sources"][0]["sha256"]), 64)
        self.assertIn("[합성 테스트 원문]", grounding["sources"][0]["passage"])
