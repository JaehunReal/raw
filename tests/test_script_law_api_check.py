"""Synthetic probe contracts; successful fixtures are not official API evidence.

Every LawClient uses an explicit dummy account and an in-memory MockTransport.
No environment credential, provider connection, or official corpus is used.
"""

from __future__ import annotations

from contextlib import contextmanager, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx

from rulecraft.law_sources import LawClient, LawSourceError


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "check-law-api.py"
SPEC = importlib.util.spec_from_file_location("rulecraft_law_api_probe", SCRIPT_PATH)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
TEST_ACCOUNT = "synthetic-probe-account-secret"
SOURCE_TARGET = {"law": "law", "administrative": "admrul", "ordinance": "ordin"}


def fixtures() -> dict[str, tuple[bytes, bytes]]:
    """Use distinct source schemas and real parser entry points, not parsed mocks."""
    documents = {}
    for source, target, search_root, item_tag, full_root, id_tag, version_tag, title_tag, identifier in [
        ("law", "law", "LawSearch", "law", "법령", "법령ID", "법령일련번호", "법령명한글", "100"),
        ("administrative", "admrul", "AdmRulSearch", "admrul", "행정규칙", "행정규칙ID", "행정규칙일련번호", "행정규칙명", "200"),
        ("ordinance", "ordin", "OrdinSearch", "law", "자치법규", "자치법규ID", "자치법규일련번호", "자치법규명", "300"),
    ]:
        title = f"[합성 API 시험] {source} 표본"
        information = (
            f"<{id_tag}>{identifier}</{id_tag}><{version_tag}>{identifier}1</{version_tag}>"
            f"<{title_tag}>{title}</{title_tag}><공포일자>20250901</공포일자>"
            "<시행일자>20251001</시행일자><공포번호>101</공포번호>"
        )
        catalogue = (
            f"<{search_root}><totalCnt>37</totalCnt><{item_tag}>{information}</{item_tag}></{search_root}>"
        ).encode()
        if source == "administrative":
            body = "<조문내용><![CDATA[제1조(목적) 합성 지침을 점검한다.\n제2조(범위) 시험 범위만 확인한다.]]></조문내용>"
        else:
            body = (
                "<조문><조문단위><조문번호>1</조문번호><조문여부>조문</조문여부>"
                "<조문제목>목적</조문제목><조문내용>제1조(목적) 합성 조문이다.</조문내용>"
                "<항><항번호>①</항번호><항내용>① 표본의 내용만 확인한다.</항내용>"
                "<호><호번호>1.</호번호><호내용>1. 합성 기록</호내용></호></항>"
                "</조문단위></조문>"
            )
        full = f"<{full_root}><기본정보>{information}</기본정보>{body}</{full_root}>".encode()
        documents[target] = catalogue, full
    return documents


@contextmanager
def in_directory(directory: Path):
    previous = Path.cwd()
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(previous)


def disk_snapshot(directory: Path) -> dict[str, bytes]:
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in directory.rglob("*") if path.is_file()}


