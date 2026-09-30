"""Synthetic fixture tests. They never download or claim real official laws."""

from __future__ import annotations

from copy import deepcopy
from datetime import date
import fcntl
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from rulecraft.law_sources import LawSourceError
from rulecraft.law_store import LawStore
from rulecraft.law_sync import LawSync


def item(source: str, identifier: str, version: str = "v1") -> dict:
    return {"source": source, "source_id": identifier, "version_id": version,
            "title": f"합성 테스트 법령 {identifier}", "publication_date": "2020-01-01",
            "effective_date": "2020-02-01", "publication_no": "TEST-1",
            "source_url": f"https://www.law.go.kr/DRF/lawService.do?ID={identifier}",
            "metadata": {"synthetic_fixture": True}}


def document(catalogue_item: dict, text: str = "① 합성 테스트 목적을 확인하여야 한다.") -> dict:
    return {**deepcopy(catalogue_item), "raw": f"<synthetic-fixture>{text}</synthetic-fixture>".encode(),
            "raw_format": "xml", "text": text,
            "provisions": [{"article_no": "제7조", "title": "합성 목적", "text": text,
                            "paragraphs": [{"paragraph_no": "1", "text": text,
                                            "items": [{"item_no": "1", "text": "1. 합성 항목"}]}]}]}


class FixtureClient:
    def __init__(self, catalogue: dict[str, list[dict]]):
        self.catalogue = catalogue
        self.page_overrides: dict[tuple[str, int], dict] = {}
        self.fail_ids: set[str] = set()
        self.wrong_identity: set[str] = set()
        self.fetch_calls: list[str] = []
        self.text_by_id: dict[str, str] = {}
        self.catalogue_calls: list[tuple[str, int]] = []
        self.on_fetch = None

    def catalog(self, source: str, page: int = 1, page_size: int = 100) -> dict:
        self.catalogue_calls.append((source, page))
        values = self.catalogue.get(source, [])
        response = {"source": source, "page": page, "total": len(values), "supported": True,
                    "items": deepcopy(values[(page - 1) * page_size:page * page_size])}
        response.update(deepcopy(self.page_overrides.get((source, page), {})))
        return response

    def fetch_full(self, value: dict) -> dict:
        identifier = value["source_id"]
        self.fetch_calls.append(identifier)
        if identifier in self.fail_ids:
            raise LawSourceError("upstream_unavailable", "합성 fixture의 원문 실패입니다.", source=value["source"], retriable=True)
        result = document(value, self.text_by_id.get(identifier, "① 합성 테스트 목적을 확인하여야 한다."))
        if identifier in self.wrong_identity:
            result["source_id"] = "DIFFERENT"
        if self.on_fetch:
            self.on_fetch()
        return result


class LawSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="rulecraft-synthetic-laws-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = LawStore(self.root)

    def test_full_declared_scope_uses_every_page_and_exact_current_counts(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")],
                                "administrative": [item("administrative", "C")], "ordinance": []})
        events = []
        result = LawSync(self.store, client).run(page_size=1, progress=events.append)
        self.assertTrue(result["complete"])
        self.assertEqual(client.catalogue_calls, [("law", 1), ("law", 2), ("administrative", 1), ("ordinance", 1)])
        self.assertEqual(result["sources"]["law"]["collected"], 2)
        self.assertTrue(self.store.coverage()["complete"])
        self.assertEqual(self.store.search()["total"], 3)
        self.assertFalse(result["historical_complete"])
        self.assertFalse(result["attachments_complete"])
        self.assertFalse(result["provider_contract_verified"])
        self.assertTrue(any(event["phase"] == "full_text" for event in events))

    def test_failed_item_resumes_and_old_errors_are_cleared(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
        client.fail_ids.add("B")
        first = LawSync(self.store, client).run(["law"])
        self.assertFalse(first["complete"])
        self.assertEqual(first["sources"]["law"]["failed"], 1)
        client.fail_ids.clear()
        second = LawSync(self.store, client).run(["law"])
        self.assertTrue(second["complete"])
        self.assertEqual(client.fetch_calls, ["A", "B", "B"])
        self.assertEqual(second["sources"]["law"]["reused"], 1)
        self.assertEqual(second["sources"]["law"]["errors"], [])
        self.assertTrue(self.store.coverage()["complete"])

    def test_duplicate_repeated_page_does_not_create_complete_corpus(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
        client.page_overrides[("law", 2)] = {"items": [item("law", "A")]}
        result = LawSync(self.store, client).run(["law"], page_size=1)
        self.assertFalse(result["complete"])
        self.assertEqual(result["sources"]["law"]["errors"][0]["code"], "duplicate_catalogue_item")
        self.assertEqual(client.fetch_calls, [])

    def test_catalogue_total_drift_and_missing_page_block_completion(self) -> None:
        for override, code in [({"total": 3}, "catalogue_drift"), ({"items": []}, "empty_page")]:
            with self.subTest(code=code):
                client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
                client.page_overrides[("law", 2)] = override
                result = LawSync(self.store, client).run(["law"], page_size=1)
                self.assertFalse(result["complete"])
                self.assertEqual(result["sources"]["law"]["errors"][0]["code"], code)

    def test_declared_total_and_unique_catalogue_mismatch_blocks_completion(self) -> None:
        client = FixtureClient({"law": [item("law", "A")]})
        client.page_overrides[("law", 1)] = {"total": 2}
        result = LawSync(self.store, client).run(["law"], page_size=100)
        self.assertEqual(result["sources"]["law"]["errors"][0]["code"], "catalogue_count_mismatch")
        self.assertFalse(self.store.coverage()["complete"])

    def test_wrong_fulltext_identity_is_not_saved(self) -> None:
        client = FixtureClient({"law": [item("law", "A")]})
        client.wrong_identity.add("A")
        result = LawSync(self.store, client).run(["law"])
        self.assertFalse(result["complete"])
        self.assertEqual(result["sources"]["law"]["errors"][0]["code"], "identity_mismatch")
        self.assertEqual(self.store.search()["total"], 0)

    def test_removed_catalogue_members_do_not_leak_into_current_listing(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
        LawSync(self.store, client).run(["law"])
        client.catalogue["law"] = [item("law", "A")]
        result = LawSync(self.store, client).run(["law"])
        self.assertTrue(result["complete"])
        self.assertEqual(self.store.search()["total"], 1)
        self.assertEqual(self.store.search(as_of=date.today().isoformat())["total"], 1)
        self.assertEqual(self.store.coverage()["sources"]["law"]["snapshot_collected"], 1)

    def test_cancelled_run_retains_previous_snapshot(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
        LawSync(self.store, client).run(["law"])
        cancellation = threading.Event()
        client.catalogue["law"] = [item("law", "A", "v2"), item("law", "C")]
        client.on_fetch = cancellation.set
        result = LawSync(self.store, client).run(["law"], cancel_event=cancellation)
        self.assertFalse(result["complete"])
        self.assertTrue(result["sources"]["law"]["snapshot_retained"])
        self.assertEqual({law["source_id"] for law in self.store.search()["items"]}, {"A", "B"})

    def test_missing_credentials_and_unsupported_scope_remain_incomplete(self) -> None:
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": ""}):
            result = LawSync(self.store).run(["law"])
        self.assertFalse(result["complete"])
        self.assertEqual(result["sources"]["law"]["status"], "blocked")
        self.assertEqual(result["sources"]["law"]["errors"][0]["code"], "missing_credentials")
        unsupported = LawSync(self.store, FixtureClient({})).run(["treaty"])
        self.assertFalse(unsupported["complete"])
        self.assertEqual(unsupported["sources"]["treaty"]["errors"][0]["code"], "unsupported_source")

    def test_cross_process_lock_does_not_overwrite_active_coverage(self) -> None:
        self.store.set_coverage({"complete": False, "scope": ["law"], "run_id": "RUNNING", "sources": {}})
        with (self.root / "sync.lock").open("w") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = LawSync(self.store, FixtureClient({})).run(["law"])
            self.assertEqual(result["errors"][0]["code"], "sync_in_progress")
        self.assertEqual(self.store.coverage()["run_id"], "RUNNING")

    def test_reset_refetches_previously_downloaded_versions(self) -> None:
        client = FixtureClient({"law": [item("law", "A")]})
        synchronizer = LawSync(self.store, client)
        synchronizer.run(["law"])
        synchronizer.run(["law"], reset=True)
        self.assertEqual(client.fetch_calls, ["A", "A"])
        self.assertTrue(self.store.coverage()["complete"])

    def test_added_updated_removed_changes_are_hashed_and_paginated(self) -> None:
        client = FixtureClient({"law": [item("law", "A"), item("law", "B")]})
        initial = LawSync(self.store, client).run(["law"])
        self.assertEqual(initial["sources"]["law"]["changes_total"], 2)
        client.catalogue["law"] = [item("law", "A", "v2"), item("law", "C")]
        client.text_by_id["A"] = "① 합성 변경 목적과 책임자를 확인하여야 한다."
        updated = LawSync(self.store, client).run(["law"])
        changes = self.store.get_changes()
        self.assertEqual(changes["total"], 3)
        self.assertEqual(changes["run_id"], updated["run_id"])
        self.assertEqual({change["change_type"] for change in changes["items"]},
                         {"added", "updated", "removed_from_catalogue"})
        amendment = next(change for change in changes["items"] if change["change_type"] == "updated")
        self.assertEqual(amendment["before_version_id"], "v1")
        self.assertEqual(amendment["after_version_id"], "v2")
        self.assertNotEqual(amendment["before_sha256"], amendment["after_sha256"])
        removal = next(change for change in changes["items"] if change["change_type"] == "removed_from_catalogue")
        self.assertIsNone(removal["after_version_id"])
        self.assertIn("폐지 여부는 별도 확인", removal["notice"])
        page = self.store.get_changes(updated["run_id"], source="law", limit=1, offset=1)
        self.assertEqual(page["total"], 3)
        self.assertEqual(len(page["items"]), 1)
        same = LawSync(self.store, client).run(["law"])
        self.assertEqual(same["sources"]["law"]["changes_total"], 0)
        self.assertEqual(self.store.get_changes()["total"], 0)
        self.assertEqual(self.store.get_changes(updated["run_id"])["total"], 3)

    def test_changes_preview_is_bounded_without_losing_full_report(self) -> None:
        client = FixtureClient({"law": [item("law", str(index)) for index in range(501)]})
        result = LawSync(self.store, client).run(["law"])
        state = result["sources"]["law"]
        self.assertEqual(state["changes_total"], 501)
        self.assertEqual(len(state["changes"]), 500)
        self.assertTrue(state["changes_truncated"])
        self.assertEqual(self.store.get_changes()["total"], 501)
        last = self.store.get_changes(limit=20, offset=500)
        self.assertEqual(len(last["items"]), 1)
        self.assertEqual(last["total"], 501)

    def test_resume_of_staged_version_reports_activation_as_update(self) -> None:
        client = FixtureClient({"law": [item("law", "A")]})
        LawSync(self.store, client).run(["law"])
        cancellation = threading.Event()
        client.catalogue["law"] = [item("law", "A", "v2"), item("law", "C")]
        client.on_fetch = cancellation.set
        LawSync(self.store, client).run(["law"], cancel_event=cancellation)
        client.on_fetch = None
        result = LawSync(self.store, client).run(["law"])
        self.assertEqual(result["sources"]["law"]["reused"], 1)
        self.assertEqual({change["change_type"] for change in self.store.get_changes()["items"]}, {"updated", "added"})


class LawStoreEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="rulecraft-synthetic-law-evidence-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = LawStore(self.root)

    def test_immutable_versions_preserve_original_raw_hashes(self) -> None:
        base = item("law", "A")
        first, second = document(base, "합성 원본"), document(base, "합성 수정 원본")
        saved = self.store.save_document(first)
        duplicate = self.store.save_document(first)
        changed = self.store.save_document(second)
        self.assertTrue(saved["inserted"])
        self.assertFalse(duplicate["inserted"])
        self.assertNotEqual(changed["version_id"], saved["version_id"])
        self.assertEqual(len(list((self.root / "raw/law").glob("*.xml"))), 2)
        raw_hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in (self.root / "raw/law").glob("*.xml")}
        self.assertEqual(raw_hashes, {hashlib.sha256(first["raw"]).hexdigest(), hashlib.sha256(second["raw"]).hexdigest()})

    def test_future_missing_date_and_pre_capture_citations_are_not_confirmed(self) -> None:
        value = item("law", "A")
        self.store.save_document(document(value))
        self.store.save_manifest("law", [value], "synthetic-run")
        self.store.mark_snapshot("law", "synthetic-run", [value])
        historical = self.store.resolve_citation(value["title"], "제7조", "2021-01-01")
        self.assertFalse(historical["found"])
        self.assertFalse(historical["temporal_verified"])
        current = self.store.resolve_citation(value["title"], "제7조", date.today().isoformat())
        self.assertTrue(current["found"])
        future = item("law", "FUTURE")
        future["effective_date"] = "2999-01-01"
        self.store.save_document(document(future))
        unknown = item("law", "UNKNOWN")
        unknown["effective_date"] = None
        self.store.save_document(document(unknown))
        self.assertIsNone(self.store.get("law:FUTURE"))
        self.assertIsNone(self.store.get("law:UNKNOWN"))

    def test_source_provenance_never_exposes_oc_account(self) -> None:
        value = item("law", "A")
        value["source_url"] += "&OC=fixture-secret"
        value["metadata"]["source_link"] = "https://www.law.go.kr/DRF/lawService.do?OC=fixture-secret&ID=A"
        self.store.save_document(document(value))
        law = self.store.get("law:A")
        self.assertNotIn("fixture-secret", law["source_url"])
        self.assertNotIn("fixture-secret", law["metadata"]["source_link"])

    def test_default_catalogue_shows_unknown_and_future_dates_as_unverified(self) -> None:
        values = [item("law", "CURRENT"), item("law", "FUTURE"), item("law", "UNKNOWN")]
        values[1]["effective_date"] = "2999-01-01"
        values[2]["effective_date"] = None
        for value in values:
            self.store.save_document(document(value))
        self.store.save_manifest("law", values, "synthetic-catalogue")
        self.store.mark_snapshot("law", "synthetic-catalogue", values)
        self.assertEqual(self.store.search()["total"], 3)
        self.assertEqual(self.store.search(as_of=date.today().isoformat())["total"], 1)
        for identifier in ("FUTURE", "UNKNOWN"):
            value = self.store.get("law:" + identifier)
            self.assertIsNotNone(value)
            self.assertFalse(value["temporal_verified"])
            self.assertFalse(self.store.resolve_citation(value["title"], "제7조")["found"])
