"""Official-law grounding and explicit citation checks, separate from legal opinions."""

from __future__ import annotations

from collections import deque
import re
import unicodedata
from typing import Any

from .graph import GraphStore, RELATIONS, WIKILINK_RE, _references, normalize_article


ARTICLE_SUFFIX = r"\s*제\s*(?P<number>\d+)\s*조(?:\s*의\s*(?P<sub>\d+))?(?:\s*제\s*(?P<paragraph>\d+)\s*항)?(?:\s*제\s*(?P<item>\d+)\s*호)?"
BRACKET_CITATION = re.compile(r"[「『](?P<law_name>[^」』\n]+)[」』]" + ARTICLE_SUFFIX)
BARE_CITATION = re.compile(r"(?P<law_name>(?:[가-힣A-Za-z0-9·]+[ \t]+){0,12}[가-힣A-Za-z0-9·]*(?:법률|법|시행령|시행규칙|규정|지침|조례|규칙))" + ARTICLE_SUFFIX)
MAX_GROUNDING_CHARS = 24_000
MAX_PASSAGE_CHARS = 6_000
MAX_SOURCES = 12


def compact_name(value: str) -> str:
    return re.sub(r"\s+", "", value).strip("「」『』")


def extract_citations(text: str, known_names: list[str] | None = None) -> list[dict]:
    """Recognize explicit named citations, including laws titled '…에 관한 법률'."""
    matches = list(BRACKET_CITATION.finditer(text))
    occupied = [(match.start(), match.end()) for match in matches]
    for name in sorted(set(known_names or []), key=len, reverse=True):
        compact = compact_name(name)
        if not compact:
            continue
        name_pattern = r"\s*".join(re.escape(character) for character in compact)
        expression = re.compile(r"(?P<law_name>" + name_pattern + ")" + ARTICLE_SUFFIX)
        for match in expression.finditer(text):
            if not any(start < match.end() and match.start() < end for start, end in occupied):
                matches.append(match)
                occupied.append((match.start(), match.end()))
    for match in BARE_CITATION.finditer(text):
        if not any(start < match.end() and match.start() < end for start, end in occupied):
            matches.append(match)
            occupied.append((match.start(), match.end()))
    result = []
    for match in sorted(matches, key=lambda candidate: candidate.start()):
        result.append({
            "law_name": match["law_name"].strip(),
            "article_no": normalize_article(match["number"] + ("의" + match["sub"] if match["sub"] else "")),
            "paragraph_no": match["paragraph"] or None,
            "item_no": match["item"] or None,
            "reference": match.group(0), "start": match.start(), "end": match.end(),
        })
    return result


def _issue(code: str, message: str, path: str = "", severity: str = "warning", **extra: Any) -> dict:
    return {"severity": severity, "code": code, "message": message, "path": path, **extra}


def _summary(law: dict, article: dict | None = None, **extra: Any) -> dict:
    return {
        "law_id": law.get("law_id"), "source": law.get("source"),
        "source_id": law.get("source_id"), "version_id": law.get("version_id"),
        "title": law.get("title"), "publication_date": law.get("publication_date"),
        "effective_date": law.get("effective_date"), "publication_no": law.get("publication_no"),
        "source_url": law.get("source_url"), "sha256": law.get("sha256") or law.get("raw_sha256"),
        "fetched_at": law.get("fetched_at"),
        "temporal_verified": law.get("temporal_verified", law.get("metadata", {}).get("temporal_verified", False)),
        "article_no": (article or {}).get("article_no"),
        "article_title": (article or {}).get("title"), **extra,
    }


def _safe_coverage(law_store: Any) -> dict:
    try:
        return law_store.coverage()
    except (OSError, ValueError, RuntimeError):
        return {"complete": False, "scope": "unknown", "sources": {}, "limitations": ["공식 법령 저장소 상태를 확인할 수 없습니다."]}


def _resolve(law_store: Any, citation: dict, as_of: str) -> dict:
    # A bare title may be preceded by prose (e.g. '근거는 개인정보 보호법').
    # Try increasingly shorter suffixes, accepting only the store's exact title match.
    name = citation["law_name"]
    candidates = [name] + [name[index + 1:].strip() for index, character in enumerate(name) if character.isspace()]
    fallback = {"found": False, "ambiguous": False, "law": None, "article": None}
    for candidate in dict.fromkeys(candidates):
        try:
            result = law_store.resolve_citation(candidate, citation["article_no"], as_of=as_of)
        except (OSError, ValueError, RuntimeError):
            continue
        if result.get("found") or result.get("law") or result.get("ambiguous"):
            return result
        fallback = result
    return fallback


