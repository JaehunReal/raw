"""Verify real web-to-MCP examples and capture the completed browser results."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright


BASE = os.getenv("RULECRAFT_BROWSER_URL", "http://127.0.0.1:5173")
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")
ARTIFACTS = Path(os.getenv("RULECRAFT_MCP_ARTIFACTS", str(Path(__file__).resolve().parents[1] / ".rulecraft" / "demo")))


def source_snapshot() -> dict[str, str]:
    with urlopen(f"{BASE}/api/graph", timeout=10) as response:
        return {node["id"]: node["markdown"] for node in json.load(response)["nodes"]}


def call_tool(page, tool: str) -> dict:
    page.get_by_test_id(f"mcp-tool-{tool}").click()
    with page.expect_response(lambda response: response.url.endswith("/api/mcp/call") and response.request.method == "POST", timeout=35000) as info:
        page.get_by_test_id("mcp-run").click()
    response = info.value
    assert response.status == 200
    result = response.json()
    assert result["tool_name"] == tool
    assert result["transport"] == "stdio"
    assert result["server"]["name"] == "RuleCraft"
    expect(page.get_by_test_id("mcp-result").locator(".mcp-result-status")).to_be_visible()
    return result


def main() -> None:
    before = source_snapshot()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1540, "height": 1200})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE)
        expect(page.locator(".stat-card").nth(0).locator(".stat-value")).to_contain_text("12")
        page.locator("nav").get_by_role("button", name="MCP 도구", exact=True).click()
        expect(page.get_by_test_id("mcp-connection")).to_contain_text("RuleCraft MCP 서버", timeout=15000)
        expect(page.get_by_test_id("mcp-connection")).to_contain_text("4개 도구")
        expect(page.get_by_test_id("mcp-connection")).to_contain_text("stdio 전송")
        expect(page.locator(".mcp-tool-card")).to_have_count(4)

        graph = call_tool(page, "query_markdown_graph")
        assert not graph["is_error"]
        assert {node["id"] for node in graph["result"]["nodes"]} == {"KIPA-RULE-DAT-007", "LAW-PRIV-015", "LAW-DATA-012"}
        expect(page.get_by_test_id("mcp-result").locator(".mcp-node-list > button")).to_have_count(3)
        expect(page.get_by_test_id("mcp-result")).to_contain_text("개인정보보호법")
        page.screenshot(path=str(ARTIFACTS / "mcp-graph.png"), full_page=True)
        print("PASS web MCP graph: actual stdio, KIPA article + two parent laws")

        impact = call_tool(page, "analyze_git_delta_impact")
        assert not impact["is_error"] and impact["result"]["changed"]
        assert len(impact["result"]["impacted_nodes"]) == 7
        expect(page.get_by_test_id("mcp-impact-count")).to_have_text("7개 문서에 영향")
        expect(page.get_by_test_id("mcp-result").locator(".mcp-node-list > button")).to_have_count(7)
        page.screenshot(path=str(ARTIFACTS / "mcp-impact.png"), full_page=True)
        print("PASS web MCP impact: seven dependent regulations/forms")

        comparison = call_tool(page, "generate_statutory_diff")
        assert not comparison["is_error"]
        assert "| 현행 | 개정안 | 개정이유 |" in comparison["result"]["markdown"]
        expect(page.locator(".mcp-comparison th")).to_have_text(["현행", "개정안", "개정이유"])
        expect(page.locator(".mcp-comparison")).to_contain_text("인공지능 학습 목적과 안전성 요건을 명확히 하기 위함")
        page.screenshot(path=str(ARTIFACTS / "mcp-diff.png"), full_page=True)
        print("PASS web MCP comparison: three-column rendered table and reason")

        vision = call_tool(page, "parse_form_with_vision")
        assert vision["result"]["status"] == "unavailable" and vision["result"]["markdown"] is None
        expect(page.get_by_test_id("mcp-result")).to_contain_text("Vision 모델 연결이 필요합니다.")
        expect(page.get_by_test_id("mcp-result")).to_contain_text("이미지 인식 결과를 생성하지 않았습니다.")
        page.screenshot(path=str(ARTIFACTS / "mcp-vision-unavailable.png"), full_page=True)
        print("PASS web MCP Vision: actual unavailable response, no fake OCR")

        page.get_by_test_id("mcp-tool-query_markdown_graph").click()
        parameters = json.loads(page.get_by_label("MCP 도구 입력").input_value())
        parameters["article_no"] = 0
        page.get_by_label("MCP 도구 입력").fill(json.dumps(parameters, ensure_ascii=False))
        with page.expect_response(lambda response: response.url.endswith("/api/mcp/call") and response.request.method == "POST") as info:
            page.get_by_test_id("mcp-run").click()
        assert info.value.json()["is_error"]
        expect(page.get_by_test_id("mcp-result")).to_contain_text("도구가 오류를 반환했습니다.")
        page.get_by_label("MCP 도구 입력").fill("{")
        page.get_by_test_id("mcp-run").click()
        expect(page.get_by_role("alert")).to_be_visible()
        assert errors == [], f"Browser runtime errors: {errors}"
        print("PASS web MCP errors: actual argument error and invalid JSON shown")
        context.close()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = mobile.new_page()
        page.goto(BASE)
        page.locator("nav").get_by_role("button", name="MCP 도구", exact=True).click()
        expect(page.get_by_test_id("mcp-connection")).to_contain_text("RuleCraft MCP 서버", timeout=15000)
        call_tool(page, "query_markdown_graph")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        call_tool(page, "generate_statutory_diff")
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        page.screenshot(path=str(ARTIFACTS / "mcp-mobile.png"), full_page=True)
        print("PASS mobile web MCP: graph/table flows at 390px without document overflow")
        mobile.close()
        browser.close()

    assert before == source_snapshot(), "MCP browser examples unexpectedly changed source files"
    evidence = {
        "server": graph["server"], "transport": graph["transport"],
        "graph_node_ids": [node["id"] for node in graph["result"]["nodes"]],
        "impacted_node_ids": [node["id"] for node in impact["result"]["impacted_nodes"]],
        "comparison_columns": ["현행", "개정안", "개정이유"],
        "vision_status": vision["result"]["status"], "source_unchanged": True,
    }
    (ARTIFACTS / "mcp-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PASS source unchanged; screenshots saved to {ARTIFACTS}")


if __name__ == "__main__":
    main()
