"""Official MCP SDK stdio server implementing the four PDR tools."""

from __future__ import annotations

from pathlib import Path
from datetime import date
import os
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from . import adapters
from .delta import analyze
from .documents import generate_statutory_diff as render_statutory_diff
from .graph import GraphStore, normalize_article
from .law_graph import default_law_store, query_official_graph
from .legal_grounding import add_text_impact


mcp = FastMCP("RuleCraft", instructions=(
    "로컬 Markdown 법령 지식그래프의 조회·변경 영향 분석과 검토용 문서 도구입니다. "
    "query_markdown_graph의 source_scope=official은 수집한 공식 원문과 수집 범위를 조회합니다. "
    "로컬 문서는 최신 법적 효력을 보증하지 않습니다. 이미지 분석은 설정된 Vision 모델이 필요합니다."
))


def _store() -> GraphStore:
    root = Path(__file__).resolve().parents[2]
    return GraphStore(Path(os.getenv("RULECRAFT_VAULT", str(root / "legal-knowledge-vault"))))


@mcp.tool()
def query_markdown_graph(agency_name: str, rule_name: str, article_no: int | str,
                         traverse_direction: Literal["UPWARD_PARENT", "DOWNWARD_DELEGATION", "BACKLINKS", "ALL"] = "ALL",
                         source_scope: Literal["local", "official"] = "local",
                         as_of: str | None = None) -> dict[str, Any]:
    """로컬 관계 탐색 또는 source_scope=official로 수집한 공식 조문과 원문 출처를 조회합니다."""
    anchor = normalize_article(article_no)
    if not anchor:
        raise ValueError("article_no는 양의 조 번호 또는 제7조의2 같은 조 번호여야 합니다.")
    if source_scope == "official":
        if as_of is not None:
            try:
                as_of = date.fromisoformat(as_of).isoformat()
            except ValueError:
                raise ValueError("as_of는 YYYY-MM-DD 형식이어야 합니다.") from None
        return query_official_graph(default_law_store(), rule_name, anchor, as_of)
    return _store().query(agency_name, rule_name, anchor, traverse_direction)


@mcp.tool()
def analyze_git_delta_impact(target_file_path: str, proposed_diff: str) -> dict[str, Any]:
    """Markdown 텍스트 또는 Unified Diff의 변경 파급도와 인용 정비 후보를 분석합니다."""
    if len(proposed_diff) > 200_000:
        raise ValueError("변경안은 200KB 이하여야 합니다.")
    store = _store()
    result = analyze(store, target_file_path, proposed_diff)
    try:
        path = store.relative_path(target_file_path)
    except ValueError:
        return result
    node = next((item for item in store.graph()["nodes"] if item["path"] == path), None)
    return add_text_impact(store, node, result) if node else result


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
