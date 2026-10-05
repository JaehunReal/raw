import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { buildReviewPackage, draftErrors, emptyDraft, type ReviewDraft, type ReviewGraph } from './reviewPackage';

type Record = {
  source: "law" | "administrative" | "ordinance";
  law_id: string;
  version_id: string;
  title: string;
  effective_date: string | null;
  publication_date: string | null;
  source_url: string | null;
  raw_sha256: string | null;
  stored_at: string | null;
  raw_text: string;
};

type Graph = ReviewGraph;

export default function OfficialReview({ record }: { record: Record }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof buildReviewPackage> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const storageKey = `rulecraft-review:${record.source}:${record.law_id}:${record.version_id}`;
  function edit(key: keyof ReviewDraft, value: string) {
    setDraft(previous => ({ ...previous, [key]: value })); setPreview(null); setMessage('작성 중 · 저장 버튼으로 이 브라우저에 보관할 수 있습니다.');
  }
  function saveDraft() {
    try { localStorage.setItem(storageKey, JSON.stringify({ hash: record.raw_sha256, draft })); setMessage('이 브라우저에 저장했습니다. 공동 DB에는 저장되지 않습니다.'); }
    catch { setMessage('브라우저 저장에 실패했습니다. 파일로 내려받아 보관하세요.'); }
  }
  useEffect(() => {
    setDraft(emptyDraft); setPreview(null); setMessage('');
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.hash === record.raw_sha256 && saved?.draft && Object.keys(emptyDraft).every(key => typeof saved.draft[key] === 'string')) {
        setDraft(saved.draft); setMessage('이 브라우저에 저장한 초안을 불러왔습니다.');
      }
    } catch { setMessage('저장된 초안을 읽지 못했습니다.'); }
  }, [storageKey, record.raw_sha256]);
  function prepare() {
    const errors = draftErrors(record, draft);
    if (errors.length) { setMessage(errors.join(' ')); return; }
    setPreview(buildReviewPackage(record, draft, state === 'ready' ? graph : null, new Date().toISOString()));
    setMessage('검토 초안 7종을 준비했습니다. 내용을 확인하고 내려받으세요.');
  }
  function download(format: 'md' | 'json') {
    if (!preview) return;
    const content = format === 'json' ? JSON.stringify(preview, null, 2) : preview.documents.map(doc => doc.content).join('\n---\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `검토초안_${record.version_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setGraph(null); setPreview(null);
    const params = new URLSearchParams({ source: record.source, law_id: record.law_id, version_id: record.version_id });
    fetch(`/api/official/graph?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("graph_error");
        const result = await response.json();
        if (result.root !== record.law_id || !Array.isArray(result.nodes) || !Array.isArray(result.edges)) throw new Error('invalid_graph');
        return result as Graph;
      })
      .then((result) => { if (!controller.signal.aborted) { setGraph(result); setState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [record.source, record.law_id, record.version_id, attempt]);

  const edges = graph?.edges || [];
  const implementation = edges.filter((edge) => edge.kind === "implementation_basis").length;
  return <section className="official-review" data-testid="official-review">
    <div className="official-review-heading"><div><span className="pill sage"><ClipboardCheck size={13} />검토 준비</span><h3>이 원문으로 검토 결과를 준비합니다</h3></div><ShieldCheck size={21} /></div>
    <p className="official-review-intro">저장된 원문과 버전·출처·관계 정보를 한 장의 검토 항목으로 정리합니다. 법적 판단이나 개정안 확정은 담당자 검토가 필요합니다.</p>
    <div className="official-review-grid">
      <div><CheckCircle2 size={16} /><span>대상 원문<strong>{record.title}</strong></span></div>
      <div><CheckCircle2 size={16} /><span>기준 버전<strong>{record.version_id} · 시행일 {record.effective_date || "미확인"}</strong></span></div>
      <div><CheckCircle2 size={16} /><span>출처·무결성<strong>{record.source_url ? "공식 출처 확인" : "출처 주소 확인 필요"} · SHA-256 {record.raw_sha256 ? "보존" : "미확인"}</strong></span></div>
      <div>{state === "loading" ? <RefreshCw size={16} className="spin" /> : <CheckCircle2 size={16} />}<span>연결 관계<strong>{state === "ready" ? `${edges.length}개 연결 · 시행 근거 ${implementation}개` : state === "error" ? "관계 조회 실패" : "관계 조회 중"}</strong></span></div>
    </div>
    <ol className="official-review-checklist"><li>현행 원문과 시행일을 확인합니다.</li><li>상·하위 시행법령과 명시적 인용 관계를 확인합니다.</li><li>기관 업무·서식에 미치는 영향을 담당자가 기록합니다.</li><li>개정 필요 여부와 결재·법제 검토 절차를 결정합니다.</li></ol>
    {graph?.truncated && <small className="official-review-note">연결이 많아 관계 일부만 표시되었습니다. 관계 화면에서 이어서 확인하세요.</small>}
    {state === 'error' && <button className="text-button" onClick={() => setAttempt(n => n + 1)}>관계 다시 조회</button>}
    <div className="official-review-form">
      <h3>검토 초안 작성</h3><p>입력 내용은 이 브라우저에서 처리됩니다. 저장은 이 기기에만 적용되며, 공유할 자료는 MD·JSON 파일로 내려받으세요.</p>
      <label>담당 기관<input value={draft.agency} maxLength={200} onChange={e => edit('agency', e.target.value)} /></label>
      <label>검토 목적 (필수)<textarea value={draft.objective} maxLength={5000} onChange={e => edit('objective', e.target.value)} /></label>
      <details><summary>기준 원문 펼쳐서 발췌하기</summary><pre>{record.raw_text}</pre></details>
      <label>현행 원문 발췌 (필수)<textarea value={draft.excerpt} maxLength={30000} onChange={e => edit('excerpt', e.target.value)} placeholder="위 원문에서 검토할 조문을 복사하세요." /></label>
      <label>변경안 (필수)<textarea value={draft.proposed} maxLength={30000} onChange={e => edit('proposed', e.target.value)} /></label>
      <label>개정 이유 (필수)<textarea value={draft.reason} maxLength={5000} onChange={e => edit('reason', e.target.value)} /></label>
      <label>시행 예정일<input type="date" value={draft.effective} onChange={e => edit('effective', e.target.value)} /></label>
      <label>함께 검토할 기관 업무·서식<textarea value={draft.forms} maxLength={10000} onChange={e => edit('forms', e.target.value)} /></label>
      <label>담당자 검토 의견<textarea value={draft.notes} maxLength={10000} onChange={e => edit('notes', e.target.value)} /></label>
      <div className="official-review-actions"><button className="button secondary" onClick={saveDraft}>이 브라우저에 초안 저장</button><button className="button secondary" onClick={prepare} disabled={state === 'loading'}>검토 초안 7종 만들기</button></div>
      <p role="status">{message}</p>
      {preview && <div data-testid="review-package"><div className="official-review-actions"><button className="button secondary" onClick={() => download('md')}>MD 내려받기</button><button className="button secondary" onClick={() => download('json')}>JSON 내려받기</button></div>{preview.documents.map(doc => <details key={doc.name}><summary>{doc.name}</summary><pre>{doc.content}</pre></details>)}</div>}
    </div>
  </section>;
}