def _unit_number(value: Any) -> str:
    text = str(value or "").strip()
    number = re.search(r"\d+", text)
    if number:
        return str(int(number[0]))
    if len(text) == 1:
        try:
            numeric = unicodedata.numeric(text)
            if numeric.is_integer() and numeric > 0:
                return str(int(numeric))
        except (TypeError, ValueError):
            pass
    return text


def _units_known(article: dict, law: dict | None) -> bool:
    warnings = []
    for value in (article, law or {}):
        warnings += list(value.get("parse_warnings") or [])
        warnings += list((value.get("metadata") or {}).get("parse_warnings") or [])
    uncertain = any(any(token in str(warning).lower() for token in ("unstructured", "unit_parse", "paragraph_parse", "text_only")) for warning in warnings)
    return "paragraphs" in article and not uncertain


def _reference_requests(store: GraphStore, node: dict, objective: str, additional_text: str = "") -> list[dict]:
    local_nodes = store.graph()["nodes"]
    known_names = [item["rule_name"] for item in local_nodes]
    requested = extract_citations(node["body"] + "\n" + objective + "\n" + additional_text, known_names)
    upper_graph = store.query(node["agency"], node["rule_name"], node["article_no"], "UPWARD_PARENT")
    related = list(upper_graph["nodes"])
    references = [reference for field in RELATIONS for reference in _references(node["metadata"].get(field))]
    references += [link.split("|", 1)[0] for link in WIKILINK_RE.findall(node["body"])]
    for reference in references:
        related.extend(store.resolve(reference, node["path"]))
    for item in related:
        if item["agency"] == "국가법령" or item["path"].startswith("statutes/") or item["metadata"].get("official"):
            requested.append({"law_name": item["rule_name"], "article_no": item["article_no"],
                              "paragraph_no": None, "item_no": None, "reference": item["id"],
                              "local_node_id": item["id"], "local_demo": bool(item["metadata"].get("demo"))})
    unique = {}
    for citation in requested:
        key = (compact_name(citation["law_name"]), citation["article_no"], citation.get("paragraph_no"), citation.get("item_no"))
        unique.setdefault(key, citation)
    return list(unique.values())


def build_grounding(store: GraphStore, node: dict, objective: str, as_of: str, law_store: Any, additional_text: str = "") -> dict:
    """Retrieve official passages without merging them into, or upgrading, demo documents."""
    coverage = _safe_coverage(law_store)
    issues = []
    sources: list[dict] = []
    requested = _reference_requests(store, node, objective, additional_text)
    unresolved = []
    used_chars = 0
    seen = set()

    def add_source(law: dict, article: dict | None, origin: str, **extra: Any) -> None:
        nonlocal used_chars
        key = (law.get("law_id"), law.get("version_id"), (article or {}).get("article_no"))
        if key in seen or len(sources) >= MAX_SOURCES:
            return
        seen.add(key)
        full_text = str((article or {}).get("text") or law.get("text") or "")
        if not full_text.strip():
            issues.append(_issue("official_text_missing", "공식 자료에 사용할 원문 본문이 없습니다.", node["path"], law_id=law.get("law_id")))
            return
        remaining = MAX_GROUNDING_CHARS - used_chars
        passage = full_text[:max(0, min(MAX_PASSAGE_CHARS, remaining))]
        used_chars += len(passage)
        sources.append(_summary(law, article, origin=origin, passage=passage,
                                passage_truncated=len(passage) < len(full_text), **extra))

    for citation in requested:
        resolved = _resolve(law_store, citation, as_of)
        if resolved.get("found") and resolved.get("law") and resolved.get("article"):
            add_source(resolved["law"], resolved["article"], "declared_citation", reference=citation["reference"],
                       local_node_id=citation.get("local_node_id"), local_demo=citation.get("local_demo", False))
        elif resolved.get("law") and resolved.get("article") and resolved.get("reason") == "historical_snapshot_unverified":
            add_source(resolved["law"], resolved["article"], "unverified_dated_citation", reference=citation["reference"])
            unresolved.append(citation)
            issues.append(_issue("official_citation_temporal_unverified", "공식 원문은 확보했지만 요청한 기준일의 시행 상태를 확인할 스냅샷이 없습니다.", node["path"], reference=citation["reference"]))
        else:
            unresolved.append(citation)
            issues.append(_issue("official_source_missing", f"기준일의 공식 원문을 확인하지 못했습니다: {citation['law_name']} {citation['article_no']}",
                                 node["path"], reference=citation["reference"], ambiguous=bool(resolved.get("ambiguous"))))
    # Search the objective as well as selected rule text; search candidates are evidence,
    # never a declaration that all legally applicable laws have been identified.
    queries = [objective] if objective.strip() else []
    queries += [token for token in re.findall(r"[가-힣A-Za-z0-9]{2,}", objective) if token not in {"개정", "목적", "절차", "정비", "규정"}][:5]
    for query in dict.fromkeys(queries):
        try:
            matches = law_store.search(query, as_of=as_of, limit=3).get("items", [])
        except (OSError, ValueError, RuntimeError):
            matches = []
        for summary in matches:
            if len(sources) >= MAX_SOURCES or used_chars >= MAX_GROUNDING_CHARS:
                break
            try:
                law = law_store.get(summary["law_id"], as_of=as_of)
            except (KeyError, OSError, ValueError, RuntimeError):
                law = None
            if not law:
                continue
            terms = [compact_name(term) for term in re.findall(r"[가-힣A-Za-z0-9]{2,}", objective)]
            provisions = law.get("provisions", [])
            ranked = sorted(provisions, key=lambda article: sum(term in compact_name(str(article.get("text", ""))) for term in terms), reverse=True)
            for article in ranked[:2]:
                add_source(law, article, "objective_search", search_query=query)
            if not provisions:
                add_source(law, None, "objective_search", search_query=query)
    if not sources:
        status = "source_unavailable"
        issues.append(_issue("source_unavailable", "입안에 사용할 공식 원문을 확보하지 못했습니다. 로컬 시연·기관 문서는 공식 법령 근거로 승격하지 않습니다.", node["path"]))
    elif unresolved or not coverage.get("complete") or any(not source.get("temporal_verified") for source in sources):
        status = "coverage_incomplete"
    else:
        status = "sources_available"
    if not coverage.get("complete"):
        issues.append(_issue("coverage_incomplete", "공식 법령 수집 범위가 완전하지 않습니다. 적용법 누락과 미수집 연혁은 추가 확인이 필요합니다.", node["path"]))
    return {"status": status, "as_of": as_of, "sources": sources,
            "requested_citations": requested, "unresolved_citations": unresolved,
            "corpus": coverage, "issues": issues,
            "official_sources_available": bool(sources), "applicable_laws_exhaustive": False,
            "interpretation_verified": False, "delegation_scope_verified": False,
            "requires_human_review": True}


