import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck } from "lucide-react";

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
};

type Graph = { edges?: Array<{ kind?: string }>; truncated?: boolean };

export default function OfficialReview({ record }: { record: Record }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    const params = new URLSearchParams({ source: record.source, law_id: record.law_id, version_id: record.version_id });
    fetch(`/api/official/graph?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("graph_error");
        return response.json() as Promise<Graph>;
      })
      .then((result) => { if (!controller.signal.aborted) { setGraph(result); setState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [record.source, record.law_id, record.version_id]);

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
  </section>;
}
