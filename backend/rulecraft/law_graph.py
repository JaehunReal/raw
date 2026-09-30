"""Project a requested official provision without scanning the national corpus."""

from __future__ import annotations

from pathlib import Path
import os
from typing import Any

from .graph import normalize_article
from .law_store import LawStore


def default_law_store() -> LawStore:
    root = Path(__file__).resolve().parents[2]
    return LawStore(Path(os.getenv("RULECRAFT_LAW_DIR", str(root / ".rulecraft" / "national-law"))))


def query_official_graph(store: LawStore, rule_name: str, article_no: str,
                         as_of: str | None = None) -> dict[str, Any]:
    coverage = store.coverage()
    response: dict[str, Any] = {"nodes": [], "edges": [], "issues": [], "roots": [],
                               "source_scope": "official", "as_of": as_of,
                               "coverage": coverage, "legal_authority_verified": False,
                               "notice": "수집한 공식 원문을 조회합니다. 연결 관계와 실질적 적법성은 별도 검토가 필요합니다."}
    if not rule_name.strip() or not normalize_article(article_no):
        response["issues"] = [{"severity": "error", "code": "official_query_required",
                               "message": "공식 원문 조회에는 법령명과 유효한 조 번호가 필요합니다."}]
        return response
    resolved = store.resolve_citation(rule_name, normalize_article(article_no), as_of=as_of)
    if not resolved.get("found") or resolved.get("ambiguous"):
        response["issues"] = [{"severity": "error", "code": "official_citation_unavailable",
                               "message": "수집한 원문에서 해당 법령·조문·기준일을 확정할 수 없습니다."}]
        return response
    law, article = resolved["law"], resolved["article"]
    anchor = normalize_article(article.get("article_no", article_no))
    identifier = f"OFFICIAL:{law['law_id']}:{law['version_id']}:{anchor}"
    metadata = {"official": True, "read_only": True, "source": law["source"],
                "source_id": law["source_id"], "version_id": law["version_id"],
                "source_url": law["source_url"], "sha256": law["sha256"],
                "fetched_at": law["fetched_at"], "effective_date": law.get("effective_date"),
                "publication_date": law.get("publication_date"), "as_of": as_of}
    text = article.get("text", "")
    title = article.get("title") or anchor
    node = {"id": identifier, "path": "", "agency": "국가법령", "rule_name": law["title"],
            "article_no": anchor, "title": title, "kind": "law", "version": law["version_id"],
            "last_amended": law.get("publication_date", ""), "status": "official_source",
            "body": text, "markdown": f"# {anchor} ({title})\n\n{text}\n",
            "metadata": metadata}
    response["nodes"] = [node]
    response["roots"] = [identifier]
    response["citation_existence_verified"] = True
    return response