def collect_grounding(store: GraphStore, node: dict, request: dict, law_store: Any) -> dict:
    """Public API for web/MCP callers; always use the proposed effective date."""
    as_of = str(request.get("effective_date") or request.get("as_of") or "")
    if not as_of:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        as_of = datetime.now(ZoneInfo("Asia/Seoul")).date().isoformat()
    return build_grounding(store, node, str(request.get("objective") or ""), as_of, law_store,
                           str(request.get("revised_markdown") or ""))


def check_citations(store: GraphStore, law_store: Any, text: str, path: str, as_of: str) -> list[dict]:
    """Check article/paragraph/item existence only when a dated official source is present."""
    nodes = store.graph()["nodes"]
    known_names = [node["rule_name"] for node in nodes]
    issues = []
    for citation in extract_citations(text, known_names):
        resolved = _resolve(law_store, citation, as_of)
        article = resolved.get("article")
        law = resolved.get("law")
        if resolved.get("reason") == "historical_snapshot_unverified" or (law and not law.get("temporal_verified", resolved.get("temporal_verified", False))):
            issues.append(_issue("official_citation_temporal_unverified", "공식 원문은 있으나 요청 기준일의 인용·시행 상태가 검증되지 않았습니다.", path, reference=citation["reference"]))
            continue
        if resolved.get("reason") == "article_deleted":
            issues.append(_issue("official_article_deleted", "선택한 기준일의 공식 원문에서 인용 조문이 삭제되어 있습니다.", path, "error", reference=citation["reference"]))
            continue
        if resolved.get("ambiguous"):
            issues.append(_issue("official_citation_ambiguous", "공식 법령명 또는 조문 인용이 여러 원문에 해당합니다. 법령 식별자를 확인하세요.", path, "error", reference=citation["reference"]))
            continue
        if not resolved.get("found") or not article:
            local_found = any(compact_name(node["rule_name"]) == compact_name(citation["law_name"]) and node["article_no"] == citation["article_no"] for node in nodes)
            parsing_warnings = (law or {}).get("metadata", {}).get("parse_warnings", [])
            article_uncertain = any("unparsed_provision" in str(warning) or "unparsed_article" in str(warning) for warning in parsing_warnings)
            if law and article_uncertain:
                issues.append(_issue("official_article_unverified", "공식 원문의 조문 구조를 완전히 파싱하지 못해 인용 조문의 부재를 확정할 수 없습니다.", path, reference=citation["reference"]))
            elif law and not resolved.get("ambiguous"):
                issues.append(_issue("official_article_missing", "선택한 기준일의 공식 법령에 인용 조문이 없습니다.", path, "error", reference=citation["reference"]))
            elif not local_found:
                issues.append(_issue("unverified_text_citation", f"로컬·공식 원문에서 인용을 확인할 수 없습니다: {citation['law_name']} {citation['article_no']}", path, "error", reference=citation["reference"]))
            if citation.get("paragraph_no") or citation.get("item_no"):
                issues.append(_issue("citation_unit_unverified", "공식 원문 미확보로 항·호의 존재를 확인하지 못했습니다.", path, reference=citation["reference"]))
            continue
        paragraph = None
        if (citation.get("paragraph_no") or citation.get("item_no")) and not _units_known(article, law):
            issues.append(_issue("citation_unit_unverified", "공식 원문은 확보했지만 항·호 구조를 확정적으로 파싱하지 못했습니다.", path, reference=citation["reference"]))
            continue
        if citation.get("paragraph_no"):
            paragraph = next((candidate for candidate in article.get("paragraphs", []) if _unit_number(candidate.get("paragraph_no")) == _unit_number(citation["paragraph_no"])), None)
            if paragraph is None:
                issues.append(_issue("official_paragraph_missing", "공식 조문에 인용 항이 없습니다.", path, "error", reference=citation["reference"]))
        if citation.get("item_no") and (paragraph is not None or not citation.get("paragraph_no")):
            items = paragraph.get("items", []) if paragraph is not None else [item for group in article.get("paragraphs", []) for item in group.get("items", [])]
            if not any(_unit_number(item.get("item_no")) == _unit_number(citation["item_no"]) for item in items):
                issues.append(_issue("official_item_missing", "공식 조문에 인용 호가 없습니다.", path, "error", reference=citation["reference"]))
    return issues