class LawApiProbeTests(unittest.TestCase):
    def client(self, callback, account: str = TEST_ACCOUNT) -> LawClient:
        client = LawClient(oc=account, base_url="https://synthetic-law.invalid/DRF",
                           transport=httpx.MockTransport(callback), minimum_interval=0, retries=0)
        self.addCleanup(client.close)
        return client

    def invoke(self, client: LawClient, arguments: list[str] | None = None) -> tuple[int, dict, str]:
        output = io.StringIO()
        with patch.object(PROBE, "LawClient", return_value=client) as factory, \
                patch.object(sys, "argv", [str(SCRIPT_PATH), *(arguments or [])]), \
                patch.object(sqlite3, "connect", side_effect=AssertionError("Probe must not open a corpus database")), \
                patch("httpx.HTTPTransport.handle_request", side_effect=AssertionError("Real networking is forbidden in probe tests")), \
                redirect_stdout(output):
            code = PROBE.main()
        factory.assert_called_once_with(retries=0, timeout=15)
        encoded = output.getvalue()
        return code, json.loads(encoded), encoded

    @staticmethod
    def responding(requests: list, data: dict, override=None):
        def callback(request):
            requests.append(request)
            target = request.url.params["target"]
            if override:
                response = override(request, target)
                if response is not None:
                    return response
            catalogue, full = data[target]
            return httpx.Response(200, content=catalogue if request.url.path.endswith("lawSearch.do") else full)
        return callback

    def test_three_sources_parse_xml_but_never_claim_full_collection_or_persist_documents(self):
        data, requests = fixtures(), []
        with tempfile.TemporaryDirectory() as directory, in_directory(Path(directory)):
            sentinel = Path("existing-vault.md")
            sentinel.write_text("existing data", encoding="utf-8")
            before = disk_snapshot(Path(directory))
            code, report, encoded = self.invoke(self.client(self.responding(requests, data)))
            self.assertEqual(disk_snapshot(Path(directory)), before)
        self.assertEqual(code, 0)
        self.assertTrue(report["configured"])
        self.assertTrue(report["provider_access_verified"])
        self.assertFalse(report["full_collection_verified"])
        self.assertFalse(report["writes_corpus"])
        self.assertEqual(len(requests), 6, "Only one catalogue page and one document per source")
        self.assertEqual({item["source"] for item in report["sources"]}, set(SOURCE_TARGET))
        for item in report["sources"]:
            with self.subTest(source=item["source"]):
                target = SOURCE_TARGET[item["source"]]
                self.assertTrue(item["catalogue_verified"] and item["full_document_verified"])
                self.assertEqual((item["catalogue_total"], item["catalogue_sample_count"]), (37, 1))
                self.assertEqual(item["article_count"], 2 if item["source"] == "administrative" else 1)
                self.assertTrue(item["response_identity_verified"])
                self.assertTrue(item["response_version_verified"])
                self.assertEqual(item["raw_sha256"], hashlib.sha256(data[target][1]).hexdigest())
                self.assertEqual(item["raw_bytes"], len(data[target][1]))
                self.assertNotIn("raw", item)
                self.assertNotIn("source_url", item)
        for request in requests:
            if request.url.path.endswith("lawSearch.do"):
                self.assertEqual((request.url.params["page"], request.url.params["display"]), ("1", "1"))
                self.assertNotIn("query", request.url.params)
        self.assertNotIn(TEST_ACCOUNT, encoded)
        self.assertNotIn("제1조(목적)", encoded, "Reports contain summary metadata, not raw legal content")

    def test_missing_credentials_reports_every_source_without_networking(self):
        def unexpected(_):
            self.fail("Missing credentials must be rejected before HTTP transport")
        with tempfile.TemporaryDirectory() as directory, in_directory(Path(directory)):
            code, report, encoded = self.invoke(self.client(unexpected, account=""))
            self.assertEqual(disk_snapshot(Path(directory)), {})
        self.assertEqual(code, 2)
        self.assertFalse(report["configured"])
        self.assertFalse(report["provider_access_verified"])
        self.assertEqual([item["error"]["code"] for item in report["sources"]], ["missing_credentials"] * 3)
        self.assertTrue(all(not item["catalogue_verified"] and not item["full_document_verified"] for item in report["sources"]))
        self.assertNotIn(TEST_ACCOUNT, encoded)

    def test_one_full_document_failure_preserves_successful_sources_and_fails_the_probe(self):
        requests = []
        def deny_administrative(request, target):
            if target == "admrul" and request.url.path.endswith("lawService.do"):
                return httpx.Response(403, text=f"denied private URL ?OC={TEST_ACCOUNT}")
        with tempfile.TemporaryDirectory() as directory, in_directory(Path(directory)):
            code, report, encoded = self.invoke(self.client(self.responding(requests, fixtures(), deny_administrative)))
            self.assertEqual(disk_snapshot(Path(directory)), {})
        self.assertEqual(code, 2)
        self.assertFalse(report["provider_access_verified"])
        sources = {item["source"]: item for item in report["sources"]}
        self.assertTrue(sources["law"]["full_document_verified"])
        self.assertTrue(sources["ordinance"]["full_document_verified"])
        failed = sources["administrative"]
        self.assertTrue(failed["catalogue_verified"])
        self.assertFalse(failed["full_document_verified"])
        self.assertEqual((failed["error"]["code"], failed["error"]["status_code"]), ("access_denied", 403))
        self.assertNotIn("raw_sha256", failed)
        self.assertNotIn(TEST_ACCOUNT, encoded)
        self.assertEqual(len(requests), 6)

    def test_empty_catalogue_does_not_verify_a_full_document_or_request_one(self):
        requests = []
        def empty_ordinance(request, target):
            if target == "ordin" and request.url.path.endswith("lawSearch.do"):
                return httpx.Response(200, content=b"<OrdinSearch><totalCnt>0</totalCnt></OrdinSearch>")
        code, report, _ = self.invoke(self.client(self.responding(requests, fixtures(), empty_ordinance)))
        self.assertEqual(code, 2)
        item = next(item for item in report["sources"] if item["source"] == "ordinance")
        self.assertTrue(item["catalogue_verified"])
        self.assertEqual((item["catalogue_total"], item["catalogue_sample_count"]), (0, 0))
        self.assertFalse(item["full_document_verified"])
        self.assertEqual(item["error"]["code"], "empty_catalogue")
        self.assertFalse(report["provider_access_verified"])
        self.assertEqual(len(requests), 5)

    def test_optional_report_output_redacts_an_echoed_dummy_secret_and_saves_no_corpus(self):
        def failing(request):
            source = next(source for source, target in SOURCE_TARGET.items() if target == request.url.params["target"])
            raise LawSourceError("synthetic_error", f"upstream echoed {TEST_ACCOUNT}", source)
        with tempfile.TemporaryDirectory() as directory, in_directory(Path(directory)):
            output = Path("report/probe.json")
            code, report, encoded = self.invoke(self.client(failing), ["--output", str(output)])
            self.assertEqual(set(disk_snapshot(Path(directory))), {"report/probe.json"})
            self.assertEqual(output.read_text(encoding="utf-8"), encoded)
            self.assertEqual(json.loads(output.read_text()), report)
        self.assertEqual(code, 2)
        self.assertNotIn(TEST_ACCOUNT, encoded)
        self.assertIn("[redacted]", encoded)
        self.assertFalse(report["writes_corpus"])

    def test_repeated_source_selection_is_bounded_to_one_sample_each(self):
        requests = []
        code, report, _ = self.invoke(self.client(self.responding(requests, fixtures())),
                                      ["--sources", "law", "law", "ordinance"])
        self.assertEqual(code, 0)
        self.assertEqual([item["source"] for item in report["sources"]], ["law", "ordinance"])
        self.assertEqual(len(requests), 4)
        self.assertFalse(report["full_collection_verified"])


if __name__ == "__main__":
    unittest.main()
