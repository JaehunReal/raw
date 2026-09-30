"""Check the live official-law UI against its real API responses.

Run with the installed Playwright interpreter and a running workspace:
    python tests/browser_laws_smoke.py
Separate, synthetic browser state coverage (not provider ingestion evidence):
    python tests/browser_laws_smoke.py --ui-fixtures

This smoke test expects the current empty, incomplete official corpus. It does
not fabricate official documents or call the external synchronization endpoint.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE = os.getenv("RULECRAFT_BROWSER_URL", "http://127.0.0.1:5173").rstrip("/")
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")
ARTIFACTS = Path(os.getenv("RULECRAFT_LAWS_ARTIFACTS", str(ROOT / ".rulecraft" / "demo")))
VAULT = Path(os.getenv("RULECRAFT_VAULT", str(ROOT / "legal-knowledge-vault")))
AS_OF = os.getenv("RULECRAFT_LAWS_AS_OF", date.today().isoformat())
SOURCES = ("law", "administrative", "ordinance")


def source_snapshot() -> dict[str, str]:
    return {
        path.relative_to(VAULT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(VAULT.rglob("*.md"))
    }


def api_get(path: str) -> dict:
    with urlopen(f"{BASE}/api{path}", timeout=15) as response:
        assert response.status == 200, f"GET {path}: HTTP {response.status}"
        return json.load(response)


def is_law_list(response) -> bool:
    return (
        urlparse(response.url).path == "/api/laws"
        and response.request.method == "GET"
    )


def assert_empty_list(response) -> dict:
    assert response.status == 200, f"Official list: HTTP {response.status}"
    result = response.json()
    assert result["total"] == 0 and result["items"] == [], result
    return result


def assert_empty_coverage(status: dict) -> dict:
    coverage = status["coverage"]
    assert coverage["complete"] is False, "An empty corpus must not be marked complete"
    assert coverage["historical_complete"] is False
    assert coverage["annexes_verified"] is False
    assert coverage["limitations"], "Incomplete evidence must retain its coverage limitations"
    assert set(SOURCES).issubset(coverage["sources"]), coverage
    for source in SOURCES:
        state = coverage["sources"][source]
        assert state["collected"] == 0 and state["snapshot_collected"] == 0, state
        assert state["complete"] is False, state
    if not status["configured"]:
        assert "RULECRAFT_LAW_OC" in status["missing_requirements"]
    return coverage


def no_document_overflow(page, label: str) -> None:
    widths = page.evaluate("({document:document.documentElement.scrollWidth, viewport:window.innerWidth})")
    assert widths["document"] <= widths["viewport"] + 1, f"{label}: horizontal overflow {widths}"


def verify_demo_labels(page, graph: dict) -> int:
    demos = [node for node in graph["nodes"] if node["status"] == "demo"]
    assert demos, "This onboarding regression needs the real demo vault"
    page.locator("nav").get_by_role("button", name="규정 지식 저장소", exact=True).click()
    expect(page.get_by_role("columnheader", name="자료 기준일", exact=True)).to_be_visible()
    labels = page.locator('.status-label[data-status="demo"]')
    expect(labels).to_have_count(len(demos))
    expect(labels).to_have_text(["시연"] * len(demos))
    for label in labels.all():
        expect(label.locator("xpath=ancestor::tr").locator(".document-date-kind")).to_have_text("예제 작성일")
    print(f"PASS demo authority labels: {len(demos)} rows show 시연 and 예제 작성일")
    return len(demos)


def verify_official_state(page, status: dict) -> None:
    coverage = assert_empty_coverage(status)
    panel = page.get_by_test_id("laws-panel")
    expect(panel).to_be_visible()
    expect(page.get_by_test_id("laws-status")).to_have_attribute("data-complete", "false")
    expect(page.get_by_test_id("laws-status")).to_have_attribute("data-status", re.compile(r"^(blocked|incomplete)$"))
    expect(page.get_by_test_id("laws-completion-badge")).to_have_text("전체 반영 미완료")
    expect(page.get_by_test_id("laws-count")).to_have_text("공식 전문 0건 수집")
    expect(page.get_by_test_id("laws-empty")).to_contain_text("수집한 공식 원문이 없습니다.")
    expect(page.get_by_test_id("laws-empty")).to_contain_text("시연 자료는 공식 수집 건수에 포함하지 않습니다.")
    expect(page.get_by_test_id("laws-changes-empty")).to_have_text("수집한 원문 변경이 없습니다. 수집하지 않은 법령의 변경 여부를 뜻하지 않습니다.")
    expect(panel.locator(".laws-record-list > button")).to_have_count(0)
    expect(page.get_by_test_id("laws-full-text")).to_have_count(0)
    for source in SOURCES:
        expect(page.get_by_test_id(f"laws-source-{source}-collected")).to_have_text("0")
        if not coverage["sources"][source].get("last_synced_at"):
            expect(page.get_by_test_id(f"laws-source-{source}")).to_contain_text("마지막 수집: 기록 없음")
        if coverage["sources"][source]["expected"] is None:
            expect(page.get_by_test_id(f"laws-source-{source}-expected")).to_have_text("대상 수 미확인")
            assert page.get_by_test_id(f"laws-source-{source}").get_by_role("progressbar").get_attribute("aria-valuenow") is None
    if not status["configured"]:
        expect(page.get_by_test_id("laws-requirements")).to_contain_text("RULECRAFT_LAW_OC")
        expect(page.get_by_test_id("laws-sync")).to_be_disabled()


def open_official_panel(page) -> dict:
    with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/status") as status_info, page.expect_response(is_law_list) as list_info, page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/changes") as changes_info:
        page.locator("nav").get_by_role("button", name="공식 법령", exact=True).click()
    assert status_info.value.status == 200
    assert_empty_list(list_info.value)
    assert_empty_list(changes_info.value)
    status = status_info.value.json()
    verify_official_state(page, status)
    return status


def record_list_response(response, expected: dict[str, str], requests: list[dict]) -> None:
    assert_empty_list(response)
    parameters = parse_qs(urlparse(response.url).query, keep_blank_values=True)
    for key, value in expected.items():
        assert parameters.get(key) == [value], (key, parameters)
    if "source" not in expected:
        assert "source" not in parameters, "Empty source must be omitted, rather than sent as an invalid enum"
    requests.append({key: values[0] for key, values in parameters.items()})


def verify_search_filters(page, status: dict, requests: list[dict]) -> None:
    page.get_by_label("공식 법령 검색", exact=True).fill("개인정보")
    with page.expect_response(is_law_list) as info:
        page.locator(".laws-search-toolbar").get_by_role("button", name="검색", exact=True).click()
    record_list_response(info.value, {"q": "개인정보", "limit": "20", "offset": "0"}, requests)

    with page.expect_response(is_law_list) as info:
        page.get_by_label("법령 조회 기준일", exact=True).fill(AS_OF)
    record_list_response(info.value, {"q": "개인정보", "as_of": AS_OF}, requests)
    for source in SOURCES:
        with page.expect_response(is_law_list) as info:
            page.get_by_label("공식 법령 분류", exact=True).select_option(source)
        record_list_response(info.value, {"q": "개인정보", "source": source, "as_of": AS_OF}, requests)
        verify_official_state(page, status)
    with page.expect_response(is_law_list) as info:
        page.get_by_label("공식 법령 분류", exact=True).select_option("")
    record_list_response(info.value, {"q": "개인정보", "as_of": AS_OF}, requests)
    expect(page.locator(".laws-as-of-note")).to_contain_text("수집하지 않은 과거 법령의 존재 여부나 내용을 추정하지 않습니다.")
    print("PASS live official search: query, as-of date, all three source filters and all-source reset return zero")


def verify_mcp_regression(page) -> dict:
    page.locator("nav").get_by_role("button", name="MCP 도구", exact=True).click()
    expect(page.get_by_test_id("mcp-connection")).to_contain_text("4개 도구", timeout=15000)
    expect(page.locator(".mcp-tool-card")).to_have_count(4)
    page.get_by_test_id("mcp-tool-query_markdown_graph").click()
    with page.expect_response(lambda response: urlparse(response.url).path == "/api/mcp/call" and response.request.method == "POST", timeout=35000) as info:
        page.get_by_test_id("mcp-run").click()
    assert info.value.status == 200
    result = info.value.json()
    assert not result["is_error"] and result["transport"] == "stdio"
    assert result["server"]["name"] == "RuleCraft"
    node_ids = sorted(node["id"] for node in result["result"]["nodes"])
    assert node_ids == ["KIPA-RULE-DAT-007", "LAW-DATA-012", "LAW-PRIV-015"], node_ids
    expect(page.get_by_test_id("mcp-result").locator(".mcp-node-list > button")).to_have_count(3)
    print("PASS MCP regression: four registered tools and actual stdio graph result")
    return {"tool_count": 4, "transport": result["transport"], "graph_node_ids": node_ids}


def main() -> None:
    before = source_snapshot()
    assert before, f"No source Markdown found in {VAULT}"
    assert api_get("/health")["status"] == "ok"
    graph = api_get("/graph")
    initial_status = api_get("/laws/status")
    assert_empty_coverage(initial_status)
    initial_list = api_get("/laws")
    assert initial_list["total"] == 0 and initial_list["items"] == []
    initial_changes = api_get("/laws/changes")
    assert initial_changes["total"] == 0 and initial_changes["items"] == []
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    unexpected_sync: list[str] = []
    requests: list[dict] = []

    def prevent_sync(route) -> None:
        if route.request.method == "POST":
            unexpected_sync.append(urlparse(route.request.url).path)
            route.abort("blockedbyclient")
        else:
            route.continue_()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
            desktop = browser.new_context(viewport={"width": 1540, "height": 1200})
            desktop.route("**/api/laws/sync**", prevent_sync)
            page = desktop.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE)
            demo_count = verify_demo_labels(page, graph)
            page.screenshot(path=str(ARTIFACTS / "laws-demo-labels.png"), full_page=True)
            status = open_official_panel(page)
            no_document_overflow(page, "desktop official panel")
            page.screenshot(path=str(ARTIFACTS / "laws-empty.png"), full_page=True)
            print("PASS official collection state: live zero counts, incomplete coverage and missing-access requirement")
            verify_search_filters(page, status, requests)
            page.screenshot(path=str(ARTIFACTS / "laws-filtered.png"), full_page=True)
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/status") as status_info, page.expect_response(is_law_list) as list_info:
                page.get_by_role("button", name="상태 새로고침", exact=True).click()
            assert status_info.value.status == 200
            assert_empty_list(list_info.value)
            verify_official_state(page, status_info.value.json())
            mcp = verify_mcp_regression(page)
            desktop.close()

            mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            mobile.route("**/api/laws/sync**", prevent_sync)
            page = mobile.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE)
            status = open_official_panel(page)
            no_document_overflow(page, "390px official panel")
            with page.expect_response(is_law_list) as info:
                page.get_by_label("공식 법령 분류", exact=True).select_option("administrative")
            record_list_response(info.value, {"source": "administrative"}, requests)
            with page.expect_response(is_law_list) as info:
                page.get_by_label("법령 조회 기준일", exact=True).fill(AS_OF)
            record_list_response(info.value, {"source": "administrative", "as_of": AS_OF}, requests)
            verify_official_state(page, status)
            no_document_overflow(page, "390px filtered official panel")
            page.screenshot(path=str(ARTIFACTS / "laws-mobile.png"), full_page=True)
            print("PASS mobile official laws: live source/date selection at 390px without document overflow")
            mobile.close()
            browser.close()
        assert not errors, f"Browser runtime errors: {errors}"
        assert not unexpected_sync, f"Read-only UI unexpectedly attempted synchronization: {unexpected_sync}"
        final_status = api_get("/laws/status")
        assert_empty_coverage(final_status)
    finally:
        assert before == source_snapshot(), "Official-law browser smoke unexpectedly changed the original Markdown vault"

    evidence = {
        "mode": "live_api_empty_corpus", "actual_provider_ingestion_verified": False,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "official_items": 0, "coverage_complete": False,
        "official_changes": 0,
        "historical_complete": False, "annexes_verified": False,
        "source_states": {source: final_status["coverage"]["sources"][source]["status"] for source in SOURCES},
        "missing_requirements": final_status["missing_requirements"],
        "live_search_requests": requests, "browser_sync_attempted": False,
        "mocked_official_documents": False, "demo_rows_verified": demo_count,
        "mobile_width": 390, "mcp": mcp, "source_unchanged": True,
    }
    (ARTIFACTS / "laws-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ARTIFACTS / "laws-status.json").write_text(json.dumps({"mode": evidence["mode"], "recorded_at": evidence["recorded_at"], "status": final_status}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS original source unchanged; screenshots and response evidence saved to {ARTIFACTS}")


def run_ui_fixtures() -> None:
    """Exercise UI states with explicit synthetic HTTP fixtures and no ingestion."""
    before = source_snapshot()
    assert before
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    source_states = {
        source: {"expected": None, "collected": 0, "failed": 0, "status": "not_synced", "complete": False, "errors": []}
        for source in SOURCES
    }
    source_states["law"].update(expected=1, collected=1, status="completed", complete=True)
    state = {
        "configured": True, "missing_requirements": [], "job": None,
        "coverage": {"complete": True, "scope": ["law"], "sources": {"law": source_states["law"]},
                     "historical_complete": False, "annexes_verified": False,
                     "limitations": ["UI 테스트용 합성 응답이며 실제 법령 수집의 근거가 아닙니다."]},
    }
    record = {
        "law_id": "law:ui-fixture-001", "source": "law", "source_id": "ui-fixture-001",
        "version_id": "ui-fixture-v1", "title": "[UI 테스트 자료] 합성 검토법",
        "publication_date": "2025-01-01", "effective_date": "2025-02-01",
        "publication_no": "UI 테스트 제1호", "fetched_at": "2026-09-30T01:23:45+00:00",
        "source_url": "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=ui-fixture-001",
        "raw_sha256": "a" * 64, "raw_integrity_verified": False, "temporal_verified": False,
        "text": "UI 테스트용 합성 전문이며 실제 법령이 아닙니다.\n제1조(목적) 조문·항·호를 모두 표시한다.",
        "provisions": [{"article_no": "제1조", "title": "목적", "text": "UI 테스트 조문 본문",
                        "paragraphs": [{"paragraph_no": "①", "text": "UI 테스트 항 내용",
                                        "items": [{"item_no": "1", "text": "UI 테스트 호 내용"}]}]}],
    }
    calls: list[dict] = []
    errors: list[str] = []
    failed_sync = False

    def fulfill_json(route, body: dict, status: int = 200) -> None:
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body, ensure_ascii=False))

    def fixture_route(route) -> None:
        request = route.request
        parsed = urlparse(request.url)
        parameters = parse_qs(parsed.query, keep_blank_values=True)
        calls.append({"method": request.method, "path": parsed.path, "parameters": parameters})
        if parsed.path == "/api/laws/status":
            fulfill_json(route, deepcopy(state))
        elif parsed.path == "/api/laws/changes":
            fulfill_json(route, {"items": [], "total": 0, "limit": 20, "offset": 0, "run_id": None})
        elif parsed.path == "/api/laws" and request.method == "GET":
            visible = parameters.get("source", [""])[0] in {"", "law"}
            fulfill_json(route, {"items": [record] if visible else [], "total": 1 if visible else 0,
                                 "coverage": deepcopy(state["coverage"])})
        elif parsed.path == "/api/laws/law/ui-fixture-001":
            fulfill_json(route, {**record, "as_of": parameters.get("as_of", [""])[0]})
        elif parsed.path == "/api/laws/sync" and request.method == "POST":
            if failed_sync:
                fulfill_json(route, {"detail": "UI 테스트 응답: API 접근이 차단되었습니다."}, 503)
            else:
                assert set(request.post_data_json["sources"]) == set(SOURCES)
                state["coverage"]["complete"] = False
                state["job"] = {"id": "ui-fixture-job", "status": "running",
                                "started_at": "2026-09-30T01:24:00+00:00", "progress": {"phase": "listing", "source": "law"}}
                fulfill_json(route, {"job": deepcopy(state["job"])}, 202)
        elif parsed.path == "/api/laws/sync/cancel" and request.method == "POST":
            state["job"].update(status="cancelled", finished_at="2026-09-30T01:25:00+00:00")
            fulfill_json(route, {"job": deepcopy(state["job"])})
        else:
            raise AssertionError(f"Unhandled synthetic fixture request: {request.method} {parsed.path}")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 1440, "height": 1100})
            context.route("**/api/laws**", fixture_route)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE)
            page.locator("nav").get_by_role("button", name="공식 법령", exact=True).click()
            expect(page.get_by_test_id("laws-completion-badge")).to_have_text("선택 범위 수집 완료")
            expect(page.get_by_test_id("laws-status")).to_contain_text("법률 해석과 적용 가능성은 별도 검토가 필요합니다.")
            expect(page.locator(".laws-collection-actions")).to_contain_text("마지막 수집 범위: 법령")
            expect(page.locator(".laws-limitations")).to_contain_text("UI 테스트용 합성 응답이며 실제 법령 수집의 근거가 아닙니다.")
            for excluded in ("administrative", "ordinance"):
                expect(page.get_by_test_id(f"laws-source-{excluded}-collected")).to_have_text("—")
                expect(page.get_by_test_id(f"laws-source-{excluded}").locator(".pill")).to_have_text("이번 범위 제외")
            with page.expect_response(is_law_list) as info:
                page.get_by_label("법령 조회 기준일", exact=True).fill(AS_OF)
            assert info.value.status == 200
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/law/ui-fixture-001") as detail:
                page.locator(".laws-record-list > button").click()
            assert parse_qs(urlparse(detail.value.url).query)["as_of"] == [AS_OF]
            expect(page.get_by_test_id("laws-full-text")).to_have_text(record["text"])
            document = page.get_by_test_id("laws-document")
            expect(document).to_contain_text(f"조회 기준일: {AS_OF}")
            expect(document.get_by_role("link", name="공식 원문 출처 확인", exact=True)).to_have_attribute("href", record["source_url"])
            expect(document).to_contain_text("2025-01-01")
            expect(document).to_contain_text("2025-02-01")
            expect(document).to_contain_text("UI 테스트 제1호")
            expect(document.get_by_role("alert")).to_contain_text("저장된 원문 파일이 수집 당시의 내용과 일치하는지 확인하지 못했습니다.")
            expect(document.locator(".laws-temporal-note")).to_contain_text("해당 시점의 법적 효력을 확정하지 않습니다.")
            document.get_by_role("button", name="구조화 조문 (1)", exact=True).click()
            expect(document.locator(".laws-provisions")).to_contain_text("UI 테스트 조문 본문")
            expect(document.locator(".laws-provisions")).to_contain_text("UI 테스트 항 내용")
            expect(document.locator(".laws-provisions")).to_contain_text("UI 테스트 호 내용")
            page.screenshot(path=str(ARTIFACTS / "laws-fixture-reader.png"), full_page=True)
            print("PASS UI fixture reader: synthetic full text, original source URL, as-of forwarding and nested article/paragraph/item")

            state["coverage"]["sources"]["law"].update(expected=None, complete=False)
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/status"):
                page.get_by_role("button", name="상태 새로고침", exact=True).click()
            expect(page.get_by_test_id("laws-status")).to_have_attribute("data-complete", "false")
            expect(page.get_by_test_id("laws-completion-badge")).to_have_text("전체 반영 미완료")
            expect(page.get_by_test_id("laws-source-law-expected")).to_have_text("대상 수 미확인")
            expect(page.get_by_test_id("laws-source-law").locator(".pill")).to_have_text("일부 수집 · 대조 미완료")
            print("PASS UI fixture unknown denominator: stale completion flag cannot imply complete collection")

            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/sync" and response.request.method == "POST") as start:
                page.get_by_test_id("laws-sync").click()
            assert start.value.status == 202
            expect(page.get_by_test_id("laws-status")).to_have_attribute("data-status", "running")
            expect(page.get_by_test_id("laws-completion-badge")).to_have_text("수집 중 · 전체 반영 미완료")
            expect(page.get_by_test_id("laws-cancel")).to_be_enabled()
            expect(page.get_by_label("법령 수집 범위", exact=True)).to_be_disabled()
            page.screenshot(path=str(ARTIFACTS / "laws-fixture-running.png"), full_page=True)
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/sync/cancel") as cancel:
                page.get_by_test_id("laws-cancel").click()
            assert cancel.value.status == 200
            expect(page.get_by_test_id("laws-job")).to_contain_text("수집 중단")
            expect(page.get_by_test_id("laws-sync")).to_be_enabled()
            print("PASS UI fixture job: synthetic start/running/cancel responses and disabled source selection")

            failed_sync = True
            state["coverage"]["complete"] = False
            state["coverage"]["sources"]["law"].update(expected=3, collected=1, failed=2, status="failed", complete=False,
                                                         errors=[{"message": "UI 테스트 응답: 전문 2건 수집 실패"}])
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/status"):
                page.get_by_role("button", name="상태 새로고침", exact=True).click()
            expect(page.get_by_test_id("laws-status")).to_have_attribute("data-status", "blocked")
            expect(page.get_by_test_id("laws-source-law")).to_contain_text("실패 2건")
            expect(page.get_by_test_id("laws-source-law")).to_contain_text("미수집 2건")
            expect(page.get_by_test_id("laws-source-law")).to_contain_text("UI 테스트 응답: 전문 2건 수집 실패")
            with page.expect_response(lambda response: urlparse(response.url).path == "/api/laws/sync") as denied:
                page.get_by_test_id("laws-sync").click()
            assert denied.value.status == 503
            expect(page.get_by_role("alert").filter(has_text="UI 테스트 응답: API 접근이 차단되었습니다.")).to_be_visible()
            expect(page.get_by_test_id("laws-status")).to_have_attribute("data-complete", "false")
            page.screenshot(path=str(ARTIFACTS / "laws-fixture-blocked.png"), full_page=True)
            print("PASS UI fixture failed collection: partial counts, missing counts and blocked sync remain incomplete")
            assert not errors, errors
            context.close()
            browser.close()
    finally:
        assert before == source_snapshot(), "Synthetic UI fixtures changed the original Markdown vault"

    evidence = {"mode": "synthetic_ui_fixtures", "actual_provider_ingestion_verified": False,
                "fixture_title": record["title"], "fixture_requests": calls,
                "states_verified": ["selected_scope_complete", "outside_scope_unknown", "reader", "unknown_denominator", "running", "cancelled", "partial_failed", "blocked_request"],
                "source_unchanged": True}
    (ARTIFACTS / "laws-fixture-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS separate synthetic UI fixtures; no official corpus writes or provider requests")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ui-fixtures", action="store_true", help="Run explicitly synthetic UI states; does not verify provider ingestion")
    if parser.parse_args().ui_fixtures:
        run_ui_fixtures()
    else:
        main()
