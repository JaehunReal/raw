"""Strict revision previews and Git-backed impact analysis; never mutates the vault."""

from __future__ import annotations

from collections import defaultdict, deque
import ast
from pathlib import Path
import posixpath
import re
import subprocess
from typing import Any

from .graph import GraphStore, RELATIONS, WIKILINK_RE, _normalize_link_path, _references, normalize_article


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$")
MAX_DIFF_BYTES = 2_000_000


class PatchError(ValueError):
    pass


def _diff_filename(header: str) -> str:
    """Decode Git's quoted UTF-8/octally escaped pathnames without evaluating code."""
    raw = header.rstrip("\r\n")
    if not raw.startswith('"'):
        return raw.split("\t", 1)[0]
    quoted = re.match(r'^("(?:[^"\\]|\\.)*")(?:\t.*)?$', raw)
    if not quoted:
        raise PatchError("Invalid quoted diff filename.")
    try:
        decoded = ast.literal_eval(quoted[1])
        if not isinstance(decoded, str):
            raise ValueError("Not a path string")
        # C-style octal escape sequences encode UTF-8 bytes; literal Unicode stays intact.
        if re.search(r"\\[0-7]{3}", quoted[1]):
            decoded = decoded.encode("latin-1").decode("utf-8")
        return decoded
    except (SyntaxError, ValueError, UnicodeError):
        raise PatchError("Cannot decode the quoted diff filename.") from None


def _problem(code: str, message: str, path: str = "", **extra: Any) -> dict:
    return {"severity": "error", "code": code, "message": message, "path": path, "node_id": "", **extra}


def is_unified_diff(value: str) -> bool:
    return value.startswith("diff --git ") or bool(re.search(r"(?m)^--- [^\n]*\n\+\+\+ ", value))


def apply_unified_diff(original: str, patch: str) -> tuple[str, bool]:
    """Apply a single-file unified patch using exact context and validated hunk counts."""
    if len(patch.encode("utf-8")) > MAX_DIFF_BYTES:
        raise PatchError("The proposed diff exceeds the 2 MB limit.")
    lines = patch.splitlines(keepends=True)
    old_header = new_header = None
    index = 0
    while index < len(lines) and not lines[index].startswith("--- "):
        if lines[index].startswith("@@"):
            raise PatchError("Unified diff file headers are required.")
        index += 1
    if index >= len(lines) or index + 1 >= len(lines) or not lines[index + 1].startswith("+++ "):
        raise PatchError("Unified diff requires --- and +++ file headers.")
    old_header = _diff_filename(lines[index][4:])
    new_header = _diff_filename(lines[index + 1][4:])
    deleted = new_header == "/dev/null"
    if old_header == "/dev/null" and original:
        raise PatchError("A creation patch cannot replace an existing nonempty file.")
    index += 2
    original_lines = original.splitlines(keepends=True)
    output: list[str] = []
    cursor = 0
    hunks = 0
    while index < len(lines):
        if not lines[index].strip():
            index += 1
            continue
        header = HUNK_RE.fullmatch(lines[index].rstrip("\r\n"))
        if not header:
            raise PatchError("Unexpected content outside a unified-diff hunk; only one file is supported.")
        hunks += 1
        old_start, old_count = int(header[1]), int(header[2] if header[2] is not None else 1)
        new_start, new_count = int(header[3]), int(header[4] if header[4] is not None else 1)
        # Empty ranges point after the previous line, whereas nonempty ranges are 1-based.
        old_index = old_start if old_count == 0 else old_start - 1
        new_index = new_start if new_count == 0 else new_start - 1
        if old_index < cursor or old_index > len(original_lines) or (old_count and old_start < 1) or (new_count and new_start < 1):
            raise PatchError("Hunk positions overlap or fall outside the original file.")
        output.extend(original_lines[cursor:old_index])
        if new_index != len(output):
            raise PatchError("The new-file hunk position does not match the preceding output.")
        cursor = old_index
        index += 1
        hunk: list[tuple[str, str]] = []
        while index < len(lines) and not lines[index].startswith("@@"):
            line = lines[index]
            if line.rstrip("\r\n") == "\\ No newline at end of file":
                if not hunk:
                    raise PatchError("Invalid no-newline marker.")
                prefix, content = hunk[-1]
                hunk[-1] = (prefix, content.rstrip("\r\n"))
            elif line and line[0] in {" ", "+", "-"}:
                # A second file header must not be mistaken for content.
                if line.startswith("--- ") and index + 1 < len(lines) and lines[index + 1].startswith("+++ "):
                    raise PatchError("Only one target file may appear in a proposed diff.")
                hunk.append((line[0], line[1:]))
            else:
                raise PatchError("Every hunk line must begin with a space, +, or -.")
            index += 1
        consumed = sum(prefix in {" ", "-"} for prefix, _ in hunk)
        produced = sum(prefix in {" ", "+"} for prefix, _ in hunk)
        if consumed != old_count or produced != new_count:
            raise PatchError("Hunk line counts do not match the declared ranges.")
        for prefix, content in hunk:
            if prefix in {" ", "-"}:
                if cursor >= len(original_lines) or original_lines[cursor] != content:
                    raise PatchError(f"Patch context does not match the original at line {cursor + 1}.")
                cursor += 1
            if prefix in {" ", "+"}:
                output.append(content)
    if not hunks:
        raise PatchError("The diff contains no hunks.")
    output.extend(original_lines[cursor:])
    revised = "".join(output)
    if deleted and revised:
        raise PatchError("A deletion patch must remove the complete file.")
    return revised, deleted


