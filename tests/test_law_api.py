from __future__ import annotations

import hashlib
from datetime import date
import os
import threading
import time
from unittest.mock import patch

from fastapi.testclient import TestClient

from rulecraft.api import create_app
from tests.support import VaultTestCase, article


class OfficialLawApiTests(VaultTestCase):
    def setUp(self):
        super().setUp()
        self.write("rules/article.md", article("RULE", 7))
        self.app = create_app(self.vault, self.vault / "packages", self.vault / "official-index")
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.app.state.law_jobs.close)

    def add_fixture(self):
        raw = b"<fixture>Synthetic testing data, never a real official response.</fixture>"
        self.app.state.law_store.save_document({
            "source": "law", "source_id": "fixture-42", "version_id": "fixture-v1",
            "title": "공식조회테스트법", "publication_date": "2026-01-01",
            "effective_date": "2026-01-02", "publication_no": "fixture-only",
            "source_url": "https://example.test/fixture", "raw": raw, "raw_format": "xml",
            "text": "가상 검증 문서", "metadata": {"synthetic_test_fixture": True},
            "provisions": [{"article_no": "제7조의2", "title": "가상 조문",
                            "text": "① 합성 문서의 조회를 확인한다.", "paragraphs": []}],
        })
        self.app.state.law_store.mark_snapshot("law", "synthetic-fixture-snapshot", [
            {"source_id": "fixture-42", "version_id": "fixture-v1"},
        ])
        return hashlib.sha256(raw).hexdigest()

    def test_empty_corpus_missing_credentials_and_strict_request_validation(self):
        with patch.dict(os.environ, {}, clear=True):
            status = self.client.get("/api/laws/status").json()
            self.assertFalse(status["configured"])
            self.assertFalse(status["coverage"]["complete"])
            self.assertIn("RULECRAFT_LAW_OC", status["missing_requirements"])
            self.assertEqual(self.client.get("/api/laws").json()["total"], 0)
            self.assertEqual(self.client.post("/api/laws/sync", json={}).status_code, 503)
        for payload in ({"sources": ["law", "law"]}, {"sources": ["unsupported"]},
                        {"page_size": 0}, {"sources": []}):
            self.assertEqual(self.client.post("/api/laws/sync", json=payload).status_code, 422)
        self.assertEqual(self.client.get("/api/laws?as_of=2026-13-01").status_code, 422)

    def test_search_dated_detail_and_official_graph_keep_demo_separate(self):
        digest = self.add_fixture()
        listing = self.client.get("/api/laws?q=공식조회").json()
        self.assertEqual(listing["total"], 1)
        detail = self.client.get("/api/laws/law/fixture-42?as_of=2026-09-30")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["sha256"], digest)
        self.assertEqual(self.client.get("/api/laws/law/fixture-42?as_of=2025-01-01").status_code, 404)
        graph = self.client.get("/api/graph", params={
            "source_scope": "official", "rule_name": "공식조회테스트법",
            "article_no": "제7조의2", "as_of": date.today().isoformat(),
        }).json()
        self.assertEqual(len(graph["nodes"]), 1)
        self.assertTrue(graph["nodes"][0]["metadata"]["read_only"])
        self.assertFalse(graph["legal_authority_verified"])
        self.assertEqual([node["id"] for node in self.client.get("/api/graph").json()["nodes"]], ["RULE"])

    def test_http_to_real_mcp_worker_uses_same_official_index(self):
        digest = self.add_fixture()
        response = self.client.post("/api/mcp/call", json={"tool_name": "query_markdown_graph", "arguments": {
            "agency_name": "국가법령", "rule_name": "공식조회테스트법", "article_no": "제7조의2",
            "source_scope": "official", "as_of": date.today().isoformat(),
        }})
        self.assertEqual(response.status_code, 200, response.text)
        envelope = response.json()
        self.assertFalse(envelope["is_error"], envelope)
        self.assertEqual(envelope["transport"], "stdio")
        self.assertEqual(envelope["result"]["nodes"][0]["metadata"]["sha256"], digest)
        self.assertFalse(envelope["result"]["legal_authority_verified"])

    def test_latest_change_report_is_paginated_and_has_declared_local_impact(self):
        self.write("rules/article.md", article("RULE", 7, body="# 제7조\n「공식조회테스트법」 제7조의2에 따른다."))
        changes = [
            {"law_id": "law:fixture-42", "title": "공식조회테스트법", "source": "law",
             "change_type": "updated", "before_version_id": "test-v1", "after_version_id": "test-v2"},
            {"law_id": "law:other", "title": "다른테스트법", "source": "law", "change_type": "removed_from_catalogue"},
        ]
        self.app.state.law_store.save_changes("law", "test-change-run", changes)
        self.app.state.law_store.set_coverage({"run_id": "test-change-run", "scope": ["law"], "sources": {}})
        response = self.client.get("/api/laws/changes?limit=1").json()
        self.assertEqual(response["total"], 2)
        self.assertEqual(response["items"][0]["impact"]["count"], 1)
        self.assertEqual(response["items"][0]["impact"]["impacted_nodes"][0]["id"], "RULE")
        self.assertFalse(response["items"][0]["impact"]["applicability_verified"])
        page_two = self.client.get("/api/laws/changes?limit=1&offset=1").json()
        self.assertEqual(page_two["items"][0]["change_type"], "removed_from_catalogue")

    def test_background_sync_exposes_incomplete_results_and_blocks_concurrent_jobs(self):
        started, released = threading.Event(), threading.Event()
        self.addCleanup(released.set)

        class FakeSync:
            def run(self, **kwargs):
                started.set()
                released.wait(2)
                return {"complete": False, "sources": {"law": {"expected": 2, "collected": 1}}}

        self.app.state.law_jobs.synchronizer = FakeSync
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": "test-only-no-network"}):
            response = self.client.post("/api/laws/sync", json={"sources": ["law"]})
            self.assertEqual(response.status_code, 202)
            self.assertTrue(started.wait(2))
            self.assertEqual(self.client.post("/api/laws/sync", json={"sources": ["law"]}).status_code, 409)
            released.set()
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and self.app.state.law_jobs.status()["status"] != "incomplete":
                threading.Event().wait(.005)
            status = self.client.get("/api/laws/status").json()
            self.assertEqual(status["job"]["status"], "incomplete")
            self.assertFalse(status["job"]["coverage"]["complete"])
