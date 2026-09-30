"""Synthetic API contracts only: these fixtures are not official law evidence."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

import httpx

from rulecraft.law_sources import LawClient, LawSourceError


OC = "fixture-account-secret"


def law_catalog(total: int = 1, extra: str = "", source_id: str = "00123", version_id: str = "987") -> bytes:
    return f"""<LawSearch><totalCnt>{total}</totalCnt><law>
      <법령ID>{source_id}</법령ID><법령일련번호>{version_id}</법령일련번호>
      <법령명한글>합성 검증용 법률</법령명한글><공포일자>20250901</공포일자>
      <시행일자>2026-01-01</시행일자><공포번호>12345</공포번호>{extra}
      </law></LawSearch>""".encode()


FULL_LAW = """<?xml version="1.0" encoding="UTF-8"?>
<법령><기본정보><법령ID>00123</법령ID><법령일련번호>987</법령일련번호>
<법령명_한글>합성 검증용 법률</법령명_한글><공포일자>20250901</공포일자>
<시행일자>20260101</시행일자><공포번호>12345</공포번호></기본정보>
<조문><조문단위><조문번호>7</조문번호><조문가지번호>2</조문가지번호><조문제목>검증</조문제목>
<조문내용>제7조의2(검증) 검증의 범위는 다음과 같다.</조문내용>
<항><항번호>①</항번호><항내용>① 확인하여야 한다.</항내용>
<호><호번호>1.</호번호><호내용>1. 기록</호내용><목><목번호>가.</목번호><목내용>가. 원본 기록</목내용></목></호></항>
</조문단위><조문단위><조문번호>8</조문번호><조문제목>직접 호</조문제목>
<조문내용>제8조(직접 호) 다음 각 호.</조문내용><호><호번호>2)</호번호><호내용>2) 절차</호내용></호>
</조문단위></조문>
<부칙><부칙단위><부칙공포일자>20250901</부칙공포일자><부칙내용>이 법은 2026년 1월 1일부터 시행한다.</부칙내용></부칙단위></부칙>
<별표><별표단위><별표번호>1</별표번호><별표제목>신청서</별표제목>
<별표PDF파일링크>https://www.law.go.kr/LSW/flDownload.do?flSeq=42</별표PDF파일링크></별표단위></별표>
</법령>""".encode()


class LawSourceTests(unittest.TestCase):
    def client(self, handler, **kwargs) -> LawClient:
        client = LawClient(oc=OC, transport=httpx.MockTransport(handler), minimum_interval=0, **kwargs)
        self.addCleanup(client.close)
        return client

    @staticmethod
    def item(source: str = "law", source_id: str = "00123", version_id: str = "987") -> dict:
        return {"source": source, "source_id": source_id, "version_id": version_id,
                "title": "합성 검증용 법률", "metadata": {"version_identifier_type": "MST" if source == "law" else "ID"}}

    def assert_error(self, code: str, callback) -> LawSourceError:
        with self.assertRaises(LawSourceError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn(OC, str(caught.exception))
        return caught.exception

    def test_full_catalog_has_pagination_without_search_query_and_safe_provenance(self) -> None:
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, content=law_catalog(total=3))
        result = self.client(handler).catalog("statutes", page=2, page_size=1)
        self.assertEqual((result["source"], result["total"], result["total_pages"], result["page"]), ("law", 3, 3, 2))
        request = requests[0]
        self.assertEqual(request.url.path, "/DRF/lawSearch.do")
        self.assertEqual(dict(request.url.params), {"OC": OC, "target": "law", "type": "XML", "page": "2", "display": "1"})
        self.assertNotIn("query", request.url.params)
        item = result["items"][0]
        self.assertEqual((item["source_id"], item["version_id"]), ("00123", "987"))
        self.assertEqual(item["publication_date"], "2025-09-01")
        self.assertEqual(item["effective_date"], "2026-01-01")
        self.assertIn("MST=987", item["source_url"])
        self.assertNotIn(OC, json.dumps(result))
        self.assertFalse(item["metadata"]["provider_contract_verified"])

    def test_catalog_redacts_echoed_oc_in_metadata_links(self) -> None:
        data = law_catalog(extra=f"<법령상세링크>https://www.law.go.kr/DRF/lawService.do?OC={OC}&amp;MST=987</법령상세링크>")
        result = self.client(lambda _: httpx.Response(200, content=data)).catalog("law")
        self.assertNotIn(OC, json.dumps(result))
        self.assertNotIn("OC=", result["items"][0]["metadata"]["fields"]["법령상세링크"])

    def test_other_source_aliases_and_ordinance_law_item_shape(self) -> None:
        for source, root, node, id_tag, title_tag, canonical in [
            ("admrul", "AdmRulSearch", "admrul", "행정규칙일련번호", "행정규칙명", "administrative"),
            ("ordin", "OrdinSearch", "law", "자치법규일련번호", "자치법규명", "ordinance"),
        ]:
            with self.subTest(source=source):
                raw = f"<{root}><totalCnt>1</totalCnt><{node}><{id_tag}>12</{id_tag}><{title_tag}>합성 규정</{title_tag}></{node}></{root}>".encode()
                result = self.client(lambda _, raw=raw: httpx.Response(200, content=raw)).catalog(source)
                item = result["items"][0]
                self.assertEqual(item["source"], canonical)
                self.assertIn("ID=12", item["source_url"])
                self.assertIsNone(item["publication_date"])
                self.assertIsNone(item["effective_date"])
                self.assertIn("missing_effective_date", item["metadata"]["parse_warnings"])

    def test_empty_catalog_only_succeeds_with_declared_zero_count(self) -> None:
        result = self.client(lambda _: httpx.Response(200, content=b"<LawSearch><totalCnt>0</totalCnt></LawSearch>")).catalog("law")
        self.assertEqual(result["items"], [])
        self.assertEqual(result["total_pages"], 0)
        self.assertTrue(result["supported"])

    def test_unknown_count_incomplete_page_missing_ids_and_schema_fail(self) -> None:
        examples = [
            (b"<LawSearch/>", "unknown_total"),
            (b"<LawSearch><totalCnt>invalid</totalCnt></LawSearch>", "unknown_total"),
            (b"<LawSearch><totalCnt>1</totalCnt></LawSearch>", "incomplete_page"),
            ("<LawSearch><totalCnt>1</totalCnt><law><법령명한글>합성</법령명한글></law></LawSearch>".encode(), "missing_identity"),
            (b"<AdmRulSearch><totalCnt>0</totalCnt></AdmRulSearch>", "unexpected_schema"),
        ]
        for raw, code in examples:
            with self.subTest(code=code):
                client = self.client(lambda _, raw=raw: httpx.Response(200, content=raw))
                self.assert_error(code, lambda: client.catalog("law"))

    def test_duplicate_versions_fail_even_when_total_matches(self) -> None:
        data = law_catalog().decode()
        node = data[data.index("<law>"):data.index("</law>") + 6]
        raw = f"<LawSearch><totalCnt>2</totalCnt>{node}{node}</LawSearch>".encode()
        client = self.client(lambda _: httpx.Response(200, content=raw))
        self.assert_error("duplicate_identity", lambda: client.catalog("law"))

    def test_same_stable_id_with_distinct_versions_is_retained(self) -> None:
        nodes = []
        for sequence in ("987", "988"):
            data = law_catalog(version_id=sequence).decode()
            nodes.append(data[data.index("<law>"):data.index("</law>") + 6])
        raw = f"<LawSearch><totalCnt>2</totalCnt>{''.join(nodes)}</LawSearch>".encode()
        result = self.client(lambda _: httpx.Response(200, content=raw)).catalog("law")
        self.assertEqual([item["version_id"] for item in result["items"]], ["987", "988"])

    def test_invalid_dates_are_absent_not_guessed(self) -> None:
        raw = law_catalog().replace(b"20250901", b"20250230").replace(b"2026-01-01", b"2026")
        item = self.client(lambda _: httpx.Response(200, content=raw)).catalog("law")["items"][0]
        self.assertIsNone(item["publication_date"])
        self.assertIsNone(item["effective_date"])
        self.assertEqual(item["metadata"]["parse_warnings"], ["invalid_publication_date", "invalid_effective_date"])

    def test_json_response_retains_the_same_catalog_contract(self) -> None:
        data = {"LawSearch": {"totalCnt": 1, "law": {"법령ID": "00123", "법령일련번호": "987", "법령명한글": "합성 법률"}}}
        result = self.client(lambda _: httpx.Response(200, json=data)).catalog("law")
        self.assertEqual(result["items"][0]["version_id"], "987")

    def test_full_document_preserves_exact_raw_and_structured_units(self) -> None:
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, content=FULL_LAW)
        document = self.client(handler).fetch_full(self.item())
        self.assertEqual(document["raw"], FULL_LAW)
        self.assertEqual(document["raw_format"], "xml")
        self.assertEqual(requests[0].url.params["MST"], "987")
        provision = document["provisions"][0]
        self.assertEqual(provision["article_no"], "제7조의2")
        paragraph = provision["paragraphs"][0]
        self.assertEqual((paragraph["paragraph_no"], paragraph["original_no"]), ("1", "①"))
        self.assertEqual(paragraph["items"][0]["item_no"], "1")
        self.assertIn("가. 원본 기록", paragraph["items"][0]["text"])
        self.assertIn("① 확인하여야 한다.", provision["text"])
        direct = document["provisions"][1]["paragraphs"][0]
        self.assertIsNone(direct["paragraph_no"])
        self.assertEqual(direct["items"][0]["item_no"], "2")
        self.assertNotIn(OC, document["source_url"])
        self.assertTrue(document["metadata"]["response_identity_verified"])
        self.assertTrue(document["metadata"]["response_version_verified"])
        self.assertTrue(document["metadata"]["unit_coverage"]["paragraphs"])
        self.assertFalse(document["metadata"]["unit_coverage"]["subitems"])

    def test_supplementary_and_annex_records_are_retained_with_download_limit(self) -> None:
        document = self.client(lambda _: httpx.Response(200, content=FULL_LAW)).fetch_full(self.item())
        metadata = document["metadata"]
        self.assertEqual(len(metadata["supplementary_provisions"]), 1)
        self.assertIn("2026년", metadata["supplementary_provisions"][0]["text"])
        self.assertEqual(metadata["attachment_count"], 1)
        self.assertEqual(metadata["attachments"][0]["title"], "신청서")
        self.assertEqual(len(metadata["attachments"][0]["urls"]), 1)
        self.assertFalse(metadata["attachments"][0]["downloaded"])
        self.assertFalse(metadata["full_legal_coverage_verified"])
        self.assertIn("attachment_files_not_downloaded", metadata["parse_warnings"])

    def test_compound_law_key_is_not_confused_with_mst(self) -> None:
        raw = FULL_LAW.decode().replace("<법령>", '<법령 법령키="001232025090112345">').replace("<법령일련번호>987</법령일련번호>", "").encode()
        document = self.client(lambda _: httpx.Response(200, content=raw)).fetch_full(self.item())
        self.assertFalse(document["metadata"]["response_version_verified"])
        self.assertIn("missing_document_version", document["metadata"]["parse_warnings"])

    def test_law_sequence_without_stable_id_still_uses_mst(self) -> None:
        requests = []
        catalog = law_catalog().replace("<법령ID>00123</법령ID>".encode(), b"")
        full = FULL_LAW.replace("<법령ID>00123</법령ID>".encode(), b"")
        def handler(request):
            requests.append(request)
            return httpx.Response(200, content=catalog if request.url.path.endswith("lawSearch.do") else full)
        client = self.client(handler)
        item = client.catalog("law")["items"][0]
        self.assertEqual(item["source_id"], "987")
        client.fetch_full(item)
        self.assertEqual(requests[-1].url.params["MST"], "987")

    def test_law_with_only_stable_id_uses_id_not_mst(self) -> None:
        requests = []
        catalog = law_catalog().replace("<법령일련번호>987</법령일련번호>".encode(), b"")
        def handler(request):
            requests.append(request)
            return httpx.Response(200, content=catalog if request.url.path.endswith("lawSearch.do") else FULL_LAW)
        client = self.client(handler)
        client.fetch_full(client.catalog("law")["items"][0])
        self.assertEqual(requests[-1].url.params["ID"], "00123")
        self.assertNotIn("MST", requests[-1].url.params)

    def test_zero_padded_article_and_extended_circle_numbers(self) -> None:
        raw = FULL_LAW.decode().replace("<조문번호>7</조문번호>", "<조문번호>0007</조문번호>").replace("<항번호>①</항번호>", "<항번호>㉑</항번호>").replace("<호번호>1.</호번호>", "<호번호>(1)</호번호>").encode()
        provision = self.client(lambda _: httpx.Response(200, content=raw)).fetch_full(self.item())["provisions"][0]
        self.assertEqual(provision["article_no"], "제7조의2")
        self.assertEqual(provision["metadata"]["original_article_no"], "0007")
        self.assertEqual(provision["metadata"]["branch_no"], "2")
        self.assertEqual(provision["paragraphs"][0]["paragraph_no"], "21")
        self.assertEqual(provision["paragraphs"][0]["items"][0]["item_no"], "1")

    def test_full_identity_and_version_mismatches_cannot_be_stored(self) -> None:
        for raw, code in [(FULL_LAW.replace(b"00123", b"00124"), "identity_mismatch"),
                          (FULL_LAW.replace(b">987<", b">988<"), "version_mismatch")]:
            with self.subTest(code=code):
                client = self.client(lambda _, raw=raw: httpx.Response(200, content=raw))
                self.assert_error(code, lambda: client.fetch_full(self.item()))

    def test_full_body_with_no_identity_is_unverifiable(self) -> None:
        raw = FULL_LAW.replace("<법령ID>00123</법령ID>".encode(), b"").replace("<법령일련번호>987</법령일련번호>".encode(), b"")
        client = self.client(lambda _: httpx.Response(200, content=raw))
        self.assert_error("identity_unverifiable", lambda: client.fetch_full(self.item()))

    def test_response_with_echoed_credential_is_blocked_before_raw_persistence(self) -> None:
        raw = FULL_LAW + f"<!-- https://www.law.go.kr/service?OC={OC} -->".encode()
        client = self.client(lambda _: httpx.Response(200, content=raw))
        self.assert_error("credential_in_response", lambda: client.fetch_full(self.item()))

    def test_unstructured_administrative_text_has_article_and_coverage_warning(self) -> None:
        raw = """<행정규칙><기본정보><행정규칙일련번호>12</행정규칙일련번호><행정규칙명>합성 지침</행정규칙명></기본정보>
        <조문내용><![CDATA[제1조(목적) 합성 내용.
제2조의3(절차) ① 확인한다.]]></조문내용></행정규칙>""".encode()
        document = self.client(lambda _: httpx.Response(200, content=raw)).fetch_full(self.item("administrative", "12", "12"))
        self.assertEqual([p["article_no"] for p in document["provisions"]], ["제1조", "제2조의3"])
        self.assertFalse(document["metadata"]["unit_coverage"]["paragraphs"])
        self.assertIn("unstructured_paragraphs", document["metadata"]["parse_warnings"])
        self.assertIsNone(document["effective_date"])

    def test_xml_entities_login_and_api_errors_fail_without_leaking_bodies(self) -> None:
        fixtures = [(b'<!DOCTYPE LawSearch [<!ENTITY x "unsafe">]><LawSearch/>', "unsafe_xml"),
                    ('<!DOCTYPE LawSearch [<!ENTITY x "unsafe">]><LawSearch/>'.encode("utf-16"), "unsafe_xml"),
                    (b"<html><body>login</body></html>", "api_error"),
                    (b"<Error><message>unsupported target</message></Error>", "unsupported_source"),
                    (b"broken XML", "invalid_response")]
        for raw, code in fixtures:
            with self.subTest(code=code):
                client = self.client(lambda _, raw=raw: httpx.Response(200, content=raw))
                self.assert_error(code, lambda: client.catalog("law"))

    def test_403_is_not_retried_or_mislabeled_missing_credentials(self) -> None:
        attempts = []
        def handler(request):
            attempts.append(request)
            return httpx.Response(403, text=f"proxy denied https://law.go.kr?OC={OC}")
        error = self.assert_error("access_denied", lambda: self.client(handler).catalog("law"))
        self.assertEqual(error.status_code, 403)
        self.assertFalse(error.retriable)
        self.assertEqual(len(attempts), 1)

    def test_transient_failure_has_bounded_retries_and_retry_after(self) -> None:
        attempts = []
        def handler(request):
            attempts.append(request)
            return httpx.Response(429, headers={"Retry-After": "9999"}) if len(attempts) == 1 else httpx.Response(200, content=law_catalog())
        with patch("rulecraft.law_sources.time.sleep") as sleep:
            result = self.client(handler, retries=1).catalog("law")
        self.assertEqual(result["total"], 1)
        self.assertEqual(len(attempts), 2)
        sleep.assert_called_once_with(5.0)

    def test_network_errors_do_not_expose_httpx_exception_url(self) -> None:
        def handler(request):
            raise httpx.ConnectError(f"connection failed {request.url}", request=request)
        error = self.assert_error("network_error", lambda: self.client(handler, retries=0).catalog("law"))
        self.assertTrue(error.retriable)
        self.assertNotIn("https://", str(error))

    def test_streamed_response_size_is_bounded(self) -> None:
        client = self.client(lambda _: httpx.Response(200, content=law_catalog()))
        with patch("rulecraft.law_sources.MAX_RESPONSE_BYTES", 64):
            self.assert_error("response_too_large", lambda: client.catalog("law"))

    def test_environment_binding_is_used_without_outbound_when_missing(self) -> None:
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": ""}, clear=False):
            client = LawClient(transport=httpx.MockTransport(lambda _: self.fail("must not send")))
            self.addCleanup(client.close)
            self.assertFalse(client.configured)
            self.assert_error("missing_credentials", lambda: client.catalog("law"))

    def test_unsafe_base_configuration_and_pagination_fail_early(self) -> None:
        for base in ["http://www.law.go.kr/DRF", "https://user:pass@www.law.go.kr/DRF", "https://www.law.go.kr/DRF?OC=secret", "https://www.law.go.kr/DRF#fragment"]:
            with self.subTest(base=base):
                self.assert_error("invalid_configuration", lambda: LawClient(oc=OC, base_url=base))
        client = self.client(lambda _: self.fail("must not send"))
        for page, size in [(0, 100), (True, 1), (1, 101), (1, 0), (1, True)]:
            self.assert_error("invalid_pagination", lambda: client.catalog("law", page=page, page_size=size))
        self.assert_error("unsupported_source", lambda: client.catalog("unknown"))

    def test_tls_verification_and_environment_proxy_trust_are_preserved(self) -> None:
        with patch("rulecraft.law_sources.httpx.Client") as constructor:
            client = LawClient(oc=OC)
        self.assertTrue(constructor.call_args.kwargs["verify"])
        self.assertTrue(constructor.call_args.kwargs["trust_env"])
        self.assertFalse(constructor.call_args.kwargs["follow_redirects"])
        client.close()


if __name__ == "__main__":
    unittest.main()
