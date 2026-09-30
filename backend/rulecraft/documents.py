"""Reviewable Markdown artifacts; no automatic publication or legal opinion."""

from __future__ import annotations

import difflib
import html
from typing import Any


def article_body(markdown: str) -> str:
    lines = markdown.replace("\r\n", "\n").splitlines()
    if lines and lines[0] == "---":
        for index, line in enumerate(lines[1:], 1):
            if line == "---":
                return "\n".join(lines[index + 1:]).strip()
    return markdown.strip()


def _cell(lines: list[str]) -> str:
    return "<br>".join(html.escape(line).replace("|", "&#124;") for line in lines) or "—"


def generate_statutory_diff(current_markdown: str, revised_markdown: str, amendment_reason: str = "") -> str:
    before = article_body(current_markdown).splitlines()
    after = article_body(revised_markdown).splitlines()
    rows = ["# 신구조문대비표", "", "> 검토용 초안 · 현행 / 개정안 / 개정이유", "",
            "| 현행 | 개정안 | 개정이유 |", "| --- | --- | --- |"]
    matcher = difflib.SequenceMatcher(a=before, b=after, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            reason = "현행 유지"
        else:
            reason = amendment_reason.strip() or "입안 목적에 따른 수정 · 사유 확인 필요"
        rows.append(f"| {_cell(before[i1:i2])} | {_cell(after[j1:j2])} | {_cell([reason])} |")
    return "\n".join(rows) + "\n"


def _doc(name: str, content: str) -> dict[str, str]:
    return {"name": name, "content": content.rstrip() + "\n", "format": "markdown"}


def build_documents(request: dict[str, Any], node: dict[str, Any], revised: str,
                    impact: dict[str, Any], forms: list[dict[str, Any]], provenance: str,
                    grounding: dict[str, Any] | None = None) -> list[dict[str, str]]:
    agency = request["agency"]
    rule = request["rule_name"]
    objective = request["objective"].strip()
    reason = request.get("amendment_reason") or objective
    label = {"enactment": "제정", "partial": "일부개정", "full": "전부개정"}[request["amendment_type"]]
    effective = request["effective_date"]
    common = "> 검토용 초안 · 담당자 및 법제 심사자의 확인 후 사용\n"
    scope_note = ("이 패키지는 선택한 조문 1개의 입안 검토 자료입니다. "
                  "제정 또는 전부개정 시 규정 전체의 조문 체계, 정의, 권한, 다른 규정과의 관계를 별도로 작성·심사하여야 합니다.")
    documents = [
        _doc("01_개정조문안.md", revised),
        _doc("02_신구조문대비표.md", generate_statutory_diff(node["markdown"], revised, reason)),
        _doc("03_제개정이유서.md", f"# {rule} {label}이유서\n\n{common}\n"
             f"## 1. 제안 기관\n{agency}\n\n## 2. 제·개정 목적\n{objective}\n\n"
             f"## 3. 주요 내용\n{node.get('title', '')} 조문의 운영 기준을 검토·정비한다.\n\n{scope_note}\n\n"
             f"## 4. 제·개정 사유\n{reason}\n\n## 5. 시행 예정일\n{effective}\n\n"
             "## 6. 검토 사항\n상위 법령 위임 범위, 적용 대상, 예산 및 개인정보 영향은 별도 법제 심사에서 확인한다."),
        _doc("04_부칙안.md", f"# 부칙안\n\n{common}\n"
             f"제1조(시행일) 이 규정은 {effective}부터 시행한다.\n\n"
             "제2조(경과조치 검토) 시행 전에 진행 중인 업무의 적용 기준은 소관 부서가 검토한 후 확정한다.\n\n"
             "※ 경과조치 및 다른 규정의 개정 여부를 확인한 뒤 문안을 확정하여야 한다."),
        _doc("05_입법예고문안.md", f"# {rule} {label}안 예고문\n\n{common}\n"
             f"{agency}는 {rule}의 {label}을 검토하고 다음과 같이 의견을 수렴하고자 합니다.\n\n"
             f"## 제·개정 목적\n{objective}\n\n## 주요 내용\n첨부 조문안 및 신구조문대비표 참조\n\n"
             f"## 시행 예정일\n{effective}\n\n## 의견 제출\n"
             "의견 제출 기간, 담당 부서, 제출 주소와 연락처는 공고 전에 기관에서 확정하여야 합니다.\n\n"
             "※ 기관별 예고 의무와 기간, 내부 규정에 대한 적용 여부는 담당자가 확인하여야 합니다."),
    ]
    form_parts = ["# 별지 서식 정비 검토안", "", common,
                  "기존 Markdown 서식을 바탕으로 작성한 검토안입니다. 스캔 이미지 OCR 결과가 아닙니다.", "",
                  f"정비 목적: {objective}", ""]
    if forms:
        for form in forms:
            form_parts.extend([f"## {form['title']}", "", article_body(form["markdown"]), "",
                               "### 추가 확인 항목 (미확정)", "",
                               "| 검토 항목 | 담당자 확인 |", "| --- | --- |",
                               f"| {_cell([objective])}에 필요한 입력 항목 | □ 검토 완료 |",
                               "| 개인정보 수집 범위 및 처리 근거 | □ 검토 완료 |",
                               "| 승인권자 및 서명란 적정성 | □ 검토 완료 |", ""])
    else:
        form_parts.append("연결된 별지 서식이 없습니다. 새 서식의 필요 여부를 소관 부서에서 확인하세요.")
    documents.append(_doc("06_별지서식정비안.md", "\n".join(form_parts)))
    impacted = impact.get("impacted_nodes", [])
    report = ["# 변경 영향도 분석 보고서", "", common,
              f"- 변경 대상: `{node['path']}`", f"- 작성 방식: {provenance}",
              f"- 역참조 영향 대상: {len(impacted)}개", "",
              "## 영향 대상", "", "| 조문 / 서식 | 규정 | 경로 |", "| --- | --- | --- |"]
    for item in impacted:
        report.append(f"| {_cell([str(item.get('title', item.get('id', '')))])} | "
                      f"{_cell([str(item.get('rule_name', ''))])} | {_cell([str(item.get('path', ''))])} |")
    if not impacted:
        report.append("| 탐지된 역참조 없음 | — | — |")
    edits = impact.get("suggested_link_edits", [])
    report.extend(["", "## 인용 정비 제안", ""])
    if edits:
        for edit in edits:
            report.append(f"- `{edit.get('path', '')}`: `{edit.get('before', edit.get('old', ''))}` → "
                          f"`{edit.get('after', edit.get('new', ''))}` (검토 후 반영)")
    else:
        report.append("조문 번호 변경에 따른 인용 치환 제안이 없습니다.")
    report.extend(["", "## 검증 범위", "",
                   "로컬 지식문서의 스키마, 조문 번호, Wiki-Link 존재 여부 및 역참조를 검사합니다. "
                   "법적 효력, 상위법 위임 범위와 최신 법령 여부는 자동 확정하지 않습니다.",
                   "", "## 입안 범위", "", scope_note])
    if grounding is not None:
        report.extend(["", "## 공식 법령 근거와 수집 범위", "",
                       f"- 시행 기준일: {grounding.get('as_of')}",
                       f"- 공식 근거 상태: {grounding.get('status')}",
                       f"- 선택한 API 목록 수집 완료 여부: {bool(grounding.get('corpus', {}).get('complete'))}",
                       "- 전체 적용법·상위법 위임 범위·실질적 적법성 검토: 미완료 / 담당자 심사 필요",
                       "- 시연용 로컬 조문은 공식 원문과 별도이며 공식 법령으로 승격하지 않습니다.", ""])
        if not grounding.get("sources"):
            report.append("확보한 공식 근거 원문이 없습니다. 이 패키지는 공식 원문 반영을 완료한 결과가 아닙니다.")
        for source in grounding.get("sources", []):
            report.extend([f"### {source.get('title')} {source.get('article_no') or ''}", "",
                           f"- 공식 식별자: {source.get('law_id')} / 버전: {source.get('version_id')}",
                           f"- 공포일: {source.get('publication_date')} / 시행일: {source.get('effective_date')}",
                           f"- 출처: {source.get('source_url')}",
                           f"- 원문 SHA-256: {source.get('sha256')}",
                           f"- 근거 선정: {source.get('origin')} / 기준일 확인: {source.get('temporal_verified')}", "",
                           "아래는 길이 제한으로 일부 발췌한 원문입니다." if source.get("passage_truncated") else "아래는 확보한 조문 원문입니다.",
                           "", source.get("passage", ""), ""])
        if grounding.get("issues"):
            report.extend(["### 확인이 필요한 수집·근거 항목", ""])
            report.extend(f"- {issue.get('code')}: {issue.get('message')}" for issue in grounding["issues"])
    documents.append(_doc("07_변경영향도보고서.md", "\n".join(report)))
    return documents