def add_text_impact(store: GraphStore, node: dict, impact: dict) -> dict:
    """Augment a preview with plain-text references and cycle-safe transitive backlinks."""
    if impact.get("changed") is False:
        return {**impact, "text_citation_impact_checked": True}
    graph = store.graph()
    local_nodes = graph["nodes"]
    known_names = [item["rule_name"] for item in local_nodes]
    index: dict[tuple[str, str], list[dict]] = {}
    id_groups: dict[str, list[dict]] = {}
    for item in local_nodes:
        index.setdefault((compact_name(item["rule_name"]), item["article_no"]), []).append(item)
        id_groups.setdefault(item["id"], []).append(item)
    unique_ids = {node_id: matches[0] for node_id, matches in id_groups.items() if len(matches) == 1}
    adjacency: dict[str, set[str]] = {}
    for edge in graph["edges"]:
        adjacency.setdefault(edge["target"], set()).add(edge["source"])
        if edge["type"] == "uses_form":
            adjacency.setdefault(edge["source"], set()).add(edge["target"])
    for candidate in local_nodes:
        for citation in extract_citations(candidate["body"], known_names):
            targets = index.get((compact_name(citation["law_name"]), citation["article_no"]), [])
            if len(targets) == 1:
                adjacency.setdefault(targets[0]["id"], set()).add(candidate["id"])
    existing = {item["id"]: item for item in impact.get("impacted_nodes", [])}
    visited = {node["id"]}
    queue = deque([(node["id"], 0)])
    while queue:
        current, depth = queue.popleft()
        for related in sorted(adjacency.get(current, set())):
            if related in visited:
                continue
            visited.add(related)
            found = unique_ids.get(related)
            previous_depth = existing.get(related, {}).get("depth")
            if found and (not isinstance(previous_depth, (int, float)) or depth + 1 < previous_depth):
                existing[related] = {**found, "depth": depth + 1, "reason": f"Declared or plain-text reference to {current}", "via": current, "relation": "TEXT_OR_GRAPH_REFERENCE"}
            queue.append((related, depth + 1))
    return {**impact, "impacted_nodes": sorted(existing.values(), key=lambda item: (
        item.get("depth") if isinstance(item.get("depth"), (int, float)) else 0, item["id"])),
            "text_citation_impact_checked": True}


def render_grounding_context(grounding: dict) -> str:
    parts = [f"공식 원문 조회 기준일: {grounding.get('as_of')}", f"근거 수집 상태: {grounding.get('status')}",
             "아래 자료는 공식 출처에서 별도로 보관한 원문입니다. 인용 존재 확인은 적법성·위임 범위 판단을 대신하지 않습니다."]
    for source in grounding.get("sources", []):
        parts.extend([f"\n[{source.get('law_id')} / {source.get('version_id')}] {source.get('title')} {source.get('article_no') or ''}",
                      f"시행일: {source.get('effective_date')} / 출처: {source.get('source_url')} / SHA-256: {source.get('sha256')}",
                      "원문 발췌 (길이 제한 적용)" if source.get("passage_truncated") else "조문 원문", source.get("passage", "")])
    if not grounding.get("sources"):
        parts.append("확보한 공식 근거가 없습니다. 시연 문서나 추측을 공식 법령으로 간주하지 마세요.")
    return "\n".join(parts)
