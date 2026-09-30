"""Map collected source changes to declared local references for review."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from .graph import GraphStore
from .legal_grounding import compact_name, extract_citations


def change_impacts(store: GraphStore, changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    graph = store.graph()
    nodes = graph["nodes"]
    by_id = {node["id"]: node for node in nodes}
    reverse: dict[str, set[str]] = defaultdict(set)
    for edge in graph["edges"]:
        reverse[edge["target"]].add(edge["source"])
        if edge["type"] == "uses_form":
            reverse[edge["source"]].add(edge["target"])
    names = [change["title"] for change in changes if change.get("title")]
    names += [node["rule_name"] for node in nodes]
    cited: dict[str, set[str]] = defaultdict(set)
    for node in nodes:
        for citation in extract_citations(node["body"], names):
            cited[compact_name(citation["law_name"])].add(node["id"])
    output = []
    for change in changes:
        title_key = compact_name(str(change.get("title", "")))
        matches = {node["id"] for node in nodes if title_key and compact_name(node["rule_name"]) == title_key
                   and (node["agency"] == "국가법령" or node["path"].startswith("statutes/")
                        or node["metadata"].get("official"))}
        direct = set(cited.get(title_key, set()))
        for source_id in matches:
            direct.update(reverse[source_id])
        # A direct version-bound reference is useful even without a local statute node.
        for node in nodes:
            if node["metadata"].get("official_law_id") == change.get("law_id"):
                direct.add(node["id"])
        visited = set(matches)
        queue = deque((node_id, 1) for node_id in sorted(direct - visited))
        impacted = []
        while queue:
            node_id, depth = queue.popleft()
            if node_id in visited:
                continue
            visited.add(node_id)
            node = by_id.get(node_id)
            if not node:
                continue
            if node["agency"] != "국가법령" and not node["path"].startswith("statutes/"):
                impacted.append({"id": node_id, "title": node["title"], "rule_name": node["rule_name"],
                                 "path": node["path"], "depth": depth,
                                 "demo": bool(node["metadata"].get("demo")),
                                 "reason": "법령명·일반 인용 또는 선언한 관계의 변경 영향 후보"})
            queue.extend((related, depth + 1) for related in sorted(reverse[node_id]) if related not in visited)
        output.append({**change, "impact": {"impacted_nodes": impacted, "count": len(impacted),
                       "scope": "declared_local_references", "applicability_verified": False,
                       "notice": "현재 규정집에 선언한 관계의 영향 후보입니다. 인용 누락·적용성은 별도 검토가 필요합니다."}})
    return output
