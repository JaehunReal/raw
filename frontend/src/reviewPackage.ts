export type ReviewRecord = {
  source: string; law_id: string; version_id: string; title: string;
  effective_date: string | null; publication_date: string | null;
  source_url: string | null; raw_sha256: string | null; raw_text: string;
};
export type ReviewGraph = {
  root: string;
  nodes: Array<{ law_id: string; title: string; version_id: string }>;
  edges: Array<{ from: string; to: string; kind: string; evidence: string; source_version_id: string; source_sha256: string }>;
  truncated: boolean;
};
export type ReviewDraft = {
  agency: string; objective: string; excerpt: string; proposed: string;
  reason: string; effective: string; notes: string; forms: string;
};
export const emptyDraft: ReviewDraft = { agency: '', objective: '', excerpt: '', proposed: '', reason: '', effective: '', notes: '', forms: '' };
export function draftErrors(record: ReviewRecord, draft: ReviewDraft): string[] {
  const errors: string[] = [];
  if (!draft.objective.trim()) errors.push('검토 목적을 입력하세요.');
  if (!draft.excerpt.trim() || !record.raw_text.includes(draft.excerpt.trim())) errors.push('현행 발췌는 선택한 저장 원문과 일치해야 합니다.');
  if (!draft.proposed.trim()) errors.push('변경안을 입력하세요.');
  if (!draft.reason.trim()) errors.push('개정 이유를 입력하세요.');
  return errors;
}
const cell = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${line}`).join('\n');
export function buildReviewPackage(record: ReviewRecord, draft: ReviewDraft, graph: ReviewGraph | null, generatedAt: string) {
  const errors = draftErrors(record, draft);
  if (errors.length) throw new Error(errors.join(' '));
  const provenance = `대상: ${record.title}\n법령 ID: ${record.law_id}\n버전: ${record.version_id}\n공포일: ${record.publication_date || '미확인'}\n시행일: ${record.effective_date || '미확인'}\n출처: ${record.source_url || '미확인'}\n원문 SHA-256: ${record.raw_sha256 || '미확인'}\n작성 시각: ${generatedAt}`;
  const document = (name: string, body: string) => ({ name, content: `# ${name.replace('.md', '')}\n\n> 담당자 검토용 초안 · 입력한 변경안을 문서로 구성했습니다.\n> 선택한 저장 버전의 발췌 범위에 한합니다. 현행성·적법성·기관별 절차는 미확정입니다.\n\n${body}\n\n## 원문 근거\n${quote(provenance)}\n` });
  const affected = graph?.edges.filter(edge => edge.to === graph.root) || [];
  const relations = affected.map(edge => {
    const title = graph?.nodes.find(node => node.law_id === edge.from)?.title || edge.from;
    return `${title} (${edge.from})\n관계: ${edge.kind === 'implementation_basis' ? '시행 근거' : '명시적 인용'}\n인용 원문 버전: ${edge.source_version_id}\n인용 원문 SHA-256: ${edge.source_sha256}\n근거: ${edge.evidence}`;
  });
  const documents = [
    document('01_개정조문안.md', `## 입력한 변경안\n${quote(draft.proposed)}`),
    document('02_신구조문대비표.md', `| 저장 원문 발췌 | 변경안 | 개정 이유 |\n| --- | --- | --- |\n| ${cell(draft.excerpt.trim())} | ${cell(draft.proposed)} | ${cell(draft.reason)} |`),
    document('03_제개정이유서.md', `## 기관\n${quote(draft.agency || '미입력')}\n\n## 검토 목적\n${quote(draft.objective)}\n\n## 개정 이유\n${quote(draft.reason)}`),
    document('04_부칙검토안.md', `## 시행 예정일 (담당자 입력)\n${quote(draft.effective || '미정')}\n\n## 추가 검토\n- 경과조치 필요 여부\n- 다른 규정의 개정 여부\n- 시행 준비 기간\n\n## 담당자 의견\n${quote(draft.notes || '미입력')}`),
    document('05_예고문검토안.md', `## 대상\n${quote(record.title)}\n\n## 목적\n${quote(draft.objective)}\n\n## 공고 전 확인\n- 예고 대상 여부 및 담당 기관의 권한\n- 의견 제출 기간·담당 부서·연락처\n- 변경안과 대비표 검토\n\n공고 정보는 미확정입니다.`),
    document('06_별지서식검토안.md', `## 담당자가 지정한 업무·서식\n${quote(draft.forms || '미입력')}\n\n기관 서식의 자동 연결은 아직 제공되지 않습니다. 입력한 서식의 근거·필수 항목·개인정보 수집 범위를 확인하세요.`),
    document('07_변경영향검토서.md', `## 검토 후보 범위\n${graph ? `조회된 직접 역참조 ${affected.length}개. 실제 변경 영향은 담당자 확인이 필요합니다.${graph.truncated ? ' 관계 조회가 제한되어 일부 후보만 포함합니다.' : ''}` : '관계 조회 미완료. 영향 후보를 확인하지 못했습니다.'}\n\n${relations.map(quote).join('\n\n') || '확인한 역참조 후보 없음. 영향이 없다는 뜻은 아닙니다.'}\n\n## 담당자 검토 의견\n${quote(draft.notes || '미입력')}`),
  ];
  return { schema_version: 1, status: 'draft', generated_at: generatedAt, source: record, input: draft, graph_status: graph ? (graph.truncated ? 'partial' : 'loaded') : 'unavailable', graph, documents };
}
