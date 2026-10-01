"""Verify built public preview assets without a backend or screenshots.

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
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")
TABS = (
    "워크스페이스", "규정 예제 저장소", "규정 관계 그래프", "변경 영향 예제",
    "문서 패키지 예제", "공식 법령 현황", "MCP 검증 기록",
)


class StaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_GET(self) -> None:
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
def static_server(directory: Path):
    if not (directory / "index.html").is_file():
        raise RuntimeError(f"Missing frontend build: {directory}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(StaticHandler, directory=str(directory)))
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
            evidence["api_requests"].append(address.path)

    page.on("request", requested)
    return evidence


def assert_clean(evidence: dict) -> None:
    for key, failures in evidence.items():
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
    expect(page.get_by_test_id("preview-official-count")).to_contain_text("0")
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
    expect(status).to_contain_text("403")
    expect(status).to_contain_text("0")
    expect(status).to_contain_text("확인하지 못했습니다")
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
            "official_documents": 0, "provider_proxy_status_displayed": 403,
            "past_mcp_tools_displayed": 4, "past_mcp_nodes_displayed": 3,
            "mobile_width": 390, "mobile_overflow": False, "runtime_errors": 0,
            "console_errors": 0, "failed_requests": 0, "api_requests": 0, "external_requests": 0}


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
