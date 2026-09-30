"""Five explicit stages with graph provenance and a blocking validation gate."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import io
import json
import re
import tempfile
from typing import Any
from uuid import uuid4
import zipfile

import yaml

from . import adapters
from .delta import analyze
from .documents import article_body, build_documents
from .graph import GraphStore, normalize_article


PACKAGE_ID = re.compile(r"^[a-f0-9]{32}$")
TEXT_CITATION = re.compile(r"(?:「(?P<bracket>[^」\n]+)」|(?P<plain>[가-힣A-Za-z0-9·]+(?:법|규정|지침|조례|규칙)))\s*제\s*(?P<number>\d+)\s*조(?:\s*의\s*(?P<sub>\d+))?")


def _issue(code: str, message: str, path: str = "", **extra: Any) -> dict[str, Any]:
    return {"severity": "error", "code": code, "message": message, "path": path, **extra}


def _text_citations(store: GraphStore, text: str, path: str) -> list[dict[str, Any]]:
    nodes = store.graph()["nodes"]
    issues = []
    for match in TEXT_CITATION.finditer(text):
        name = (match["bracket"] or match["plain"]).strip()
        article = normalize_article(match["number"] + ("의" + match["sub"] if match["sub"] else ""))
        if not any(node["rule_name"] == name and node["article_no"] == article for node in nodes):
            issues.append(_issue("unverified_text_citation", f"로컬 지식문서에서 인용을 확인할 수 없습니다: {name} {article}",
                                 path, reference=match.group(0)))
    return issues


def template_draft(node: dict[str, Any], objective: str) -> str:
    metadata = dict(node["metadata"])
    metadata["status"] = "draft"
    frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).rstrip()
    proposal = (
        "\n\n## 추가 입안 검토안 (미확정)\n\n"
        f"> 담당자 입력 목적: {' '.join(objective.split())}\n\n"
        "[입안 제안] 담당 부서는 위 목적에 필요한 적용 대상, 처리 절차 및 책임자를 정하여야 한다.\n\n"
        "※ 모델 미연결 상태에서 작성된 템플릿 제안입니다. 구체적인 요건, 의무 및 법적 근거를 "
        "소관 부서가 확인하여 조문 문안을 확정하여야 합니다.\n"
    )
    return f"---\n{frontmatter}\n---\n\n{article_body(node['markdown'])}{proposal}"


class PackageWorkflow:
    def __init__(self, store: GraphStore, package_dir: Path):
        self.store = store
        self.package_dir = Path(package_dir).absolute()

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        self.store.refresh()
        node = self.store.get(request["article_id"])
        if node is None:
            raise KeyError("선택한 조문이 없거나 ID가 중복되었습니다.")
        if node["kind"] == "form":
            raise ValueError("별지 서식 대신 입안 대상 조문을 선택하세요.")
        if request["agency"] != node["agency"] or request["rule_name"] != node["rule_name"]:
            raise ValueError("기관과 규정명은 선택한 조문의 메타데이터와 일치해야 합니다.")
        agents = [{"name": "process", "label": "절차 총괄", "status": "completed",
                   "detail": "입안 → 부서 협의 → 예고 검토 → 법제 심사 → 공포의 검토 절차를 구성했습니다."}]
        graph = self.store.query(node["agency"], node["rule_name"], node["article_no"], "ALL")
        agents.append({"name": "research", "label": "지식그래프 조사", "status": "completed",
                       "detail": f"로컬 지식문서 {len(graph['nodes'])}개와 관계 {len(graph['edges'])}개를 조회했습니다. 최신 법령 대조는 별도 확인이 필요합니다."})
        forms = [item for item in graph["nodes"] if item["kind"] == "form"]
        agents.append({"name": "vision", "label": "비전 서식 분석", "status": "skipped",
                       "detail": f"이번 요청에 스캔 이미지가 없어 기존 Markdown 서식 {len(forms)}개를 사용했습니다. OCR을 실행하지 않았습니다."})
        issues: list[dict[str, Any]] = []
        revised = request.get("revised_markdown")
        provenance = "user_provided"
        if not revised:
            if adapters.readiness()["drafting"]["configured"]:
                try:
                    revised = adapters.draft_article(node["markdown"], request["objective"])
                    provenance = "openai_compatible"
                except adapters.AdapterUnavailable as error:
                    revised = node["markdown"]
                    issues.append(_issue("drafting_unavailable", str(error), node["path"]))
            else:
                revised = template_draft(node, request["objective"])
                provenance = "template"
        agents.append({"name": "drafting", "label": "조문 입안", "status": "blocked" if issues else "completed",
                       "detail": {"user_provided": "담당자가 입력한 개정 Markdown을 사용했습니다.",
                                  "template": "입력 목적을 바탕으로 검토용 템플릿 제안을 작성했습니다. LLM 추론을 실행하지 않았습니다.",
                                  "openai_compatible": "설정된 모델에서 초안을 작성했습니다. 인용은 로컬 그래프로 검증합니다."}[provenance]})
        validation = self.store.validate(revised, node["path"])
        issues.extend(validation["issues"])
        candidate = validation["node"]
        for key in ("id", "agency", "rule_name"):
            if candidate[key] != node[key]:
                issues.append(_issue("identity_changed", f"기존 조문의 {key}는 패키지 생성 시 변경할 수 없습니다.", node["path"]))
        # User purpose/reason also appear in artifacts; don't let broken links enter via these fields.
        for field in ("objective", "amendment_reason"):
            value = request.get(field) or ""
            if value:
                checked = self.store.validate(node["markdown"] + "\n\n" + value, node["path"])
                issues.extend({**issue, "input_field": field} for issue in checked["issues"])
                issues.extend(_text_citations(self.store, value, node["path"]))
        issues.extend(_text_citations(self.store, article_body(revised), node["path"]))
        for form in forms:
            issues.extend(self.store.validate(form["markdown"], form["path"])["issues"])
        impact = analyze(self.store, node["path"], revised)
        issues.extend(impact.get("issues", []))
        # Multiple stages may find the same broken citation. Retain one clear report entry.
        unique: dict[str, dict[str, Any]] = {}
        for issue in issues:
            unique[json.dumps(issue, ensure_ascii=False, sort_keys=True, default=str)] = issue
        issues = list(unique.values())
        valid = not any(issue.get("severity", "error") == "error" for issue in issues)
        agents.append({"name": "verification", "label": "정합성 검증", "status": "completed" if valid else "blocked",
                       "detail": "로컬 인용과 조문 번호 검증 통과 · 법제 심사 필요" if valid else f"오류 {sum(i.get('severity', 'error') == 'error' for i in issues)}개로 산출물 생성이 차단되었습니다."})
        documents = build_documents(request, node, revised, impact, forms, provenance) if valid else []
        result = {
            "id": uuid4().hex,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "draft" if valid else "blocked",
            "agency": request["agency"], "rule_name": request["rule_name"],
            "amendment_type": request["amendment_type"], "objective": request["objective"],
            "article_id": node["id"], "effective_date": request["effective_date"],
            "documents": documents, "agents": agents, "provenance": provenance,
            "verification": {"valid": valid, "issues": issues,
                             "scope": "로컬 스키마·조문 번호·Wiki-Link 및 명시적 인용 존재 검사",
                             "requires_human_review": True,
                             "legal_authority_verified": False},
            "impact": impact,
            "procedure": ["입안", "부서 사전협의", "예고 필요 여부 확인", "법제·규제 심사", "공포·시행"],
            "notice": "검토용 문서입니다. 기관별 절차와 최신 법령을 확인한 후 확정하세요.",
            "scope": {"type": "selected_article", "article_ids": [node["id"]],
                      "detail": "선택한 조문 1개의 입안 검토 자료입니다. 제정·전부개정은 전체 규정에 대한 별도 입안과 심사가 필요합니다."},
        }
        self._persist(result)
        return result

    def _persist(self, package: dict[str, Any]) -> None:
        self._guard_directory()
        self.package_dir.mkdir(parents=True, exist_ok=True)
        target = self._path(package["id"])
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.package_dir,
                                             prefix=".package-", suffix=".tmp", delete=False) as stream:
                json.dump(package, stream, ensure_ascii=False, indent=2)
                temporary = Path(stream.name)
            temporary.replace(target)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    def _path(self, package_id: str) -> Path:
        self._guard_directory()
        if not PACKAGE_ID.fullmatch(package_id):
            raise ValueError("올바른 패키지 ID가 아닙니다.")
        path = self.package_dir / f"{package_id}.json"
        if path.is_symlink():
            raise ValueError("패키지 파일에 심볼릭 링크를 사용할 수 없습니다.")
        return path

    def _guard_directory(self) -> None:
        # Guard reads too: a persisted directory must not become an external symlink.
        for part in [self.package_dir, *self.package_dir.parents]:
            if part.is_symlink():
                raise ValueError("패키지 저장 경로에는 심볼릭 링크를 사용할 수 없습니다.")

    def get(self, package_id: str) -> dict[str, Any]:
        path = self._path(package_id)
        if not path.exists():
            raise KeyError("패키지를 찾을 수 없습니다.")
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict[str, Any]]:
        self._guard_directory()
        if not self.package_dir.exists():
            return []
        packages = []
        for path in self.package_dir.glob("*.json"):
            if PACKAGE_ID.fullmatch(path.stem) and not path.is_symlink():
                try:
                    packages.append(self.get(path.stem))
                except (OSError, ValueError, KeyError):
                    continue
        return sorted(packages, key=lambda item: item.get("created_at", ""), reverse=True)

    def archive(self, package_id: str) -> bytes:
        package = self.get(package_id)
        if not package["verification"]["valid"] or not package["documents"]:
            raise ValueError("검증에 실패한 패키지는 다운로드할 수 없습니다.")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for document in sorted(package["documents"], key=lambda item: item["name"]):
                name = document["name"]
                if Path(name).name != name or any(char in name for char in "/\\:") or not name.endswith(".md"):
                    raise ValueError("산출물 파일명이 올바르지 않습니다.")
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, document["content"].encode("utf-8"))
            manifest = {
                key: package[key] for key in ("id", "status", "created_at", "agency", "rule_name", "provenance", "verification")
            }
            info = zipfile.ZipInfo("manifest.json", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
        return output.getvalue()
