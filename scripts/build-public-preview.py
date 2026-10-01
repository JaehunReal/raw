#!/usr/bin/env python3
"""Build a deterministic, offline snapshot from the repository's public demo only.

This command never reads deployment environment variables, .env files, a configured
vault, official corpus storage, or external services. Vercel consumes the committed
JSON; Python is needed only when intentionally refreshing the public example.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "legal-knowledge-vault"
EVIDENCE = ROOT / "docs" / "api-connection-evidence.json"
OUTPUT = ROOT / "frontend" / "src" / "preview-snapshot.json"
SECRET_FIELDS = {
    "oc", "token", "password", "secret", "api_key", "apikey", "authorization",
    "bearer_token", "rulecraft_law_oc", "rulecraft_api_token",
    "rulecraft_web_password", "vercel_token", "render_api_key",
}

sys.path.insert(0, str(ROOT / "backend"))
from rulecraft.delta import analyze  # noqa: E402
from rulecraft.documents import build_documents  # noqa: E402
from rulecraft.graph import GraphStore, parse_markdown  # noqa: E402


def _public_path(path: Path, root: Path) -> Path:
    if path.is_symlink() or any(part.is_symlink() for part in path.parents if part != ROOT):
        raise ValueError("Public preview inputs and output must not use symlinks.")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Public preview path leaves its fixed repository directory.")
    return path


def _reject_secret_fields(value: Any) -> None:
    if isinstance(value, dict):
        if any(str(key).casefold() in SECRET_FIELDS for key in value):
            raise ValueError("Public preview data contains a private credential field.")
        for item in value.values():
            _reject_secret_fields(item)
    elif isinstance(value, list):
        for item in value:
            _reject_secret_fields(item)
    elif isinstance(value, str):
        if re.search(r"(?i)[?&](?:oc|token|api_key|password)=", value):
            raise ValueError("Public preview data contains a credential-bearing URL.")
        if re.search(r"(?im)^\s*(?:RULECRAFT_(?:LAW_OC|API_TOKEN|WEB_PASSWORD)|VERCEL_TOKEN|RENDER_API_KEY)\s*=", value):
            raise ValueError("Public preview data contains a credential assignment.")


def build_snapshot() -> dict[str, Any]:
    _public_path(VAULT, ROOT)
    tracked = subprocess.run(
        ["git", "ls-files", "-z", "--", "legal-knowledge-vault"],
        cwd=ROOT, check=True, capture_output=True,
    ).stdout.decode("utf-8").split("\0")
    documents: dict[str, str] = {}
    for name in sorted(item for item in tracked if item.endswith(".md")):
        path = _public_path(ROOT / name, VAULT)
        relative = path.relative_to(VAULT).as_posix()
        markdown = path.read_text(encoding="utf-8")
        node, issues = parse_markdown(markdown, relative)
        if node["metadata"].get("demo") is not True or node["status"] != "demo":
            raise ValueError("Every tracked preview document must explicitly have demo: true and status: demo.")
        if any(issue["severity"] == "error" for issue in issues):
            raise ValueError("Public demo Markdown failed metadata validation.")
        _reject_secret_fields(node)
        documents[relative] = markdown
    if not documents:
        raise ValueError("The fixed, tracked public demo vault is empty.")

    store = GraphStore.from_documents(VAULT, documents)
    graph = store.graph()
    if any(issue["severity"] == "error" for issue in graph["issues"]):
        raise ValueError("Public demo graph failed link validation.")
    if not all(node["metadata"].get("demo") is True and node["status"] == "demo" for node in graph["nodes"]):
        raise ValueError("Public demo graph contains a document without explicit demo markers.")

    verification = json.loads(_public_path(EVIDENCE, ROOT / "docs").read_text(encoding="utf-8"))
    _reject_secret_fields(verification)
    node = store.get("KIPA-RULE-DAT-007")
    if node is None:
        raise ValueError("The public package example requires the tracked demo data-export article.")
    objective = "인공지능 모델 학습을 위한 데이터 반출 절차와 개인정보 보호 요건을 명확히 하고자 합니다."
    revised = node["markdown"].rstrip() + (
        "\n\n③ 인공지능 모델 학습 목적의 반출은 개인정보 보호 요건을 사전에 확인하여야 한다.\n"
    )
    validation = store.validate(revised, node["path"])
    impact = analyze(store, node["path"], revised)
    issues = [*validation["issues"], *impact.get("issues", [])]
    if any(issue.get("severity", "error") == "error" for issue in issues):
        raise ValueError("The offline public package example failed engine validation.")
    related = store.query(node["agency"], node["rule_name"], node["article_no"], "ALL")
    forms = [item for item in related["nodes"] if item["kind"] == "form"]
    request = {
        "agency": node["agency"], "rule_name": node["rule_name"],
        "article_id": node["id"], "amendment_type": "partial",
        "objective": objective, "amendment_reason": objective,
        "effective_date": "2026-12-01",
    }
    grounding = {
        "as_of": "2026-12-01", "status": "not_collected",
        "corpus": {"complete": False, "official_count": 0}, "sources": [],
        "issues": [{
            "code": "public_demo_only",
            "message": "공개 예제 자료로 작성했습니다. 공식 원문은 미수집 상태이며 실제 법적 효력과 적법성은 검증하지 않았습니다.",
        }],
    }
    package_documents = build_documents(
        request, node, revised, impact, forms, "offline_public_demo", grounding=grounding,
    )
    if len(package_documents) != 7:
        raise ValueError("The review engine must produce seven public example documents.")
    snapshot = {
        "schema_version": 1,
        "mode": "public_read_only_demo",
        "recorded_at": verification["recorded_at"],
        "notice": "읽기 전용 공개 예제입니다. 실제 법령 원문이나 기관 현행 규정이 아니며, 백엔드와 공식 API는 연결하지 않았습니다.",
        "graph": graph,
        "verification": verification,
        "package_example": {
            "id": "public-demo-data-export",
            "status": "example", "created_at": verification["recorded_at"],
            "agency": node["agency"], "rule_name": node["rule_name"],
            "article_id": node["id"], "objective": objective,
            "effective_date": request["effective_date"],
            "provenance": "offline_public_demo",
            "documents": package_documents,
            "verification": {
                "valid": True, "issues": issues,
                "scope": "공개 시연 규정의 로컬 스키마·조문 번호·Wiki-Link 및 역참조 검사",
                "requires_human_review": True, "legal_authority_verified": False,
                "legal_coverage": grounding,
            },
            "notice": "기존 문서 엔진으로 오프라인 생성한 고정 예제입니다. 공식 원문을 반영한 운영 결과가 아닙니다.",
        },
        "source_files": [{
            "path": f"legal-knowledge-vault/{name}",
            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        } for name, content in sorted(documents.items())],
    }
    _reject_secret_fields(snapshot)
    return snapshot


def main() -> int:
    snapshot = build_snapshot()
    output = _public_path(OUTPUT, ROOT / "frontend" / "src")
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    output.chmod(0o644)
    print(json.dumps({
        "output": output.relative_to(ROOT).as_posix(),
        "nodes": len(snapshot["graph"]["nodes"]),
        "edges": len(snapshot["graph"]["edges"]),
        "documents": len(snapshot["package_example"]["documents"]),
        "offline": True, "official_documents": 0,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
