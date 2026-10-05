import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPackage, draftErrors, emptyDraft } from '../frontend/src/reviewPackage.ts';
const record = { source: 'law', law_id: 'law:1', version_id: 'v1', title: '검증용 법령', raw_text: '제1조 목적\n제2조 신청', raw_sha256: 'source-hash', source_url: 'https://law.go.kr/', effective_date: '2026-01-01', publication_date: null };
const draft = { ...emptyDraft, objective: '절차 검토', excerpt: '제2조 신청', proposed: '제2조 신청 | <script>\n내용', reason: '사유 | 설명' };
test('rejects a passage that does not belong to selected version', () => {
  assert.equal(draftErrors(record, draft).length, 0);
  assert.throws(() => buildReviewPackage(record, { ...draft, excerpt: '없는 조문' }, null, 'now'));
});
test('preserves evidence and escapes table delimiters and HTML', () => {
  const pkg = buildReviewPackage(record, draft, null, 'now');
  assert.equal(pkg.documents.length, 7);
  assert.equal(pkg.source.raw_sha256, 'source-hash');
  assert.match(pkg.documents[1].content, /&#124; &lt;script&gt;<br>/);
  assert.equal(pkg.graph_status, 'unavailable');
  assert.match(pkg.documents[6].content, /관계 조회 미완료/);
  assert.match(pkg.documents[3].content, /미정/);
});
test('impact candidates include incoming references only and disclose truncation', () => {
  const graph = { root: record.law_id, nodes: [{ law_id: 'law:2', title: '참조 규정', version_id: 'v2' }], edges: [
    { from: 'law:2', to: record.law_id, kind: 'citation', evidence: '근거 문장', source_version_id: 'v2', source_sha256: 'ref-hash' },
    { from: record.law_id, to: 'law:3', kind: 'citation', evidence: 'outgoing' },
  ], truncated: true };
  const pkg = buildReviewPackage(record, draft, graph, 'now');
  assert.equal(pkg.graph_status, 'partial');
  assert.match(pkg.documents[6].content, /직접 역참조 1개/);
  assert.match(pkg.documents[6].content, /ref-hash/);
  assert.doesNotMatch(pkg.documents[6].content, /outgoing/);
});
