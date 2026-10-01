"""Synthetic lookup and evidence fixtures; no provider access or legal claims."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from rulecraft.law_store import LawStore


class LawStoreLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="rulecraft-synthetic-lookup-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.store = LawStore(self.root)

    def save_law(self, identifier: str = "A", *, version: str = "v1",
                 title: str = "합성 관리법", text: str = "제2조 합성 목적을 정한다.",
                 publication_date: str | None = "2020-01-01",
                 effective_date: str | None = "2020-02-01",
                 fetched_at: str = "2020-02-02T00:00:00+00:00") -> dict:
        document = {
            "source": "law", "source_id": identifier, "version_id": version,
            "title": title, "publication_date": publication_date,
            "effective_date": effective_date, "publication_no": "SYNTHETIC-1",
            "source_url": "https://www.law.go.kr/DRF/lawService.do?ID=" + identifier,
            "raw": f"<synthetic-fixture id='{identifier}' version='{version}'>{text}</synthetic-fixture>".encode(),
            "raw_format": "xml", "text": text,
            # Deliberately omit deleted: archived legacy records need the fallback.
            "provisions": [{"article_no": "제2조", "title": "합성 조문", "text": text}],
            "metadata": {"synthetic_fixture": True},
        }
        with patch("rulecraft.law_store._now", return_value=fetched_at):
            return {**document, **self.store.save_document(document)}

    def snapshot(self, documents: list[dict], *, run_id: str = "synthetic-current",
                 captured_at: str = "2022-01-01T00:00:00+00:00") -> None:
        with patch("rulecraft.law_store._now", return_value=captured_at):
            self.store.mark_snapshot("law", run_id,
                                     [(law["source_id"], law["version_id"]) for law in documents])

    def raw_path(self, document: dict) -> Path:
        digest = hashlib.sha256(document["raw"]).hexdigest()
        return self.root / "raw" / "law" / f"{digest}.xml"

    def renamed_law(self) -> tuple[dict, dict]:
        old = self.save_law(title="합성 옛 관리법")
        self.snapshot([old], run_id="synthetic-old",
                      captured_at="2020-03-01T00:00:00+00:00")
        new = self.save_law(version="v2", title="합성 새 관리법",
                            publication_date="2021-01-01", effective_date="2021-02-01",
                            fetched_at="2021-02-02T00:00:00+00:00")
        # Keeping both archived versions in a snapshot forces ranking before title
        # comparison: a title predicate inside the rank would revive the old name.
        self.snapshot([old, new], captured_at="2021-03-01T00:00:00+00:00")
        return old, new

    def test_legacy_deletion_markers_are_refused_as_citation_evidence(self) -> None:
        for index, text in enumerate(("제2조 삭제", "제2조 삭제 <2020. 1. 1.>",
                                      "(삭제)", "[삭제]")):
            with self.subTest(text=text):
                law = self.save_law(str(index), text=text)
                self.snapshot([law], run_id=f"synthetic-delete-{index}",
                              captured_at=f"2022-01-{index + 1:02d}T00:00:00+00:00")
                result = self.store.resolve_citation(law["law_id"], "제2조", "2022-02-01")
                self.assertFalse(result["found"])
                self.assertEqual(result["reason"], "article_deleted")
                self.assertTrue(result["law"]["evidence_verified"])
                self.assertTrue(result["law"]["temporal_verified"])

    def test_mentions_of_deletion_procedures_remain_valid(self) -> None:
        texts = ("제2조(삭제절차) 개인정보 삭제절차를 정한다.",
                 "제2조 삭제절차는 별도로 정한다.",
                 "삭제 요청이 있으면 담당자는 내용을 검토하여야 한다.")
        laws = [self.save_law(str(index), text=text) for index, text in enumerate(texts)]
        self.snapshot(laws)
        for law in laws:
            with self.subTest(text=law["text"]):
                result = self.store.resolve_citation(law["law_id"], "제2조", "2022-02-01")
                self.assertTrue(result["found"], result.get("reason"))

    def test_title_match_is_applied_after_latest_version_ranking(self) -> None:
        old, new = self.renamed_law()
        obsolete = self.store.resolve_citation(old["title"], "제2조", "2022-02-01")
        self.assertFalse(obsolete["found"])
        self.assertEqual(obsolete["reason"], "law_not_collected")
        current = self.store.resolve_citation(new["title"], "제2조", "2022-02-01")
        self.assertTrue(current["found"], current.get("reason"))
        self.assertEqual(current["law"]["version_id"], new["version_id"])
        historical = self.store.resolve_citation(old["title"], "제2조", "2020-06-01")
        self.assertTrue(historical["found"], historical.get("reason"))
        self.assertEqual(historical["law"]["version_id"], old["version_id"])
        self.assertFalse(self.store.resolve_citation(new["title"], "제2조", "2020-06-01")["found"])

    def test_official_id_uses_the_same_latest_and_dated_version_selection(self) -> None:
        old, new = self.renamed_law()
        for as_of, expected in (("2022-02-01", new), ("2020-06-01", old)):
            with self.subTest(as_of=as_of):
                citation = self.store.resolve_citation(old["law_id"], "제2조", as_of)
                self.assertTrue(citation["found"], citation.get("reason"))
                self.assertEqual(citation["law"]["version_id"], expected["version_id"])
                detail = self.store.get(old["law_id"], as_of)
                self.assertEqual(detail["version_id"], expected["version_id"])

    def test_unknown_and_future_dates_are_excluded_from_dated_candidates(self) -> None:
        current = self.save_law("CURRENT", title="합성 현행법")
        candidates = [
            self.save_law("NO-PUBLICATION", title="합성 공포일 누락법", publication_date=None),
            self.save_law("NO-EFFECTIVE", title="합성 시행일 누락법", effective_date=None),
            self.save_law("FUTURE-PUBLICATION", title="합성 미래 공포법", publication_date="2999-01-01"),
            self.save_law("FUTURE-EFFECTIVE", title="합성 미래 시행법", effective_date="2999-01-01"),
        ]
        self.snapshot([current, *candidates])
        self.assertEqual(self.store.search(as_of="2022-02-01")["total"], 1)
        self.assertEqual(self.store.search()["total"], 5)
        for candidate in candidates:
            with self.subTest(identifier=candidate["law_id"]):
                self.assertIsNone(self.store.get(candidate["law_id"], "2022-02-01"))
                for selector in (candidate["law_id"], candidate["title"]):
                    citation = self.store.resolve_citation(selector, "제2조", "2022-02-01")
                    self.assertFalse(citation["found"])
                    self.assertEqual(citation["reason"], "law_not_collected")

    def test_normalized_matching_titles_stay_ambiguous(self) -> None:
        first = self.save_law("A", title="합성 관리법")
        second = self.save_law("B", title="「합성관리법」")
        self.snapshot([first, second])
        citation = self.store.resolve_citation("『합성 관리법』", "제2조", "2022-02-01")
        self.assertFalse(citation["found"])
        self.assertTrue(citation["ambiguous"])
        self.assertEqual(citation["reason"], "ambiguous_law_title")
        self.assertEqual({law["law_id"] for law in citation["candidates"]}, {"law:A", "law:B"})
        for law in (first, second):
            with self.subTest(identifier=law["law_id"]):
                resolved = self.store.resolve_citation(law["law_id"], "제2조", "2022-02-01")
                self.assertTrue(resolved["found"], resolved.get("reason"))

    def test_available_search_summary_checks_presence_without_hashing(self) -> None:
        law = self.save_law()
        self.snapshot([law])
        with patch("rulecraft.law_store.hashlib.file_digest", side_effect=AssertionError("summary hashed original")):
            summary = self.store.search(as_of="2022-02-01")["items"][0]
        self.assertTrue(summary["raw_available"])
        self.assertTrue(summary["temporal_verified"])
        self.assertIsNone(summary["raw_integrity_verified"])
        with patch("rulecraft.law_store.hashlib.file_digest", wraps=hashlib.file_digest) as digest:
            detail = self.store.get(law["law_id"], "2022-02-01")
        digest.assert_called_once()
        self.assertTrue(detail["raw_available"])
        self.assertTrue(detail["raw_integrity_verified"])
        self.assertTrue(detail["temporal_verified"])

    def test_missing_original_search_summary_is_unverified_without_hashing(self) -> None:
        law = self.save_law()
        self.snapshot([law])
        self.raw_path(law).unlink()
        with patch("rulecraft.law_store.hashlib.file_digest", side_effect=AssertionError("summary hashed original")):
            summary = self.store.search(as_of="2022-02-01")["items"][0]
        self.assertFalse(summary["raw_available"])
        self.assertFalse(summary["temporal_verified"])
        self.assertFalse(summary["raw_integrity_verified"])
        detail = self.store.get(law["law_id"], "2022-02-01")
        self.assertFalse(detail["raw_integrity_verified"])
        citation = self.store.resolve_citation(law["law_id"], "제2조", "2022-02-01")
        self.assertFalse(citation["found"])
        self.assertEqual(citation["reason"], "original_evidence_integrity_failure")

    def test_symlink_original_search_summary_is_unavailable_without_hashing(self) -> None:
        law = self.save_law()
        self.snapshot([law])
        original = self.raw_path(law)
        target = self.root / "synthetic-symlink-target.xml"
        original.rename(target)
        original.symlink_to(target)
        with patch("rulecraft.law_store.hashlib.file_digest", side_effect=AssertionError("summary followed symlink")):
            summary = self.store.search(as_of="2022-02-01")["items"][0]
        self.assertFalse(summary["raw_available"])
        self.assertFalse(summary["temporal_verified"])
        self.assertFalse(summary["raw_integrity_verified"])
        self.assertFalse(self.store.get(law["law_id"], "2022-02-01")["raw_integrity_verified"])

    def test_unsafe_original_path_search_summary_is_unavailable(self) -> None:
        law = self.save_law()
        self.snapshot([law])
        with self.store._connection() as connection:
            connection.execute("UPDATE documents SET raw_path='../synthetic-outside.xml' WHERE law_id=?",
                               (law["law_id"],))
        with patch("rulecraft.law_store.hashlib.file_digest", side_effect=AssertionError("summary hashed unsafe path")):
            summary = self.store.search(as_of="2022-02-01")["items"][0]
        self.assertFalse(summary["raw_available"])
        self.assertFalse(summary["temporal_verified"])
        self.assertFalse(summary["raw_integrity_verified"])

    def test_detail_detects_corruption_that_summary_does_not_hash(self) -> None:
        law = self.save_law()
        self.snapshot([law])
        self.raw_path(law).write_bytes(b"<synthetic-fixture>corrupted original</synthetic-fixture>")
        with patch("rulecraft.law_store.hashlib.file_digest", side_effect=AssertionError("summary hashed original")):
            summary = self.store.search(as_of="2022-02-01")["items"][0]
        self.assertTrue(summary["raw_available"])
        self.assertIsNone(summary["raw_integrity_verified"])
        with patch("rulecraft.law_store.hashlib.file_digest", wraps=hashlib.file_digest) as digest:
            detail = self.store.get(law["law_id"], "2022-02-01")
        digest.assert_called_once()
        self.assertTrue(detail["raw_available"])
        self.assertFalse(detail["raw_integrity_verified"])
        self.assertFalse(detail["temporal_verified"])
        citation = self.store.resolve_citation(law["law_id"], "제2조", "2022-02-01")
        self.assertEqual(citation["reason"], "original_evidence_integrity_failure")

    def test_actual_citation_query_uses_indexed_title_and_id_candidates(self) -> None:
        law = self.save_law()
        unrelated = [self.save_law(str(index), title=f"합성 별개법 {index}") for index in range(16)]
        self.snapshot([law, *unrelated])
        original_connection = self.store._connection
        traced_sql: list[str] = []

        @contextmanager
        def traced_connection():
            with original_connection() as connection:
                connection.set_trace_callback(traced_sql.append)
                yield connection

        with patch.object(self.store, "_connection", traced_connection):
            citation = self.store.resolve_citation(law["title"], "제2조", "2022-02-01")
        self.assertTrue(citation["found"], citation.get("reason"))
        queries = [sql for sql in traced_sql if "ROW_NUMBER" in sql.upper()]
        self.assertEqual(len(queries), 1)
        with original_connection() as connection:
            details = [row[3] for row in connection.execute("EXPLAIN QUERY PLAN " + queries[0])]
        plan = "\n".join(details)
        self.assertIn("documents_title", plan)
        self.assertRegex(plan, r"SEARCH documents USING (?:COVERING )?INDEX sqlite_autoindex_documents_1 \(law_id=\?\)")
        self.assertFalse(any(re.search(r"\bSCAN documents(?:\s|$)", detail, re.IGNORECASE) for detail in details), plan)


if __name__ == "__main__":
    unittest.main()
