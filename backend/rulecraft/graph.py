"""Markdown legal-knowledge graph with explicit, reviewable link resolution."""

from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
import math
from pathlib import Path, PurePosixPath
import re
import tempfile
from typing import Any

import yaml


ARTICLE_RE = re.compile(r"^(?:제\s*)?(\d+)\s*(?:조)?\s*(?:의\s*(\d+))?$")
WIKILINK_RE = re.compile(r"(?<!\\)\[\[([^\]\n]+)\]\]")
RELATIONS = {"delegated_by": "delegated_by", "cites": "CITES", "CITES": "CITES", "uses_form": "uses_form"}
REQUIRED = ("agency", "rule_name", "title")


class FrontmatterLoader(yaml.SafeLoader):
    """Reject ambiguous duplicate fields and YAML aliases in document metadata."""

    def compose_node(self, parent: Any, index: Any) -> Any:
        if self.check_event(yaml.AliasEvent):
            event = self.get_event()
            raise yaml.YAMLError(f"YAML aliases are unsupported at {event.start_mark}.")
        return super().compose_node(parent, index)

    def construct_mapping(self, node: Any, deep: bool = False) -> dict:
        self.flatten_mapping(node)
        keys = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                if key in keys:
                    raise yaml.YAMLError("Duplicate YAML metadata field.")
                keys.add(key)
            except TypeError:
                raise yaml.YAMLError("YAML metadata keys must be scalar values.") from None
        return super().construct_mapping(node, deep=deep)


def normalize_article(value: Any) -> str:
    """Canonical article anchor, including supplementary articles such as 제7조의2."""
    if value is None or isinstance(value, bool):
        return ""
    match = ARTICLE_RE.fullmatch(str(value).strip())
    if not match or int(match[1]) < 1 or (match[2] and int(match[2]) < 1):
        return ""
    return f"제{int(match[1])}조" + (f"의{int(match[2])}" if match[2] else "")


def _issue(code: str, message: str, path: str = "", node_id: str = "", severity: str = "error", **extra: Any) -> dict:
    return {"severity": severity, "code": code, "message": message, "path": path, "node_id": node_id, **extra}


def _as_text(value: Any) -> str:
    return "" if value is None else str(value)