def _node_at(store: GraphStore, path: str) -> dict | None:
    return next((node for node in store.graph()["nodes"] if node["path"] == path), None)


def _merge_impacts(stores_and_ids: list[tuple[GraphStore, str]], exclude: set[str]) -> list[dict]:
    merged: dict[str, dict] = {}
    for store, node_id in stores_and_ids:
        for impacted in _impact_dependencies(store, node_id):
            if impacted["id"] in exclude:
                continue
            previous = merged.get(impacted["id"])
            if previous is None or impacted["depth"] < previous["depth"]:
                merged[impacted["id"]] = impacted
    return sorted(merged.values(), key=lambda item: (item["depth"], item["agency"], item["rule_name"], item["article_no"], item["id"]))


def _impact_dependencies(store: GraphStore, node_id: str) -> list[dict]:
    """Backlinks plus forms governed by an affected article's uses_form relation."""
    neighbors: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for edge in store.graph()["edges"]:
        neighbors[edge["target"]].append((edge["source"], edge["type"], "backlink"))
        if edge["type"] == "uses_form":
            neighbors[edge["source"]].append((edge["target"], edge["type"], "attached_form"))
    visited = {node_id}
    queue = deque([(node_id, 0)])
    impacted = []
    while queue:
        current, depth = queue.popleft()
        for related, relation, direction in sorted(neighbors[current]):
            if related in visited:
                continue
            visited.add(related)
            node = store.get(related)
            if node:
                reason = f"{relation} → {current}" if direction == "backlink" else f"Form used by affected article {current}"
                impacted.append({**node, "depth": depth + 1, "reason": reason, "via": current, "relation": relation})
            queue.append((related, depth + 1))
    return impacted


def _suggest_links(before_store: GraphStore, before: dict | None, after: dict | None) -> list[dict]:
    if not before or not after:
        return []
    if before["id"] == after["id"] and before["article_no"] == after["article_no"] and before["path"] == after["path"]:
        return []
    edits: list[dict] = []
    seen: set[tuple] = set()
    for node in before_store.graph()["nodes"]:
        references = [(reference, field) for field in RELATIONS for reference in _references(node["metadata"].get(field))]
        references += [(link.split("|", 1)[0].strip(), "body") for link in WIKILINK_RE.findall(node["body"])]
        for reference, field in references:
            matches = before_store.resolve(reference, node["path"])
            if len(matches) != 1 or matches[0]["path"] != before["path"]:
                continue
            replacement = reference
            if reference == before["id"]:
                replacement = after["id"]
            elif "#" in reference:
                prefix, anchor = reference.split("#", 1)
                if normalize_article(anchor) == before["article_no"] and after["article_no"]:
                    replacement = prefix + "#" + after["article_no"]
            if before["path"] != after["path"]:
                replacement = _renamed_reference(replacement, reference, node["path"], before, after)
            if replacement == reference:
                continue
            key = (node["path"], reference, replacement, field)
            if key not in seen:
                edits.append({"node_id": node["id"], "path": node["path"], "field": field, "before": reference, "after": replacement, "reason": "Referenced article identity or number changed; review this structural link correction."})
                seen.add(key)
    return edits


