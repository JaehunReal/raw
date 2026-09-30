"""Official MCP SDK stdio server implementing the four PDR tools."""

from __future__ import annotations

from pathlib import Path
import os
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import adapters
from .delta import analyze
from .documents import generate_statutory_diff as render_statutory_diff
from .graph import GraphStore


mcp = FastMCP("RuleCraft", instructions=(
    "로컬 Markdown 법령 지식그래프의 조회·변경 영향 분석과 검토용 문서 도구입니다. "
    "로컬 문서는 최신 법적 효력을 보증하지 않습니다. 이미지 분석은 설정된 Vision 모델이 필요합니다."
))


def _store() -> GraphStore:
    root = Path(__file__).resolve().parents[2]
    return GraphStore(Path(os.getenv("RULECRAFT_VAULT", str(root / "legal-knowledge-vault"))))


@mcp.tool()
def query_markdown_graph(agency_name: str, rule_name: str, article_no: int,
                         traverse_direction: Literal["UPWARD_PARENT", "DOWNWARD_DELEGATION", "BACKLINKS", "ALL"] = "ALL") -> dict[str, Any]:
    """특정 조문과 연결된 상위법, 하위 지침, 서식 및 역링크를 탐색합니다."""
    if article_no < 1:
        raise ValueError("article_no는 양의 정수여야 합니다.")
    return _store().query(agency_name, rule_name, str(article_no), traverse_direction)


@mcp.tool()
def analyze_git_delta_impact(target_file_path: str, proposed_diff: str) -> dict[str, Any]:
    """Markdown 텍스트 또는 Unified Diff의 변경 파급도와 인용 정비 후보를 분석합니다."""
    if len(proposed_diff) > 200_000:
        raise ValueError("변경안은 200KB 이하여야 합니다.")
    return analyze(_store(), target_file_path, proposed_diff)


@mcp.tool()
def parse_form_with_vision(image_data_base64: str,
                          output_format: Literal["markdown_table", "interactive_form"] = "markdown_table") -> dict[str, Any]:
    """설정된 Ollama LLaVA 모델로 PNG/JPEG/WebP 서식을 Markdown으로 읽습니다. 미연결 시 unavailable입니다."""
    try:
        return adapters.parse_form_with_vision(image_data_base64, output_format)
    except adapters.AdapterUnavailable as error:
        return {"status": "unavailable", "code": "adapter_unavailable", "error": str(error), "markdown": None}
    except ValueError as error:
        return {"status": "invalid_input", "code": "invalid_image", "error": str(error), "markdown": None}


@mcp.tool()
def generate_statutory_diff(current_markdown: str, revised_markdown: str, amendment_reason: str = "") -> dict[str, Any]:
    """현행/개정안/개정이유의 3단 신구조문대비표를 Markdown으로 렌더링합니다."""
    if len(current_markdown) + len(revised_markdown) > 400_000:
        raise ValueError("조문 텍스트는 합계 400KB 이하여야 합니다.")
    return {"markdown": render_statutory_diff(current_markdown, revised_markdown, amendment_reason),
            "format": "markdown", "status": "draft", "requires_human_review": True}


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
