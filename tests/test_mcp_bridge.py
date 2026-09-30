from __future__ import annotations

import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from rulecraft.api import create_app
from rulecraft.mcp_bridge import MCPBridge, MCPBridgeUnavailable

from tests.support import VaultTestCase, article


TOOLS = {
    "query_markdown_graph", "analyze_git_delta_impact",
    "parse_form_with_vision", "generate_statutory_diff",
}


class WebMcpBridgeTests(VaultTestCase):
    """HTTP entrypoints must cross a real MCP process boundary, not mock handlers."""

    def setUp(self) -> None:
        super().setUp()
        self.privacy = article("LAW-PRIV-015", 15, agency="국가법령", rule="개인정보보호법")
        self.write("laws/privacy.md", self.privacy)
        self.write("laws/data.md", article("LAW-DATA-012", 12, agency="국가법령", rule="공공데이터법"))
        self.main = article("RULE-7", 7, delegated_by=["[[LAW-PRIV-015]]", "[[LAW-DATA-012]]"], uses_form=["[[FORM-1]]"])
        self.write("rules/main.md", self.main)
        self.write("rules/eight.md", article("RULE-8", 8, cites=["[[RULE-7]]"]))
        self.write("rules/nine.md", article("RULE-9", 9, cites=["[[RULE-8]]"]))
        self.write("rules/twelve.md", article("RULE-12", 12, cites=["[[RULE-9]]"]))
        for number, target in ((1, "RULE-7"), (2, "RULE-8"), (3, "RULE-9")):
            self.write(f"forms/form-{number}.md", article(f"FORM-{number}", number, kind="form", rule=f"서식{number}", cites=[f"[[{target}]]"]))
        self.client = TestClient(create_app(self.vault, self.vault / "packages"))
        self.addCleanup(self.client.close)

    def call(self, tool_name: str, arguments: dict) -> dict:
        response = self.client.post("/api/mcp/call", json={"tool_name": tool_name, "arguments": arguments})
        self.assertEqual(response.status_code, 200, response.text)
        envelope = response.json()
        self.assertEqual(envelope["tool_name"], tool_name)
        self.assertEqual(envelope["transport"], "stdio")
        self.assertEqual(envelope["server"]["name"], "RuleCraft")
        self.assertGreaterEqual(envelope["duration_ms"], 0)
        return envelope

    def test_tools_list_is_discovered_from_initialized_official_mcp_server(self) -> None:
        before = self.client.get("/api/overview").json()["readiness"]["mcp"]
        self.assertTrue(before["installed"])
        self.assertFalse(before["available"])
        response = self.client.get("/api/mcp/tools")
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["server"]["name"], "RuleCraft")
        self.assertEqual(result["transport"], "stdio")
        self.assertTrue(result["protocol_version"])
        self.assertEqual({tool["name"] for tool in result["tools"]}, TOOLS)
        query = next(tool for tool in result["tools"] if tool["name"] == "query_markdown_graph")
        self.assertIn("article_no", query["inputSchema"]["properties"])
        after = self.client.get("/api/overview").json()["readiness"]["mcp"]
        self.assertTrue(after["available"])
        self.assertFalse(after["connected"])
        self.assertEqual(after["connection_mode"], "per_request")
        self.assertTrue(after["last_verified_at"])

    def test_web_graph_call_reads_configured_vault_and_returns_two_parent_laws(self) -> None:
        envelope = self.call("query_markdown_graph", {
            "agency_name": "테스트기관", "rule_name": "공공데이터지침",
            "article_no": 7, "traverse_direction": "UPWARD_PARENT",
        })

        self.assertFalse(envelope["is_error"])
        self.assertEqual({node["id"] for node in envelope["result"]["nodes"]}, {"RULE-7", "LAW-PRIV-015", "LAW-DATA-012"})

    def test_web_impact_call_tracks_seven_dependents_without_modifying_source(self) -> None:
        revised = self.privacy + "\n① 학습 목적과 안전성 요건을 확인하여야 한다.\n"
        envelope = self.call("analyze_git_delta_impact", {"target_file_path": "laws/privacy.md", "proposed_diff": revised})

        self.assertFalse(envelope["is_error"])
        self.assertTrue(envelope["result"]["changed"])
        self.assertEqual({node["id"] for node in envelope["result"]["impacted_nodes"]}, {"RULE-7", "RULE-8", "RULE-9", "RULE-12", "FORM-1", "FORM-2", "FORM-3"})
        self.assertEqual(envelope["result"]["issues"], [])
        self.assertEqual(self.vault.joinpath("laws/privacy.md").read_text(encoding="utf-8"), self.privacy)

    def test_web_statutory_diff_call_returns_three_columns_and_user_reason(self) -> None:
        envelope = self.call("generate_statutory_diff", {
            "current_markdown": self.main, "revised_markdown": self.main + "\n① 학습 목적을 확인하여야 한다.\n",
            "amendment_reason": "AI 활용 시 안전성 확보",
        })

        self.assertFalse(envelope["is_error"])
        self.assertIn("| 현행 | 개정안 | 개정이유 |", envelope["result"]["markdown"])
        self.assertIn("AI 활용 시 안전성 확보", envelope["result"]["markdown"])
        self.assertTrue(envelope["result"]["requires_human_review"])

    def test_web_vision_call_explicitly_reports_unavailable_without_fake_ocr(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            envelope = self.call("parse_form_with_vision", {"image_data_base64": "aGVsbG8="})

        self.assertFalse(envelope["is_error"])
        self.assertEqual(envelope["result"]["status"], "unavailable")
        self.assertIsNone(envelope["result"]["markdown"])

    def test_unknown_tool_is_rejected_and_server_argument_errors_are_visible(self) -> None:
        unknown = self.client.post("/api/mcp/call", json={"tool_name": "execute_shell", "arguments": {"command": "touch outside"}})
        self.assertEqual(unknown.status_code, 400)
        invalid = self.call("query_markdown_graph", {"agency_name": "테스트기관", "rule_name": "공공데이터지침", "article_no": 0})
        self.assertTrue(invalid["is_error"])
        self.assertEqual(list(self.vault.glob("outside*")), [])


class MCPBridgeLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_worker_timeout_is_reported_and_next_connection_recovers(self) -> None:
        with tempfile.TemporaryDirectory(prefix="rulecraft-mcp-timeout-") as directory:
            bridge = MCPBridge(Path(directory), timeout=0.05)
            with self.assertRaises(MCPBridgeUnavailable) as failure:
                await bridge.tools()
            self.assertIn("0.05초", str(failure.exception))
            self.assertFalse(bridge.readiness()["available"])
            bridge.timeout = 10
            recovered = await bridge.tools()
            self.assertEqual({tool["name"] for tool in recovered["tools"]}, TOOLS)
            self.assertTrue(bridge.readiness()["available"])

    async def test_cancelling_real_worker_preserves_cancellation_and_allows_new_request(self) -> None:
        with tempfile.TemporaryDirectory(prefix="rulecraft-mcp-cancel-") as directory:
            bridge = MCPBridge(Path(directory), timeout=10)
            task = asyncio.create_task(bridge.tools())
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=5)
            recovered = await bridge.tools()
            self.assertEqual(recovered["server"]["name"], "RuleCraft")