def _renamed_reference(replacement: str, original: str, source_path: str, before: dict, after: dict) -> str:
    target, separator, anchor = replacement.partition("#")
    original_target = original.partition("#")[0]
    if original_target == before["id"]:
        return after["id"] + (separator + anchor if separator else "")
    source_directory = posixpath.dirname(source_path)
    absolute = original_target.startswith("/")
    old_target = original_target.removeprefix("/vault/").lstrip("/")
    possible_paths = {_normalize_link_path(old_target)}
    if not absolute:
        possible_paths.add(_normalize_link_path(posixpath.join(source_directory, old_target)))
    old_stem = str(Path(before["path"]).with_suffix(""))
    is_file = before["path"] in possible_paths or old_stem in possible_paths
    basename = old_target in {Path(before["path"]).name, Path(before["path"]).stem}
    if is_file or basename:
        new_target = after["path"] if original_target.endswith(".md") else str(Path(after["path"]).with_suffix(""))
    elif separator:
        # A directory#article link must follow the moved article's directory.
        if posixpath.dirname(before["path"]) == posixpath.dirname(after["path"]):
            return replacement
        new_target = posixpath.dirname(after["path"])
    else:
        return replacement
    if absolute:
        new_target = ("/vault/" if original_target.startswith("/vault/") else "/") + new_target
    elif is_file or separator:
        new_target = posixpath.relpath(new_target, source_directory or ".")
        if original_target.startswith("./") and not new_target.startswith("../"):
            new_target = "./" + new_target
    else:
        new_target = posixpath.basename(new_target)
    return new_target + (separator + anchor if separator else "")


def _comparison(before_store: GraphStore, after_store: GraphStore, old_path: str | None, new_path: str | None) -> dict:
    before = _node_at(before_store, old_path) if old_path else None
    after = _node_at(after_store, new_path) if new_path else None
    old_markdown = before_store._documents.get(old_path or "")
    new_markdown = after_store._documents.get(new_path or "")
    changed = old_markdown != new_markdown or old_path != new_path
    ids = {node["id"] for node in (before, after) if node}
    stores_and_ids = [(store, node["id"]) for store, node in ((before_store, before), (after_store, after)) if node]
    impacts = _merge_impacts(stores_and_ids, ids) if changed else []
    affected_paths = {path for path in (old_path, new_path) if path} | {node["path"] for node in impacts}
    baseline = {(issue["code"], issue["path"], issue.get("reference"), issue["message"]) for issue in before_store.graph()["issues"]}
    issues = [issue for issue in after_store.graph()["issues"] if issue["path"] in affected_paths or (issue["code"], issue["path"], issue.get("reference"), issue["message"]) not in baseline]
    suggestions = _suggest_links(before_store, before, after) if changed else []
    return {"target_file_path": new_path or old_path, "before": before, "after": after, "changed": changed, "change_type": "deleted" if before and not after else "added" if after and not before else "renamed" if old_path != new_path else "modified", "impacted_nodes": impacts, "suggested_link_edits": suggestions, "issues": issues, "requires_human_review": changed}


def analyze(store: GraphStore, target_file_path: str, proposed_diff: str) -> dict:
    """Preview revised Markdown or an exact unified diff, with old-graph deletion impact."""
    try:
        relative = store.relative_path(target_file_path)
    except ValueError as error:
        return {"target_file_path": target_file_path, "before": None, "after": None, "changed": False, "impacted_nodes": [], "suggested_link_edits": [], "issues": [_problem("unsafe_path", str(error), target_file_path)], "requires_human_review": False}
    original = store._documents.get(relative, "")
    try:
        if not isinstance(proposed_diff, str):
            raise PatchError("proposed_diff must be a string.")
        if is_unified_diff(proposed_diff):
            headers = re.search(r"(?m)^--- ([^\n]+)\n\+\+\+ ([^\n]+)", proposed_diff)
            allowed = {relative, store.vault.name + "/" + relative, str(store.safe_path(relative))}
            for header in headers.groups() if headers else ():
                filename = _diff_filename(header)
                if filename.startswith(("a/", "b/")):
                    filename = filename[2:]
                if filename != "/dev/null" and filename not in allowed:
                    raise PatchError("Unified diff headers do not match the requested target file.")
            revised, deleted = apply_unified_diff(original, proposed_diff)
        else:
            revised, deleted = proposed_diff, False
    except PatchError as error:
        return {"target_file_path": relative, "before": _node_at(store, relative), "after": None, "changed": False, "impacted_nodes": [], "suggested_link_edits": [], "issues": [_problem("invalid_diff", str(error), relative)], "requires_human_review": False}
    documents = dict(store._documents)
    if deleted:
        documents.pop(relative, None)
    else:
        documents[relative] = revised
    overlay = GraphStore.from_documents(store.vault, documents)
    return _comparison(store, overlay, relative if relative in store._documents else None, None if deleted else relative)


def _git(repo: Path, *arguments: str, binary: bool = False) -> str | bytes:
    process = subprocess.run(["git", "-C", str(repo), *arguments], capture_output=True, text=not binary, timeout=30, check=False)
    if process.returncode:
        stderr = process.stderr.decode("utf-8", "replace") if binary else process.stderr
        raise ValueError(f"Git operation failed: {stderr.strip()[:300]}")
    return process.stdout


