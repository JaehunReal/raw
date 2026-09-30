"""HTTP-to-stdio bridge using the official MCP client and isolated workers."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ALLOWED_TOOLS = frozenset({
    "query_markdown_graph", "analyze_git_delta_impact",
    "parse_form_with_vision", "generate_statutory_diff",
})
MAX_ARGUMENT_BYTES = 1_500_000
MAX_VISION_ARGUMENT_BYTES = 14_100_000


class MCPBridgeUnavailable(RuntimeError):
    """A worker failed without returning its stderr or environment to clients."""


class MCPBridgeInputError(ValueError):
    """The requested operation cannot be submitted to a worker."""


class MCPBridge:
    def __init__(self, vault: Path, timeout: float = 30, law_dir: Path | None = None):
        self.vault = Path(vault).resolve()
        self.timeout = timeout
        self.law_dir = Path(law_dir).resolve() if law_dir is not None else None
        self.last_verified_at: str | None = None
        self.last_server: dict[str, str] | None = None
        self.last_failed = False

    def readiness(self) -> dict[str, Any]:
        verified = bool(self.last_verified_at) and not self.last_failed
        return {
            "installed": True,
            "available": verified,
            "connected": False,
            "status": "verified" if verified else "unavailable" if self.last_failed else "not_connected",
            "transport": "stdio", "connection_mode": "per_request", "tools": len(ALLOWED_TOOLS),
            "last_verified_at": self.last_verified_at,
            "detail": "실제 MCP 초기화 확인 · 요청마다 연결 후 종료" if verified else
                      "MCP 연결 확인 실패 · 다시 연결해 주세요" if self.last_failed else
                      "MCP 설치됨 · 도구 목록 조회로 실제 연결을 확인하세요",
        }

    def _parameters(self) -> StdioServerParameters:
        environment = dict(os.environ)
        environment["RULECRAFT_VAULT"] = str(self.vault)
        if self.law_dir is not None:
            environment["RULECRAFT_LAW_DIR"] = str(self.law_dir)
        return StdioServerParameters(
            command=sys.executable, args=["-m", "rulecraft.mcp_server"],
            env=environment, cwd=Path(__file__).resolve().parents[2],
        )

    def _verified(self, initialized: Any) -> dict[str, str]:
        server = {"name": initialized.serverInfo.name, "version": initialized.serverInfo.version}
        self.last_server = server
        self.last_verified_at = datetime.now(timezone.utc).isoformat()
        self.last_failed = False
        return server

    async def tools(self) -> dict[str, Any]:
        return await self._exchange(None, None)

    async def call(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if tool_name not in ALLOWED_TOOLS:
            raise MCPBridgeInputError("등록된 RuleCraft MCP 도구 4개만 호출할 수 있습니다.")
        try:
            size = len(json.dumps(arguments, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        except (TypeError, ValueError, RecursionError):
            raise MCPBridgeInputError("도구 인자는 유효한 JSON 객체여야 합니다.") from None
        limit = MAX_VISION_ARGUMENT_BYTES if tool_name == "parse_form_with_vision" else MAX_ARGUMENT_BYTES
        if size > limit:
            raise MCPBridgeInputError(f"MCP 도구 인자가 허용 크기({limit}바이트)를 초과했습니다.")
        return await self._exchange(tool_name, arguments)

    async def _exchange(self, tool_name: str | None, arguments: dict[str, Any] | None) -> dict[str, Any]:
        started = time.monotonic()
        timeout_scope = asyncio.timeout(self.timeout)
        try:
            # The SDK closes stdin, waits, then terminates/kills its own worker
            # group on context exit. This applies to failures and cancellation.
            # Server stderr remains private and is deleted when the file closes.
            with tempfile.TemporaryFile(mode="w+") as server_log:
                async with timeout_scope:
                    async with stdio_client(self._parameters(), errlog=server_log) as (read, write):
                        async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=self.timeout)) as session:
                            initialized = await session.initialize()
                            server = self._verified(initialized)
                            if tool_name is None:
                                listing = await session.list_tools()
                                tools = [{"name": tool.name, "description": tool.description or "",
                                          "inputSchema": tool.inputSchema}
                                         for tool in listing.tools if tool.name in ALLOWED_TOOLS]
                                if {tool["name"] for tool in tools} != ALLOWED_TOOLS:
                                    raise MCPBridgeUnavailable("MCP 서버의 등록 도구가 예상 목록과 다릅니다.")
                                response = {"server": server, "protocol_version": initialized.protocolVersion,
                                            "transport": "stdio", "tools": tools}
                            else:
                                result = await session.call_tool(tool_name, arguments or {})
                                structured = result.structuredContent
                                if isinstance(structured, dict):
                                    payload = structured
                                else:
                                    content = "\n".join(item.text for item in result.content if item.type == "text")
                                    try:
                                        decoded = json.loads(content)
                                        payload = decoded if isinstance(decoded, dict) else {"content": decoded}
                                    except (ValueError, TypeError):
                                        payload = {"error" if result.isError else "content": content}
                                response = {"tool_name": tool_name, "transport": "stdio",
                                            "is_error": bool(result.isError), "result": payload, "server": server,
                                            "duration_ms": round((time.monotonic() - started) * 1000, 1)}
            return response
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            self.last_failed = True
            raise MCPBridgeUnavailable(f"MCP 연결 또는 도구 실행이 {self.timeout:g}초 안에 완료되지 않았습니다. 다시 시도하세요.") from None
        except MCPBridgeUnavailable:
            self.last_failed = True
            raise
        except Exception:
            # AnyIO can wrap session cancellation/timeout in an ExceptionGroup
            # while disposing its streams. Preserve the caller's cancellation
            # and identify expiry without serializing that exception group.
            task = asyncio.current_task()
            if task is not None and task.cancelling():
                raise asyncio.CancelledError() from None
            # SDK exceptions can carry captured URLs, server data or stderr.
            # Give the UI an actionable stable error without returning them.
            self.last_failed = True
            if timeout_scope.expired():
                raise MCPBridgeUnavailable(f"MCP 연결 또는 도구 실행이 {self.timeout:g}초 안에 완료되지 않았습니다. 다시 시도하세요.") from None
            raise MCPBridgeUnavailable("MCP 서버 연결에 실패했습니다. 서버 설치와 실행 환경을 확인한 뒤 다시 시도하세요.") from None
