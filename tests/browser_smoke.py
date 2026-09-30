"""Exercise a running workspace with Chromium; does not edit the sample vault.

Run with an interpreter containing playwright:
    python tests/browser_smoke.py
Optional environment: RULECRAFT_BROWSER_URL, RULECRAFT_CHROMIUM_PATH.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import urlopen
import zipfile

from playwright.sync_api import expect, sync_playwright


BASE = os.getenv("RULECRAFT_BROWSER_URL", "http://127.0.0.1:5173")
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")


def api_graph() -> dict:
    with urlopen(f"{BASE}/api/graph", timeout=10) as response:
        return json.load(response)


def navigate(page, label: str) -> None:
    page.locator("nav").get_by_role("button", name=re.compile(rf"^{re.escape(label)}(?:\s*\d+)?$")).click()


def no_document_overflow(page, label: str) -> None:
    widths = page.evaluate("({document:document.documentElement.scrollWidth, viewport:window.innerWidth})")
    assert widths["document"] <= widths["viewport"] + 1, f"{label}: horizontal document overflow {widths}"


def run_workflow(created_packages: list[str]) -> None:
    before = api_graph()
    assert len(before["nodes"]) == 12 and len(before["edges"]) == 31
    assert before["issues"] == []
    snapshot = {node["id"]: node["markdown"] for node in before["nodes"]}
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="rulecraft-browser-") as artifacts:
        browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
        page = context.new_page()
        failures = []
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.goto(BASE)
        expect(page.locator(".stat-card").nth(0).locator(".stat-value")).to_have_text(re.compile(r"^12"))
        expect(page.locator(".stat-card").nth(1).locator(".stat-value")).to_have_text(re.compile(r"^31"))
        print("PASS desktop dashboard: 12 nodes, 31 relations")

        navigate(page, "규정 지식 저장소")
        page.get_by_label("규정 검색", exact=True).fill("데이터의 반출 허가")
        expect(page.locator("tbody tr")).to_have_count(1)
        page.locator("tbody tr").click()
        dialog = page.get_by_role("dialog", name="조문 편집기")
        expect(dialog).to_be_visible()
        expect(page.get_by_label("조문 마크다운 편집")).to_have_value(snapshot["KIPA-RULE-DAT-007"])
        page.get_by_label("조문 마크다운 편집").fill(snapshot["KIPA-RULE-DAT-007"] + "\n[[missing#제99조]]\n")
        dialog.get_by_role("button", name="검증 후 저장").click()
        expect(dialog.locator(".issue-list")).to_contain_text("missing#제99조")
        dialog.get_by_role("button", name="닫기", exact=True).click()
        print("PASS vault search/editor: original content, invalid save rejected")

        navigate(page, "규정 관계 그래프")
        page.get_by_label("중심 조문").select_option("KIPA-RULE-DAT-007")
        page.get_by_role("button", name="상위법", exact=True).click()
        assert page.locator(".full-graph .graph-node").count() > 1, "Upper-law graph lost delegated_by relationships"
        print("PASS graph: upper-law direction follows delegation")

        navigate(page, "변경 영향 분석")
        page.get_by_label("변경할 조문").select_option("LAW-PRIV-015")
        page.get_by_label("개정 마크다운", exact=True).fill(snapshot["LAW-PRIV-015"] + "\n③ 학습 목적과 안전성 요건을 확인하여야 한다.\n")
        with page.expect_response(lambda response: response.url.endswith("/api/impact") and response.request.method == "POST") as response_info:
            page.locator(".impact-input").get_by_role("button", name="변경 영향 분석", exact=True).click()
        impact = response_info.value.json()
        assert impact["changed"] and len(impact["impacted_nodes"]) == 7 and impact["issues"] == []
        expect(page.locator(".impact-results")).to_contain_text("7개 연결 문서")
        expect(page.locator(".impact-list > button")).to_have_count(7)
        print("PASS impact: changed LAW-PRIV-015 affects seven documents")

        navigate(page, "워크스페이스")
        page.get_by_role("button", name="새 개정 프로젝트", exact=True).click()
        page.get_by_role("button", name="대상 조문 선택", exact=True).click()
        expect(page.get_by_label("개정 대상 조문")).to_have_value("KIPA-RULE-DAT-007")
        page.get_by_role("button", name="문서 구성 확인", exact=True).click()
        with page.expect_response(lambda response: response.url.endswith("/api/packages") and response.request.method == "POST") as response_info:
            page.get_by_role("button", name="문서 패키지 생성", exact=True).click()
        package = response_info.value.json()
        created_packages.append(package["id"])
        assert package["status"] == "draft" and len(package["documents"]) == 7
        expect(page.locator(".result-docs > button")).to_have_count(7)
        page.get_by_role("button", name="02_신구조문대비표.md", exact=True).click()
        preview = page.get_by_role("dialog", name="문서 미리보기")
        expect(preview).to_contain_text("| 현행 | 개정안 | 개정이유 |")
        preview.get_by_role("button", name="닫기", exact=True).click()
        with page.expect_download() as download_info:
            page.get_by_role("button", name="전체 문서 다운로드", exact=True).click()
        download = download_info.value
        assert download.failure() is None
        with open(download.path(), "rb") as stream:
            with zipfile.ZipFile(io.BytesIO(stream.read())) as archive:
                assert len(archive.namelist()) == 8 and "manifest.json" in archive.namelist()
        print("PASS wizard: seven documents, comparison preview, eight-entry ZIP")

        page.get_by_role("button", name="초안 수정", exact=True).click()
        current = page.get_by_label("개정 초안").input_value()
        page.get_by_label("개정 초안").fill(current + "\n[[missing#제99조]]\n")
        page.get_by_role("button", name="문서 구성 확인", exact=True).click()
        with page.expect_response(lambda response: response.url.endswith("/api/packages") and response.request.method == "POST") as response_info:
            page.get_by_role("button", name="문서 패키지 생성", exact=True).click()
        blocked = response_info.value.json()
        created_packages.append(blocked["id"])
        assert blocked["status"] == "blocked" and blocked["documents"] == []
        expect(page.get_by_role("heading", name="인용 검증을 통과하지 못했습니다.")).to_be_visible()
        expect(page.get_by_role("button", name="전체 문서 다운로드", exact=True)).to_be_disabled()
        print("PASS wizard gate: invalid citation blocks documents and download")
        assert failures == [], f"Browser runtime errors: {failures}"
        context.close()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = mobile.new_page()
        page.goto(BASE)
        expect(page.locator(".stat-card").nth(0).locator(".stat-value")).to_have_text(re.compile(r"^12"))
        no_document_overflow(page, "mobile dashboard")
        for label in ("규정 지식 저장소", "규정 관계 그래프", "변경 영향 분석", "문서 패키지", "워크스페이스"):
            navigate(page, label)
            no_document_overflow(page, f"mobile {label}")
        page.get_by_role("button", name="새 개정 프로젝트", exact=True).click()
        no_document_overflow(page, "mobile wizard")
        print("PASS mobile 390px: all navigation and no document overflow")
        mobile.close()
        browser.close()
    after = {node["id"]: node["markdown"] for node in api_graph()["nodes"]}
    assert snapshot == after, "Browser workflow unexpectedly modified the sample vault"
    print("PASS source vault remained unchanged")


def main() -> None:
    created: list[str] = []
    package_dir = Path(os.getenv("RULECRAFT_BROWSER_PACKAGE_DIR", str(Path(__file__).resolve().parents[1] / ".rulecraft" / "packages")))
    try:
        run_workflow(created)
    finally:
        for package_id in created:
            if re.fullmatch(r"[a-f0-9]{32}", package_id):
                package_dir.joinpath(f"{package_id}.json").unlink(missing_ok=True)
        if created:
            print(f"CLEANUP removed {len(created)} packages created by this run")


if __name__ == "__main__":
    main()