def _verified_ref(repo: Path, ref: str) -> str:
    if not ref or ref.startswith("-") or "\x00" in ref:
        raise ValueError("Invalid Git reference.")
    return str(_git(repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")).strip()


def _git_documents(repo: Path, prefix: str, ref: str) -> dict[str, str]:
    tree = _git(repo, "ls-tree", "-r", "-z", ref, "--", prefix or ".", binary=True)
    documents = {}
    for entry in tree.split(b"\0"):
        if not entry:
            continue
        descriptor, filename = entry.split(b"\t", 1)
        mode, kind, object_id = descriptor.split(b" ", 2)
        # Git symlink blobs contain their destination rather than Markdown.
        if kind != b"blob" or mode == b"120000":
            continue
        path = filename.decode("utf-8")
        if not path.lower().endswith(".md"):
            continue
        relative = path[len(prefix):].lstrip("/") if prefix else path
        blob = _git(repo, "cat-file", "blob", object_id.decode("ascii"), binary=True)
        try:
            documents[relative] = blob.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError(f"Git Markdown file is not valid UTF-8: {relative}") from None
    return documents


def analyze_git(store: GraphStore, base_ref: str = "HEAD", head_ref: str | None = None) -> dict:
    """Compare two committed snapshots, or a base commit against current vault files."""
    try:
        repo = Path(str(_git(store.vault, "rev-parse", "--show-toplevel")).strip()).resolve()
        if not store.vault.is_relative_to(repo):
            raise ValueError("The vault must be inside its Git repository.")
        prefix = store.vault.relative_to(repo).as_posix()
        if prefix == ".":
            prefix = ""
        base = _verified_ref(repo, base_ref)
        head = _verified_ref(repo, head_ref) if head_ref else None
        before_docs = _git_documents(repo, prefix, base)
        if head:
            after_docs = _git_documents(repo, prefix, head)
        else:
            store.refresh()
            after_docs = dict(store._documents)
        before_store = GraphStore.from_documents(store.vault, before_docs)
        after_store = GraphStore.from_documents(store.vault, after_docs)
        removed = set(before_docs) - set(after_docs)
        added = set(after_docs) - set(before_docs)
        # Git rename detection includes edited renames for committed snapshots; working-tree
        # additions may be untracked, so stable node ids supply an additional safe match.
        renames: dict[str, str] = {}
        if head:
            status = _git(repo, "diff", "--name-status", "-z", "--find-renames", base, head, "--", prefix or ".", binary=True).split(b"\0")
            index = 0
            while index < len(status) and status[index]:
                code = status[index].decode("ascii")
                if code.startswith("R"):
                    old = status[index + 1].decode("utf-8")
                    new = status[index + 2].decode("utf-8")
                    old = old[len(prefix):].lstrip("/") if prefix else old
                    new = new[len(prefix):].lstrip("/") if prefix else new
                    if old in removed and new in added:
                        renames[old] = new
                    index += 3
                else:
                    index += 2
        for old in sorted(removed - set(renames)):
            old_node = _node_at(before_store, old)
            matches = [new for new in added - set(renames.values()) if old_node and (_node_at(after_store, new) or {}).get("id") == old_node["id"]]
            if len(matches) == 1:
                renames[old] = matches[0]
        changes = [_comparison(before_store, after_store, old, new) for old, new in sorted(renames.items())]
        changes.extend(_comparison(before_store, after_store, path, None) for path in sorted(removed - set(renames)))
        changes.extend(_comparison(before_store, after_store, None, path) for path in sorted(added - set(renames.values())))
        changes.extend(_comparison(before_store, after_store, path, path) for path in sorted(set(before_docs) & set(after_docs)) if before_docs[path] != after_docs[path])
        changed_ids = {node["id"] for change in changes for node in (change["before"], change["after"]) if node}
        impacts = {}
        for change in changes:
            for node in change["impacted_nodes"]:
                if node["id"] not in changed_ids and (node["id"] not in impacts or node["depth"] < impacts[node["id"]]["depth"]):
                    impacts[node["id"]] = node
        return {"base_ref": base_ref, "head_ref": head_ref or "WORKTREE", "changes": changes, "impacted_nodes": sorted(impacts.values(), key=lambda node: (node["depth"], node["id"])), "issues": after_store.graph()["issues"], "requires_human_review": bool(changes)}
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        return {"base_ref": base_ref, "head_ref": head_ref or "WORKTREE", "changes": [], "impacted_nodes": [], "issues": [_problem("git_error", str(error))], "requires_human_review": False}
