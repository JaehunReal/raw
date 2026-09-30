"""HTTP workspace API and optional single-origin frontend delivery."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import os
import subprocess
import threading
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from . import __version__, adapters
from .delta import analyze, analyze_git
from .documents import generate_statutory_diff
from .graph import GraphStore
from .mcp_bridge import MCPBridge, MCPBridgeInputError, MCPBridgeUnavailable
from .workflow import PackageWorkflow


ROOT = Path(__file__).resolve().parents[2]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MarkdownRequest(StrictModel):
    markdown: str = Field(min_length=1, max_length=200_000)


class ValidationRequest(MarkdownRequest):
    source_path: str = Field(min_length=1, max_length=1000)


class ImpactRequest(StrictModel):
    target_file_path: str = Field(min_length=1, max_length=1000)
    proposed_diff: str = Field(min_length=1, max_length=200_000)


class GitImpactRequest(StrictModel):
    base_ref: str = Field(default="HEAD", min_length=1, max_length=200)
    head_ref: str | None = Field(default=None, min_length=1, max_length=200)


class PackageRequest(StrictModel):
    agency: str = Field(min_length=1, max_length=120)
    amendment_type: Literal["enactment", "partial", "full"]
    rule_name: str = Field(min_length=1, max_length=200)
    objective: str = Field(min_length=3, max_length=6000)
    effective_date: date
    article_id: str = Field(min_length=1, max_length=1000)
    revised_markdown: str | None = Field(default=None, min_length=1, max_length=200_000)
    amendment_reason: str | None = Field(default=None, max_length=6000)


class VisionRequest(StrictModel):
    image_data_base64: str = Field(min_length=1, max_length=14_000_000)
    output_format: Literal["markdown_table", "interactive_form"] = "markdown_table"


class DiffRequest(StrictModel):
    current_markdown: str = Field(max_length=200_000)
    revised_markdown: str = Field(max_length=200_000)
    amendment_reason: str = Field(default="", max_length=6000)


class MCPCallRequest(StrictModel):
    tool_name: str = Field(min_length=1, max_length=100)
    arguments: dict[str, Any]


def _history(root: Path, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "log", "-8", "--format=%h%x00%aI%x00%s"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        if result.returncode == 0:
            history = []
            for line in result.stdout.splitlines():
                parts = line.split("\x00", 2)
                if len(parts) == 3:
                    history.append({"id": parts[0], "date": parts[1], "title": parts[2], "source": "git"})
            if history:
                return history
    except (OSError, subprocess.TimeoutExpired):
        pass
    return [{"id": node["id"], "title": node["title"], "date": node["last_amended"],
             "rule_name": node["rule_name"], "path": node["path"], "source": "metadata"}
            for node in sorted(nodes, key=lambda item: item["last_amended"], reverse=True)[:8]]


def create_app(vault: Path | None = None, package_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="RuleCraft API", version=__version__,
                  description="Markdown 지식그래프와 규정 제·개정 검토용 문서 워크스페이스")
    app.add_middleware(CORSMiddleware,
                       allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_credentials=False, allow_methods=["GET", "POST", "PUT"],
                       allow_headers=["Content-Type"])
    store = GraphStore(vault or Path(os.getenv("RULECRAFT_VAULT", str(ROOT / "legal-knowledge-vault"))))
    workflow = PackageWorkflow(store, package_dir or ROOT / ".rulecraft" / "packages")
    mcp_bridge = MCPBridge(store.vault)
    lock = threading.RLock()
    app.state.store = store
    app.state.workflow = workflow
    app.state.mcp_bridge = mcp_bridge

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__, "service": "rulecraft"}

    @app.get("/api/overview")
    def overview() -> dict[str, Any]:
        with lock:
            graph = store.refresh()
            nodes = graph["nodes"]
            agencies = sorted({node["agency"] for node in nodes})
            rules = sorted({node["rule_name"] for node in nodes})
            return {
                "stats": {"nodes": len(nodes), "edges": len(graph["edges"]),
                          "agencies": len(agencies), "rules": len(rules),
                          "forms": sum(node["kind"] == "form" for node in nodes),
                          "issues": len(graph["issues"]), "packages": len(workflow.list())},
                "readiness": {"graph": {"available": bool(nodes), "status": "ready" if nodes else "empty",
                                         "detail": f"로컬 Markdown 문서 {len(nodes)}개"},
                              "mcp": mcp_bridge.readiness(),
                              **adapters.readiness()},
                "recent_changes": _history(ROOT, nodes), "agencies": agencies, "rules": rules,
                "issues": graph["issues"],
            }

    @app.get("/api/graph")
    def graph(agency_name: str = "", rule_name: str = "", article_no: str = "",
              traverse_direction: Literal["UPWARD_PARENT", "DOWNWARD_DELEGATION", "BACKLINKS", "ALL"] = "ALL") -> dict:
        with lock:
            store.refresh()
            if agency_name or rule_name or article_no:
                return store.query(agency_name, rule_name, article_no, traverse_direction)
            return store.graph()

    @app.get("/api/articles")
    def articles(query: str = Query(default="", max_length=200)) -> dict[str, Any]:
        with lock:
            nodes = store.refresh()["nodes"]
            needle = query.casefold().strip()
            if needle:
                nodes = [node for node in nodes if needle in " ".join(str(node[key]) for key in
                         ("title", "agency", "rule_name", "article_no", "body")).casefold()]
            return {"articles": nodes, "total": len(nodes)}

    @app.get("/api/articles/{article_id:path}")
    def article(article_id: str) -> dict[str, Any]:
        with lock:
            store.refresh()
            node = store.get(article_id)
            if node is None:
                raise HTTPException(404, "조문을 찾을 수 없습니다.")
            return node

    @app.put("/api/articles/{article_id:path}")
    def save_article(article_id: str, body: MarkdownRequest) -> dict[str, Any]:
        with lock:
            store.refresh()
            node = store.get(article_id)
            if node is None:
                raise HTTPException(404, "조문을 찾을 수 없습니다.")
            validation = store.validate(body.markdown, node["path"])
            if not validation["valid"]:
                raise HTTPException(422, {"message": "정합성 검증에 실패했습니다.", "verification": validation})
            try:
                return store.save(article_id, body.markdown)
            except (ValueError, OSError) as error:
                raise HTTPException(422, str(error)) from None

    @app.post("/api/validate")
    def validate(body: ValidationRequest) -> dict:
        with lock:
            store.refresh()
            try:
                return store.validate(body.markdown, body.source_path)
            except ValueError as error:
                raise HTTPException(400, str(error)) from None

    @app.post("/api/impact")
    def impact(body: ImpactRequest) -> dict:
        with lock:
            store.refresh()
            try:
                return analyze(store, body.target_file_path, body.proposed_diff)
            except (ValueError, FileNotFoundError, KeyError) as error:
                raise HTTPException(400, str(error)) from None

    @app.post("/api/impact/git")
    def git_impact(body: GitImpactRequest) -> dict:
        with lock:
            store.refresh()
            try:
                return analyze_git(store, body.base_ref, body.head_ref)
            except (ValueError, FileNotFoundError, KeyError) as error:
                raise HTTPException(400, str(error)) from None

    @app.post("/api/packages", status_code=201)
    def create_package(body: PackageRequest) -> dict:
        with lock:
            try:
                return workflow.run(body.model_dump(mode="json"))
            except KeyError as error:
                raise HTTPException(404, str(error)) from None
            except ValueError as error:
                raise HTTPException(400, str(error)) from None

    @app.get("/api/packages")
    def packages() -> dict[str, Any]:
        with lock:
            return {"packages": workflow.list()}

    @app.get("/api/packages/{package_id}/download")
    def download(package_id: str) -> Response:
        with lock:
            try:
                content = workflow.archive(package_id)
            except KeyError as error:
                raise HTTPException(404, str(error)) from None
            except ValueError as error:
                raise HTTPException(409, str(error)) from None
        return Response(content, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="rulecraft-{package_id}.zip"'})

    @app.get("/api/packages/{package_id}")
    def get_package(package_id: str) -> dict:
        with lock:
            try:
                return workflow.get(package_id)
            except KeyError as error:
                raise HTTPException(404, str(error)) from None
            except ValueError as error:
                raise HTTPException(400, str(error)) from None

    @app.post("/api/vision")
    def vision(body: VisionRequest) -> dict:
        try:
            return adapters.parse_form_with_vision(body.image_data_base64, body.output_format)
        except adapters.AdapterUnavailable as error:
            raise HTTPException(503, str(error)) from None
        except ValueError as error:
            raise HTTPException(400, str(error)) from None

    @app.get("/api/law/search")
    def law_search(query: str = Query(min_length=1, max_length=200)) -> dict:
        try:
            return adapters.search_national_law(query)
        except adapters.AdapterUnavailable as error:
            raise HTTPException(503, str(error)) from None

    @app.post("/api/diff")
    def statutory_diff(body: DiffRequest) -> dict:
        return {"markdown": generate_statutory_diff(body.current_markdown, body.revised_markdown, body.amendment_reason),
                "format": "markdown", "status": "draft", "requires_human_review": True}

    @app.get("/api/mcp/tools")
    async def mcp_tools() -> dict[str, Any]:
        try:
            return await mcp_bridge.tools()
        except MCPBridgeUnavailable as error:
            raise HTTPException(503, str(error)) from None

    @app.post("/api/mcp/call")
    async def mcp_call(body: MCPCallRequest) -> dict[str, Any]:
        try:
            return await mcp_bridge.call(body.tool_name, body.arguments)
        except MCPBridgeInputError as error:
            raise HTTPException(400, str(error)) from None
        except MCPBridgeUnavailable as error:
            raise HTTPException(503, str(error)) from None

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "API 경로를 찾을 수 없습니다.")
        dist = (ROOT / "frontend" / "dist").resolve()
        requested = (dist / path).resolve()
        if not requested.is_relative_to(dist):
            raise HTTPException(404, "파일을 찾을 수 없습니다.")
        if path and requested.is_file():
            return FileResponse(requested)
        index = dist / "index.html"
        if index.is_file() and not Path(path).suffix:
            return FileResponse(index)
        raise HTTPException(404, "프런트엔드 빌드가 없습니다. frontend에서 npm run build를 실행하세요.")

    return app


app = create_app()
