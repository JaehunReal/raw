from __future__ import annotations

import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from tests.support import article


def payload(result: object) -> dict:
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return structured
    text = next(item.text for item in result.content if item.type == "text")
    return json.loads(text)


class StandardMcpProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_client_initializes_lists_and_calls_all_pdr_tools(self) -> None:
        with tempfile.TemporaryDirectory(prefix="rulecraft-mcp-") as directory, tempfile.TemporaryFile(mode="w+") as server_log:
            vault = Path(directory)
            vault.joinpath("law.md").write_text(article("LAW", 15, agency="국가", rule="상위법"), encoding="utf-8")
            current = article("RULE", 7, delegated_by=["[[LAW]]"])
            vault.joinpath("rule.md").write_text(current, encoding="utf-8")
            environment = {key: value for key, value in os.environ.items() if not key.startswith("RULECRAFT_")}
            environment["RULECRAFT_VAULT"] = str(vault)
            parameters = StdioServerParameters(command=sys.executable, args=["-m", "rulecraft.mcp_server"], env=environment)

            async with asyncio.timeout(30), stdio_client(parameters, errlog=server_log) as (read, write):
                async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=10)) as session:
                    initialized = await session.initialize()
                    self.assertEqual(initialized.serverInfo.name, "RuleCraft")
                    tools = await session.list_tools()
                    self.assertEqual({tool.name for tool in tools.tools}, {
                        "query_markdown_graph", "analyze_git_delta_impact",
                        "parse_form_with_vision", "generate_statutory_diff",
                    })
                    graph_result = await session.call_tool("query_markdown_graph", {
                        "agency_name": "테스트기관", "rule_name": "공공데이터지침",
                        "article_no": 7, "traverse_direction": "UPWARD_PARENT",
                    })
                    self.assertFalse(graph_result.isError)
                    self.assertEqual({node["id"] for node in payload(graph_result)["nodes"]}, {"RULE", "LAW"})
                    revised = current + "\n① 처리 목적을 확인하여야 한다.\n"
                    impact = payload(await session.call_tool("analyze_git_delta_impact", {"target_file_path": "rule.md", "proposed_diff": revised}))
                    self.assertTrue(impact["changed"])
                    self.assertEqual(impact["issues"], [])
                    comparison = payload(await session.call_tool("generate_statutory_diff", {
                        "current_markdown": current, "revised_markdown": revised, "amendment_reason": "절차 정비",
                    }))
                    self.assertIn("| 현행 | 개정안 | 개정이유 |", comparison["markdown"])
                    self.assertTrue(comparison["requires_human_review"])
                    vision = payload(await session.call_tool("parse_form_with_vision", {"image_data_base64": "aGVsbG8="}))
                    self.assertEqual(vision["status"], "unavailable")
                    self.assertIsNone(vision["markdown"])
                    unsafe = payload(await session.call_tool("analyze_git_delta_impact", {"target_file_path": "../../outside.md", "proposed_diff": revised}))
                    self.assertEqual([issue["code"] for issue in unsafe["issues"]], ["unsafe_path"])
            self.assertEqual(vault.joinpath("rule.md").read_text(encoding="utf-8"), current)
