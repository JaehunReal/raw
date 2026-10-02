"""Verify public preview and read-only official data UI without screenshots.

Build the public frontend first, then run with the Playwright interpreter:
    python tests/browser_public_preview_smoke.py
An optional --login-dist checks a second build with VITE_PUBLIC_PREVIEW=false
and VITE_REQUIRE_LOGIN=true. Only temporary loopback static servers are started.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")
TABS = (
    "워크스페이스", "규정 예제 저장소", "규정 관계 그래프", "변경 영향 예제",
    "문서 패키지 예제", "공식 법령 현황", "MCP 검증 기록",
)


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, official_fixture=None, **kwargs):
        self.official_fixture = official_fixture
        super().__init__(*args, **kwargs)

    def log_message(self, *args) -> None:
        pass

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        address = urlparse(self.path)
        fixture = self.official_fixture
        if fixture is not None and address.path.startswith("/api/official/"):
            fixture["requests"].append(address.path)
            state = fixture["state"]
            if address.path == "/api/official/status":
                if state == "connected":
                    empty = fixture.get("empty", False)
                    totals = {"stored_documents": 0 if empty else 2, "stored_versions": 0 if empty else 3,
                              "last_stored_at": None if empty else "2026-10-02T00:00:00Z"}
                    sources = [{"source": source, "stored_documents": 0 if empty or source == "ordinance" else 1,
                                "stored_versions": 0 if empty or source == "ordinance" else (2 if source == "law" else 1)}
                               for source in ("law", "administrative", "ordinance")]
                    self.send_json({"storage": "postgresql", "connection": "connected",
                                    "checked_at": "2026-10-02T01:00:00Z", "totals": totals, "sources": sources})
                else:
                    self.send_json({"storage": "postgresql", "connection": state}, 503)
                return
            if address.path == "/api/official/laws":
                if fixture.get("fail_list_once"):
                    fixture["fail_list_once"] = False
                    self.send_json({"code": "database_unavailable"}, 503)
                    return
                params = parse_qs(address.query)
                items = [] if fixture.get("empty") else fixture["items"]
                query = params.get("q", [""])[0]
                source = params.get("source", [""])[0]
                items = [item for item in items if (not source or item["source"] == source)
                         and (not query or query in item["title"])]
                offset = int(params.get("offset", ["0"])[0])
                self.send_json({"items": items[offset:offset + 2], "total": len(items), "limit": 2, "offset": offset})
                return
            if address.path == "/api/official/document":
                if fixture.get("fail_document_once"):
                    fixture["fail_document_once"] = False
                    self.send_json({"code": "document_not_found"}, 404)
                    return
                params = parse_qs(address.query)
                item = next((item for item in fixture["items"] if all(
                    item[key] == params.get(key, [""])[0] for key in ("source", "law_id", "version_id"))), None)
                if item is not None:
                    self.send_json({"document": {**item, "raw_text": fixture["raw_text"]}})
                else:
                    self.send_json({"code": "document_not_found"}, 404)
                return
            self.send_json({"code": "not_found"}, 404)
            return
        if urlparse(self.path).path == "/api/official/status":
            payload = json.dumps({"storage": "postgresql", "connection": "not_configured",
                                  "code": "database_not_configured", "checked_at": "2026-10-02T00:00:00Z"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if urlparse(self.path).path.startswith("/api/"):
            payload = json.dumps({"detail": "Authentication required"}).encode()
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


@contextmanager
def static_server(directory: Path, official_fixture=None):
    if not (directory / "index.html").is_file():
        raise RuntimeError(f"Missing frontend build: {directory}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(
        StaticHandler, directory=str(directory), official_fixture=official_fixture))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive(), "Owned static server did not stop."


def navigate(page, label: str) -> None:
    page.locator("nav").get_by_role("button", name=label, exact=True).click()


def no_overflow(page, label: str) -> None:
    widths = page.evaluate("({document:document.documentElement.scrollWidth, viewport:window.innerWidth})")
    assert widths["document"] <= widths["viewport"] + 1, f"{label}: horizontal overflow {widths}"


def monitor(page, base: str) -> dict:
    evidence = {"runtime_errors": [], "console_errors": [], "failed_requests": [],
                "api_requests": [], "external_requests": []}
    page.on("pageerror", lambda error: evidence["runtime_errors"].append(str(error)))
    page.on("console", lambda message: evidence["console_errors"].append(message.text)
            if message.type == "error" else None)
    page.on("requestfailed", lambda request: evidence["failed_requests"].append(request.url))

    def requested(request) -> None:
        address = urlparse(request.url)
        if address.scheme in ("data", "blob"):
            return
        if address.netloc != urlparse(base).netloc:
            evidence["external_requests"].append(request.url)
        if address.path.startswith("/api/"):
            evidence["api_requests"].append({"path": address.path, "method": request.method})

    page.on("request", requested)
    return evidence


def assert_clean(evidence: dict) -> None:
    for key, failures in evidence.items():
        if key == "api_requests":
            assert all(item["method"] == "GET" and item["path"] in (
                "/api/official/status", "/api/official/laws", "/api/official/document")
                       for item in failures), f"Unexpected public API requests: {failures}"
            continue
        assert failures == [], f"Public preview {key}: {failures}"


def verify_preview(browser, base: str, snapshot: dict) -> dict:
    nodes = snapshot["graph"]["nodes"]
    edges = snapshot["graph"]["edges"]
    documents = snapshot["package_example"]["documents"]
    assert len(nodes) == 12 and len(edges) == 31 and len(documents) == 7
    assert snapshot["graph"]["issues"] == []
    for node in nodes:
        source = ROOT / "legal-knowledge-vault" / node["path"]
        assert node["markdown"] == source.read_text(encoding="utf-8"), node["id"]
        assert node["metadata"]["demo"] is True

    context = browser.new_context(viewport={"width": 1440, "height": 1100})
    page = context.new_page()
    requests = monitor(page, base)
    page.goto(base, wait_until="networkidle")
    expect(page.get_by_test_id("public-preview")).to_be_visible()
    expect(page.get_by_test_id("preview-notice")).to_contain_text("공개")
    expect(page.get_by_test_id("preview-notice")).to_contain_text("예제")
    expect(page.get_by_test_id("preview-node-count")).to_contain_text("12")
    expect(page.get_by_test_id("preview-edge-count")).to_contain_text("31")
    expect(page.get_by_test_id("preview-official-count")).to_contain_text("미확인")
    expect(page.locator("nav").get_by_role("button")).to_have_count(len(TABS))

    navigate(page, "규정 예제 저장소")
    search = page.get_by_test_id("preview-vault-search")
    search.fill("데이터의 반출 허가")
    expect(page.locator('[data-testid^="preview-vault-row-"]')).to_have_count(1)
    page.get_by_test_id("preview-vault-row-KIPA-RULE-DAT-007").click()
    expect(page.get_by_test_id("preview-reader")).to_contain_text("데이터의 반출 허가")
    search.fill("")
    expect(page.locator('[data-testid^="preview-vault-row-"]')).to_have_count(12)
    for node in nodes:
        page.get_by_test_id(f"preview-vault-row-{node['id']}").click()
        reader = page.get_by_test_id("preview-reader")
        expect(reader).to_contain_text(node["title"])
        assert reader.locator("pre").text_content() == node["body"], node["id"]
        reader.get_by_role("button", name="Markdown 원본", exact=True).click()
        assert reader.locator("pre").text_content() == node["markdown"], node["id"]

    navigate(page, "규정 관계 그래프")
    diagram = page.get_by_test_id("preview-graph")
    expect(diagram).to_be_visible()
    expect(page.get_by_test_id("preview-edge")).to_have_count(31)
    page.locator(".preview-all-relations summary").click()
    titles = {node["id"]: node["title"] for node in nodes}
    for index, edge in enumerate(edges):
        row = page.get_by_test_id("preview-edge").nth(index)
        expect(row.locator("span").nth(0)).to_have_text(titles[edge["source"]])
        expect(row.locator("small")).to_have_text(edge["type"])
        expect(row.locator("span").nth(1)).to_have_text(titles[edge["target"]])
    expect(diagram.get_by_role("button")).to_have_count(12)
    for index, node in enumerate(nodes):
        diagram.get_by_role("button").nth(index).click()
        expect(page.locator(".preview-graph-detail h2")).to_have_text(node["title"])
    navigate(page, "변경 영향 예제")
    page.get_by_test_id("preview-impact-target").select_option("LAW-PRIV-015")
    expect(page.get_by_test_id("preview-impact-results").get_by_role("button")).to_have_count(7)

    navigate(page, "문서 패키지 예제")
    for index, document in enumerate(documents):
        page.get_by_test_id(f"preview-package-doc-{index}").click()
        reader = page.get_by_test_id("preview-package-reader")
        expect(reader).to_contain_text(document["name"].split("_", 1)[1].removesuffix(".md"))
        assert reader.locator("pre").text_content() == document["content"], document["name"]

    navigate(page, "공식 법령 현황")
    status = page.get_by_test_id("preview-law-status")
    expect(page.get_by_test_id("official-connection")).to_have_text("데이터 저장소 연결 대기")
    expect(page.get_by_test_id("official-total-documents")).to_have_text("미확인")
    expect(page.get_by_test_id("official-total-versions")).to_have_text("미확인")
    expect(page.get_by_test_id("official-storage-status")).to_contain_text("0건이라는 뜻이 아닙니다")
    expect(page.get_by_test_id("official-search")).to_have_count(0)
    expect(status).to_contain_text("과거 연결 검증 기록")
    expect(status).to_contain_text("샘플은 저장하지 않았습니다")
    expect(status).to_contain_text("실시간 상태 아님")
    provider = snapshot["verification"].get("provider") or {}
    recorded_sources = {record["source"]: record for record in provider.get("sources", [])}
    source_ids = ("law", "administrative", "ordinance")
    catalogue_count = sum(bool(recorded_sources.get(source, {}).get("catalogue_verified"))
                          for source in source_ids)
    full_count = sum(bool(recorded_sources.get(source, {}).get("full_document_verified"))
                    for source in source_ids)
    expect(status).to_contain_text(f"목록 {catalogue_count}종, 전문 샘플 {full_count}종")
    displayed_sources = []
    for source in source_ids:
        source_card = page.get_by_test_id(f"preview-law-source-{source}")
        result = page.get_by_test_id(f"preview-law-result-{source}")
        catalogue = page.get_by_test_id(f"preview-law-catalogue-{source}")
        expect(source_card).to_contain_text("과거 표본 검증")
        record = recorded_sources.get(source)
        if record is None:
            expect(result).to_have_text("검증 기록 없음")
            expect(catalogue).to_contain_text("목록 미확인")
            displayed_sources.append({"source": source, "recorded": False})
            continue
        catalogue_verified = bool(record.get("catalogue_verified"))
        full_verified = bool(record.get("full_document_verified"))
        if catalogue_verified:
            expect(result).to_contain_text("목록 확인")
            total = record.get("catalogue_total")
            expect(catalogue).to_contain_text(f"목록 총 {total:,}건" if total is not None
                                             else "목록 총 미확인건")
            expect(catalogue).to_contain_text(f"샘플 {record.get('catalogue_sample_count', 0)}건")
        else:
            expect(result).to_contain_text("목록 미확인")
            expect(catalogue).to_contain_text("당시 목록 미확인")
        sample = page.get_by_test_id(f"preview-law-sample-{source}")
        identity = page.get_by_test_id(f"preview-law-identity-{source}")
        if full_verified:
            expect(result).to_contain_text("전문 샘플 확인")
            expect(result).not_to_contain_text("HTTP")
            expect(sample).to_contain_text(record.get("sample_title") or "제목 미기록")
            articles = record.get("article_count")
            expect(sample).to_contain_text(f"조문 {articles:,}개" if articles is not None
                                          else "조문 미확인개")
            identity_status = "확인" if record.get("response_identity_verified") else "미확인"
            version_status = "확인" if record.get("response_version_verified") else "미확인"
            expect(identity).to_have_text(f"응답 식별자 {identity_status} · 요청 버전 {version_status}")
            warning_codes = source_card.locator("[data-warning-code]").evaluate_all(
                "elements => elements.map(element => element.dataset.warningCode)")
            assert warning_codes == record.get("parse_warnings", []), source
        else:
            expect(sample).to_have_count(0)
            expect(identity).to_have_count(0)
            if catalogue_verified:
                expect(result).to_contain_text("전문 미확인")
            error = record.get("error") or {}
            if error.get("status_code"):
                expect(result).to_contain_text(f"HTTP {error['status_code']}")
            elif error:
                expect(result).to_contain_text("오류")
                expect(result).not_to_contain_text("HTTP")
            if error.get("code"):
                expect(result).to_contain_text(error["code"])
        displayed_sources.append({key: record[key] for key in (
            "source", "catalogue_verified", "catalogue_total", "catalogue_sample_count",
            "full_document_verified", "sample_title", "article_count", "response_identity_verified",
            "response_version_verified", "parse_warnings", "error") if key in record})
    navigate(page, "MCP 검증 기록")
    mcp = page.get_by_test_id("preview-mcp-record")
    expect(mcp).to_contain_text("4")
    expect(mcp).to_contain_text("3")
    expect(mcp).to_contain_text("기록")
    expect(mcp).to_contain_text("stdio")
    expect(page.locator(".preview-tool-cards > button")).to_have_count(4)
    for index in range(4):
        page.locator(".preview-tool-cards > button").nth(index).click()
        assert isinstance(json.loads(page.locator(".preview-tool-reader pre").text_content()), dict)
    for tab in TABS:
        navigate(page, tab)
        assert not page.locator("body").inner_text().lower().count("mac mini")
        assert "맥미니" not in page.locator("body").inner_text()
        assert "백엔드" not in page.locator("body").inner_text()
        no_overflow(page, f"desktop {tab}")
    assert_clean(requests)
    context.close()

    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile_page = mobile.new_page()
    mobile_requests = monitor(mobile_page, base)
    mobile_page.goto(base, wait_until="networkidle")
    expect(mobile_page.get_by_test_id("public-preview")).to_be_visible()
    for tab in TABS:
        navigate(mobile_page, tab)
        no_overflow(mobile_page, f"mobile {tab}")
    navigate(mobile_page, "규정 예제 저장소")
    mobile_page.get_by_test_id("preview-vault-row-KIPA-RULE-DAT-007").click()
    expect(mobile_page.get_by_test_id("preview-reader")).to_contain_text("데이터의 반출 허가")
    no_overflow(mobile_page, "mobile document reader")
    navigate(mobile_page, "문서 패키지 예제")
    mobile_page.get_by_test_id("preview-package-doc-1").click()
    expect(mobile_page.get_by_test_id("preview-package-reader")).to_contain_text(
        documents[1]["name"].split("_", 1)[1].removesuffix(".md"))
    no_overflow(mobile_page, "mobile package reader")
    assert_clean(mobile_requests)
    mobile.close()
    return {"mode": "public_read_only_demo", "tabs_verified": list(TABS),
            "source_documents_verified": len(nodes), "relations_verified": len(edges),
            "package_documents_verified": len(documents), "source_markdown_matches_tracked_demo": True,
            "official_documents": None, "official_connection": "not_configured",
            "provider_sources_displayed": displayed_sources,
            "provider_recorded_at": provider.get("checked_at"),
            "provider_verification_does_not_claim_storage_or_full_coverage": True,
            "past_mcp_tools_displayed": 4, "past_mcp_nodes_displayed": 3,
            "mobile_width": 390, "mobile_overflow": False, "runtime_errors": 0,
            "console_errors": 0, "failed_requests": 0,
            "api_requests": len(requests["api_requests"]) + len(mobile_requests["api_requests"]),
            "public_api_methods": ["GET"], "external_requests": 0}


def verify_login(browser, directory: Path) -> dict:
    with static_server(directory) as base:
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        failures = []
        session_requests = []
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.on("request", lambda request: session_requests.append(request.method)
                if urlparse(request.url).path == "/api/session" else None)
        page.goto(base, wait_until="networkidle")
        expect(page.get_by_role("heading", name="워크스페이스에 로그인")).to_be_visible()
        expect(page.get_by_label("워크스페이스 비밀번호")).to_be_visible()
        expect(page.get_by_role("button", name="로그인", exact=True)).to_be_disabled()
        expect(page.get_by_test_id("public-preview")).to_have_count(0)
        assert session_requests == ["GET"], f"Unexpected login requests: {session_requests}"
        no_overflow(page, "production login")
        assert failures == [], f"Production login runtime errors: {failures}"
        context.close()
    return {"login_gate_preserved": True, "anonymous_session_http_status": 401,
            "public_preview_not_rendered": True, "mobile_overflow": False}


def official_fixture(state="connected", **overrides):
    common = {"effective_date": "2026-10-01", "publication_date": "2026-09-01",
              "raw_sha256": "a" * 64, "stored_at": "2026-10-02T00:00:00Z"}
    fixture = {"state": state, "requests": [],
               "raw_text": '<script>window.rulecraftUnexpected = true</script>\n제1조(목적) 저장 원문 검증용 본문.',
               "items": [
                   {**common, "source": "law", "law_id": "100", "version_id": "v1",
                    "title": "검증 법령", "source_url": "https://www.law.go.kr/법령/검증법령"},
                   {**common, "source": "law", "law_id": "100", "version_id": "v2",
                    "title": "검증 법령 <script>window.rulecraftUnexpected = true</script>",
                    "source_url": "javascript:alert(1)"},
                   {**common, "source": "administrative", "law_id": "200", "version_id": "a1",
                    "title": "검증 행정규칙", "source_url": "https://untrusted.example.invalid/document"},
               ]}
    fixture.update(overrides)
    return fixture


def verify_official_data_ui(browser, directory: Path) -> dict:
    fixture = official_fixture()
    with static_server(directory, fixture) as base:
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        requests = monitor(page, base)
        page.goto(base, wait_until="networkidle")
        expect(page.get_by_test_id("preview-official-count")).to_have_text("2")
        navigate(page, "공식 법령 현황")
        expect(page.get_by_test_id("official-connection")).to_have_text("PostgreSQL 연결됨")
        expect(page.get_by_test_id("official-total-documents")).to_have_text("2건")
        expect(page.get_by_test_id("official-total-versions")).to_have_text("3개")
        expect(page.get_by_test_id("official-source-law")).to_contain_text("1건 · 2개 버전")
        expect(page.get_by_test_id("official-source-ordinance")).to_contain_text("0건 · 0개 버전")
        expect(page.get_by_test_id("official-checked-at")).to_contain_text("한국 시간")
        expect(page.get_by_test_id("official-last-stored")).to_contain_text("최근 원문 저장")
        expect(page.get_by_test_id("official-last-stored")).not_to_contain_text("미확인")
        rows = page.get_by_test_id("official-law-row")
        expect(rows).to_have_count(2)
        rows.nth(0).click()
        expect(page.get_by_test_id("official-raw-text")).to_have_text(fixture["raw_text"])
        reader = page.get_by_test_id("official-document-reader")
        expect(reader).to_contain_text("a" * 64)
        expect(reader).to_contain_text("v1")
        expect(reader.get_by_role("link", name="국가법령정보센터 출처")).to_have_attribute(
            "href", "https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EA%B2%80%EC%A6%9D%EB%B2%95%EB%A0%B9")
        assert page.evaluate("window.rulecraftUnexpected") is None
        rows.nth(1).click()
        expect(reader).to_contain_text("v2")
        expect(reader.get_by_role("link")).to_have_count(0)
        assert page.evaluate("window.rulecraftUnexpected") is None
        page.get_by_role("button", name="다음", exact=True).click()
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text("검증 행정규칙")
        rows.click()
        expect(reader).to_contain_text("a1")
        expect(reader.get_by_role("link")).to_have_count(0)
        page.get_by_role("button", name="이전", exact=True).click()
        expect(rows).to_have_count(2)
        search = page.get_by_test_id("official-search")
        count_before_typing = len(fixture["requests"])
        search.fill("일치하지않음")
        assert len(fixture["requests"]) == count_before_typing, "Typing must not flood the data service."
        page.locator(".official-search-form").get_by_role("button", name="검색", exact=True).click()
        expect(rows).to_have_count(0)
        expect(page.get_by_test_id("official-list-results")).to_contain_text("조건에 맞는 저장 원문이 없습니다")
        search.fill("")
        page.get_by_label("자료 유형", exact=True).select_option("administrative")
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text("검증 행정규칙")
        page.get_by_label("자료 유형", exact=True).select_option("ordinance")
        expect(rows).to_have_count(0)
        expect(page.get_by_test_id("official-total-documents")).to_have_text("2건")
        assert_clean(requests)
        context.close()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        mobile_page = mobile.new_page()
        mobile_page.goto(base, wait_until="networkidle")
        navigate(mobile_page, "공식 법령 현황")
        mobile_page.get_by_test_id("official-law-row").nth(1).click()
        expect(mobile_page.get_by_test_id("official-raw-text")).to_have_text(fixture["raw_text"])
        no_overflow(mobile_page, "mobile official document/hash")
        mobile.close()

    empty = official_fixture(empty=True)
    with static_server(directory, empty) as base:
        context = browser.new_context()
        page = context.new_page()
        page.goto(base, wait_until="networkidle")
        expect(page.get_by_test_id("preview-official-count")).to_have_text("0")
        navigate(page, "공식 법령 현황")
        expect(page.get_by_test_id("official-connection")).to_have_text("PostgreSQL 연결됨")
        expect(page.get_by_test_id("official-total-documents")).to_have_text("0건")
        expect(page.get_by_test_id("official-list-results")).to_contain_text("공식 원문이 아직 없습니다")
        context.close()

    for state, label in (("unavailable", "데이터 저장소 응답 확인 필요"),
                         ("incompatible_schema", "저장 데이터 구조 확인 필요")):
        broken = official_fixture(state)
        with static_server(directory, broken) as base:
            context = browser.new_context()
            page = context.new_page()
            runtime = []
            page.on("pageerror", lambda error: runtime.append(str(error)))
            page.goto(base, wait_until="networkidle")
            expect(page.get_by_test_id("preview-official-count")).to_have_text("미확인")
            navigate(page, "공식 법령 현황")
            expect(page.get_by_test_id("official-connection")).to_have_text(label)
            expect(page.get_by_test_id("official-total-documents")).to_have_text("미확인")
            expect(page.get_by_test_id("official-search")).to_have_count(0)
            broken["state"] = "connected"
            page.get_by_role("button", name="다시 확인", exact=True).click()
            expect(page.get_by_test_id("official-connection")).to_have_text("PostgreSQL 연결됨")
            expect(page.get_by_test_id("official-law-row")).to_have_count(2)
            assert runtime == []
            context.close()

    failures = official_fixture(fail_list_once=True, fail_document_once=True)
    with static_server(directory, failures) as base:
        context = browser.new_context()
        page = context.new_page()
        runtime = []
        page.on("pageerror", lambda error: runtime.append(str(error)))
        page.goto(base, wait_until="networkidle")
        navigate(page, "공식 법령 현황")
        expect(page.get_by_test_id("official-list-results")).to_contain_text("불러오지 못했습니다")
        page.get_by_role("button", name="목록 다시 불러오기").click()
        expect(page.get_by_test_id("official-law-row")).to_have_count(2)
        page.get_by_test_id("official-law-row").nth(0).click()
        expect(page.get_by_test_id("official-document-reader")).to_contain_text("불러오지 못했습니다")
        page.get_by_role("button", name="원문 다시 불러오기").click()
        expect(page.get_by_test_id("official-raw-text")).to_have_text(failures["raw_text"])
        assert runtime == []
        context.close()
    return {"fixture_http_api": True, "live_database_verified": False, "connected_counts": True,
            "confirmed_empty_database_zero": True, "unknown_counts_on_connection_failure": True,
            "search_source_filter_pagination": True, "version_hash_source_raw_text_reader": True,
            "untrusted_source_urls_blocked": True, "raw_text_html_escaped": True,
            "manual_retry_after_status_list_document_errors": True, "mobile_width": 390,
            "public_api_methods": ["GET"], "screenshots_created": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "frontend/dist")
    parser.add_argument("--login-dist", type=Path)
    parser.add_argument("--evidence", type=Path, default=ROOT / ".rulecraft/public-preview-evidence.json")
    args = parser.parse_args()
    snapshot = json.loads((ROOT / "frontend/src/preview-snapshot.json").read_text(encoding="utf-8"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
        try:
            with static_server(args.dist) as base:
                evidence = verify_preview(browser, base, snapshot)
            evidence["official_data_ui"] = verify_official_data_ui(browser, args.dist)
            if args.login_dist is not None:
                evidence["production_login"] = verify_login(browser, args.login_dist)
        finally:
            browser.close()
    evidence.update({"checked_at": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
                     "test_environment": "temporary local static build; no hosted publication",
                     "backend_started": False, "official_api_contacted": False,
                     "screenshots_created": False, "owned_servers_stopped": True})
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