def _references(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        links = WIKILINK_RE.findall(value)
        return [link.split("|", 1)[0].strip() for link in links] if links else [value.strip()]
    if isinstance(value, list):
        return [reference for item in value for reference in _references(item)]
    if isinstance(value, dict):
        return _references(value.get("target", value.get("id", value.get("path"))))
    return []


def _valid_reference_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return all(_valid_reference_value(item) for item in value)
    if isinstance(value, dict):
        target = value.get("target", value.get("id", value.get("path")))
        return target is not None and _valid_reference_value(target)
    return False


def parse_markdown(markdown: str, path: str) -> tuple[dict, list[dict]]:
    """Parse YAML safely. Invalid YAML remains inspectable instead of crashing refresh."""
    issues: list[dict] = []
    metadata: dict[str, Any] = {}
    body = markdown
    lines = markdown.lstrip("\ufeff").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        issues.append(_issue("missing_frontmatter", "YAML frontmatter is required.", path))
    else:
        closing = next((index for index in range(1, len(lines)) if lines[index].strip() in {"---", "..."}), None)
        if closing is None:
            issues.append(_issue("unclosed_frontmatter", "YAML frontmatter has no closing delimiter.", path))
        else:
            try:
                parsed = yaml.load("".join(lines[1:closing]), Loader=FrontmatterLoader)
                if not isinstance(parsed, dict):
                    issues.append(_issue("invalid_frontmatter", "YAML frontmatter must be a mapping.", path))
                else:
                    metadata = parsed
            except (yaml.YAMLError, RecursionError) as error:
                # Include position, never a whole YAML document that might contain credentials.
                mark = getattr(error, "problem_mark", None)
                location = f" at line {mark.line + 2}" if mark else ""
                issues.append(_issue("invalid_yaml", f"Cannot parse YAML frontmatter{location}.", path))
            body = "".join(lines[closing + 1:])

    agency = metadata.get("agency", metadata.get("agency_name", metadata.get("institution", "")))
    article = normalize_article(metadata.get("article_no"))
    kind = _as_text(metadata.get("kind", "article"))
    node_id = _as_text(metadata.get("id")) or str(PurePosixPath(path).with_suffix(""))
    node = {
        "id": node_id,
        "path": path,
        "agency": _as_text(agency),
        "rule_name": _as_text(metadata.get("rule_name")),
        "article_no": article,
        "title": _as_text(metadata.get("title")),
        "kind": kind,
        "version": _as_text(metadata.get("version")),
        "last_amended": _as_text(metadata.get("last_amended")),
        "status": _as_text(metadata.get("status", "draft")),
        "body": body,
        "markdown": markdown,
        "metadata": _json_safe(metadata),
    }
    for field in REQUIRED:
        if not node[field].strip():
            issues.append(_issue("missing_metadata", f"Required metadata '{field}' is missing.", path, node_id, field=field))
        raw_value = agency if field == "agency" else metadata.get(field)
        if raw_value is not None and not isinstance(raw_value, str):
            issues.append(_issue("invalid_metadata", f"Metadata '{field}' must be a string.", path, node_id, field=field))
    if kind in {"article", "law", "regulation", "rule"} and not article:
        issues.append(_issue("invalid_article_no", "article_no must identify a positive article, for example 제7조의2.", path, node_id, field="article_no"))
    elif metadata.get("article_no") is not None and not article:
        issues.append(_issue("invalid_article_no", "The supplied article_no is invalid.", path, node_id, field="article_no"))
    if article and kind in {"article", "law", "regulation", "rule"}:
        heading = re.search(r"^#\s+(제\s*\d+\s*조(?:\s*의\s*\d+)?)", body, re.MULTILINE)
        if heading and normalize_article(heading[1]) != article:
            issues.append(_issue("heading_article_mismatch", "The article heading number differs from article_no metadata.", path, node_id, field="article_no", heading=heading[1]))
    if not isinstance(metadata.get("id", node_id), str) or not node_id.strip():
        issues.append(_issue("invalid_id", "id must be a nonempty string.", path, node_id))
    for field in RELATIONS:
        value = metadata.get(field)
        if value is not None and not _valid_reference_value(value):
            issues.append(_issue("invalid_relation", f"'{field}' must contain a reference or a list of references.", path, node_id, field=field))
    for issue in issues:
        issue["node_id"] = node_id
    return node, issues


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


class GraphStore:
    def __init__(self, vault: Path | str):
        self.vault = Path(vault).resolve()
        self._documents: dict[str, str] = {}
        self._nodes: list[dict] = []
        self._edges: list[dict] = []
        self._issues: list[dict] = []
        self._ids: dict[str, list[dict]] = {}
        self.refresh()

    def safe_path(self, source_path: str | Path) -> Path:
        raw = str(source_path).replace("\\", "/")
        if raw.startswith("/vault/"):
            raw = raw[len("/vault/"):]
        path = Path(raw)
        resolved = (path if path.is_absolute() else self.vault / path).resolve()
        if not resolved.is_relative_to(self.vault) or resolved.suffix.lower() != ".md":
            raise ValueError("Target must be a Markdown file inside the configured vault.")
        return resolved

    def relative_path(self, source_path: str | Path) -> str:
        return self.safe_path(source_path).relative_to(self.vault).as_posix()

    def refresh(self) -> dict:
        documents: dict[str, str] = {}
        read_issues: list[dict] = []
        if self.vault.exists():
            for path in sorted(self.vault.rglob("*.md")):
                if not path.resolve().is_relative_to(self.vault):
                    read_issues.append(_issue("outside_vault_symlink", "Markdown symlink points outside the vault.", path.relative_to(self.vault).as_posix()))
                    continue
                relative = path.relative_to(self.vault).as_posix()
                try:
                    documents[relative] = path.read_text(encoding="utf-8")
                except (OSError, UnicodeError) as error:
                    read_issues.append(_issue("unreadable_markdown", str(error), relative))
        self._documents = documents
        self._build(documents)
        self._issues.extend(read_issues)
        return self.graph()

    @classmethod
    def from_documents(cls, vault: Path, documents: dict[str, str]) -> "GraphStore":
        instance = cls.__new__(cls)
        instance.vault = Path(vault).resolve()
        instance._documents = dict(documents)
        instance._build(instance._documents)
        return instance

    def _build(self, documents: dict[str, str]) -> None:
        nodes: list[dict] = []
        issues: list[dict] = []
        ids: dict[str, list[dict]] = defaultdict(list)
        for path, markdown in sorted(documents.items()):
            node, parse_issues = parse_markdown(markdown, path)
            nodes.append(node)
            ids[node["id"]].append(node)
            issues.extend(parse_issues)
        for node_id, matches in ids.items():
            if len(matches) > 1:
                for node in matches:
                    issues.append(_issue("duplicate_id", f"Duplicate node id '{node_id}'.", node["path"], node_id, candidates=[match["path"] for match in matches]))
        article_groups: dict[tuple, list[dict]] = defaultdict(list)
        for node in nodes:
            if node["article_no"]:
                article_groups[(node["agency"], node["rule_name"], node["article_no"])].append(node)
        for matches in article_groups.values():
            if len(matches) > 1:
                for node in matches:
                    issues.append(_issue("duplicate_article", "Multiple files identify the same agency, rule, and article.", node["path"], node["id"], candidates=[match["path"] for match in matches]))
        self._nodes, self._ids = nodes, dict(ids)
        edges: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        for node in nodes:
            references: list[tuple[str, str]] = []
            for key, edge_type in RELATIONS.items():
                references.extend((reference, edge_type) for reference in _references(node["metadata"].get(key)))
            references.extend((link.split("|", 1)[0].strip(), "REFERENCES") for link in WIKILINK_RE.findall(node["body"]))
            for reference, edge_type in references:
                if not reference:
                    continue
                matches = self.resolve(reference, node["path"])
                if not matches:
                    issues.append(_issue("missing_target", f"Unresolved reference '{reference}'.", node["path"], node["id"], reference=reference, relation=edge_type))
                elif len(matches) > 1:
                    issues.append(_issue("ambiguous_target", f"Reference '{reference}' matches multiple nodes.", node["path"], node["id"], reference=reference, relation=edge_type, candidates=[match["path"] for match in matches]))
                else:
                    target = matches[0]
                    key = (node["id"], target["id"], edge_type)
                    if key not in seen:
                        edges.append({"source": node["id"], "target": target["id"], "type": edge_type})
                        seen.add(key)
        # Duplicate mentions in frontmatter and body should not repeat the same problem.
        unique_issues = {repr(sorted(issue.items())): issue for issue in issues}
        self._edges = edges
        self._issues = list(unique_issues.values())

    def resolve(self, reference: str, source_path: str = "") -> list[dict]:
        raw = reference.strip()
        if raw.startswith("[[") and raw.endswith("]]"):
            raw = raw[2:-2]
        raw = raw.split("|", 1)[0].strip().replace("\\", "/")
        if raw in self._ids:
            return list(self._ids[raw])
        target, _, anchor = raw.partition("#")
        article_anchor = normalize_article(anchor)
        if target in self._ids:
            return [node for node in self._ids[target] if not anchor or self._anchor_matches(node, anchor, article_anchor)]
        target = target.rstrip("/")
        absolute = target.startswith("/")
        if target.startswith("/vault/"):
            target = target[len("/vault/"):]
        elif target == "/vault":
            target = ""
        elif absolute:
            target = target.lstrip("/")
        source_directory = str(PurePosixPath(source_path).parent)
        # Explicit relative paths prefer the source directory; root links prefer the vault root.
        candidates: list[str] = []
        if not absolute:
            candidates.append(_normalize_link_path(f"{source_directory}/{target}"))
        candidates.append(_normalize_link_path(target))
        if not target:
            if source_path and not absolute:
                candidates.insert(0, source_path)
            else:
                candidates = [""]
        for candidate in dict.fromkeys(candidates):
            if candidate is None:
                continue
            matches = []
            for node in self._nodes:
                path = node["path"]
                stem = str(PurePosixPath(path).with_suffix(""))
                exact = path == candidate or stem == candidate
                directory = bool(anchor) and (candidate == "" or path.startswith(candidate + "/"))
                if exact or directory:
                    if anchor and not self._anchor_matches(node, anchor, article_anchor):
                        continue
                    matches.append(node)
            if matches:
                return matches
        # Obsidian permits basename and rule-name references; ambiguity is reported, never guessed.
        matches = []
        if target and "/" not in target and target not in {".", ".."}:
            for node in self._nodes:
                stem = PurePosixPath(node["path"]).stem
                names = {stem, node["rule_name"], node["title"]}
                if target.removesuffix(".md") in names:
                    if not anchor or self._anchor_matches(node, anchor, article_anchor):
                        matches.append(node)
        return matches

    @staticmethod
    def _anchor_matches(node: dict, anchor: str, article_anchor: str) -> bool:
        if article_anchor:
            return node["article_no"] == article_anchor
        clean_anchor = anchor.strip().lstrip("^")
        headings = [match.group(1).strip().rstrip("#").strip() for match in re.finditer(r"^#{1,6}\s+(.+)$", node["body"], re.MULTILINE)]
        return clean_anchor in {node["title"], node["id"], *headings}

    def graph(self) -> dict:
        return deepcopy({"nodes": self._nodes, "edges": self._edges, "issues": self._issues})

    def get(self, node_id: str) -> dict | None:
        matches = self._ids.get(node_id, [])
        return deepcopy(matches[0]) if len(matches) == 1 else None

    def query(self, agency_name: str = "", rule_name: str = "", article_no: str = "", traverse_direction: str = "ALL") -> dict:
        direction = traverse_direction.upper()
        if direction not in {"UPWARD_PARENT", "DOWNWARD_DELEGATION", "BACKLINKS", "ALL"}:
            raise ValueError("Unknown traverse_direction.")
        canonical = normalize_article(article_no)
        if article_no and not canonical:
            return {"nodes": [], "edges": [], "issues": [_issue("invalid_article_no", "The query article number is invalid.")], "roots": [], "traverse_direction": direction}
        roots = [node["id"] for node in self._nodes if (not agency_name or agency_name.casefold() in node["agency"].casefold()) and (not rule_name or rule_name.casefold() in node["rule_name"].casefold()) and (not article_no or node["article_no"] == canonical)]
        adjacency: dict[str, set[str]] = defaultdict(set)
        for edge in self._edges:
            source, target, edge_type = edge["source"], edge["target"], edge["type"]
            if direction == "ALL":
                adjacency[source].add(target)
                adjacency[target].add(source)
            elif direction == "UPWARD_PARENT" and edge_type == "delegated_by":
                adjacency[source].add(target)
            elif direction == "DOWNWARD_DELEGATION" and edge_type == "delegated_by":
                adjacency[target].add(source)
            elif direction == "BACKLINKS":
                adjacency[target].add(source)
        visited = set(roots)
        queue = deque(roots)
        while queue:
            for neighbor in sorted(adjacency[queue.popleft()]):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        return deepcopy({"nodes": [node for node in self._nodes if node["id"] in visited], "edges": [edge for edge in self._edges if edge["source"] in visited and edge["target"] in visited], "issues": [issue for issue in self._issues if issue["node_id"] in visited], "roots": roots, "traverse_direction": direction})

    def backlinks(self, node_id: str, transitive: bool = True) -> list[dict]:
        adjacency: dict[str, list[dict]] = defaultdict(list)
        for edge in self._edges:
            adjacency[edge["target"]].append(edge)
        visited = {node_id}
        queue = deque([(node_id, 0)])
        results = []
        while queue:
            target, depth = queue.popleft()
            for edge in sorted(adjacency[target], key=lambda item: (item["source"], item["type"])):
                source = edge["source"]
                if source in visited:
                    continue
                visited.add(source)
                node = self.get(source)
                if node:
                    results.append({**node, "depth": depth + 1, "reason": f"{edge['type']} → {target}", "via": target, "relation": edge["type"]})
                if transitive:
                    queue.append((source, depth + 1))
        return results

    def validate(self, markdown: str, source_path: str | Path) -> dict:
        relative = self.relative_path(source_path)
        documents = {**self._documents, relative: markdown}
        overlay = self.from_documents(self.vault, documents)
        node = next(node for node in overlay._nodes if node["path"] == relative)
        baseline = {_issue_identity(issue) for issue in self._issues}
        issues = [issue for issue in overlay._issues if issue["path"] == relative or _issue_identity(issue) not in baseline]
        return {"valid": not any(issue["severity"] == "error" for issue in issues), "issues": deepcopy(issues), "node": deepcopy(node)}

    def save(self, node_id: str, markdown: str) -> dict:
        node = self.get(node_id)
        if node is None:
            raise KeyError(f"Unknown or ambiguous node id: {node_id}")
        validation = self.validate(markdown, node["path"])
        if not validation["valid"]:
            raise ValueError("Markdown validation failed.")
        if validation["node"]["id"] != node_id:
            raise ValueError("Node id cannot change when saving an existing node.")
        path = self.safe_path(node["path"])
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".rulecraft-", suffix=".tmp", dir=path.parent, delete=False) as handle:
                handle.write(markdown)
                temporary = Path(handle.name)
            temporary.replace(path)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        self.refresh()
        return self.get(node_id) or validation["node"]


def _issue_identity(issue: dict) -> tuple:
    return (issue["code"], issue["path"], issue.get("reference"), issue.get("field"), issue.get("message"))


def _normalize_link_path(value: str) -> str | None:
    parts: list[str] = []
    for part in value.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(part)
    return "/".join(parts)
