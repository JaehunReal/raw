import { OfficialRelations } from "./OfficialRelations";
import OfficialReview from "./OfficialReview";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";

export const officialSources = [
  { id: "law", label: "법령" },
  { id: "administrative", label: "행정규칙" },
  { id: "ordinance", label: "자치법규" },
] as const;
type Source = typeof officialSources[number]["id"];
type Counts = { stored_documents: number; stored_versions: number; last_stored_at?: string | null };
type ConnectedStatus = {
  storage: "postgresql"; connection: "connected"; checked_at: string;
  totals: Counts; sources: ({ source: Source } & Counts)[];
};
export type OfficialStatus = {
  phase: "loading" | "connected" | "not_configured" | "unavailable" | "incompatible_schema";
  data?: ConnectedStatus;
};
type LawRecord = {
  source: Source; law_id: string; version_id: string; title: string;
  effective_date: string | null; publication_date: string | null;
  source_url: string | null; raw_sha256: string | null; stored_at: string | null;
};
type LawList = { items: LawRecord[]; total: number; limit: number; offset: number };
type LawDocument = LawRecord & { raw_text: string };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const counts = (value: Counts): boolean => Boolean(value) && integer(value.stored_documents) && integer(value.stored_versions);
const sourceName = (source: Source) => officialSources.find((item) => item.id === source)?.label || source;

export function displayCount(status: OfficialStatus, key: "stored_documents" | "stored_versions" = "stored_documents") {
  return status.phase === "connected" && status.data ? status.data.totals[key].toLocaleString("ko-KR") : "미확인";
}
export function connectionLabel(status: OfficialStatus) {
  return { loading: "저장소 확인 중", connected: "PostgreSQL 연결됨", not_configured: "데이터 저장소 연결 대기",
    unavailable: "데이터 저장소 응답 확인 필요", incompatible_schema: "저장 데이터 구조 확인 필요" }[status.phase];
}
export function checkedAt(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "미확인";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

export function useOfficialStatus() {
  const [status, setStatus] = useState<OfficialStatus>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus({ phase: "loading" });
    async function load() {
      try {
        const response = await fetch("/api/official/status", { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || result.connection !== "connected") {
          const phase = ["not_configured", "incompatible_schema"].includes(result.connection)
            ? result.connection as "not_configured" | "incompatible_schema" : "unavailable";
          setStatus({ phase });
          return;
        }
        if (result.storage !== "postgresql" || !counts(result.totals) || !Array.isArray(result.sources)
          || result.sources.length !== officialSources.length || !Number.isFinite(Date.parse(result.checked_at))
          || officialSources.some(({ id }) => result.sources.filter((item: { source: string }) => item.source === id).length !== 1)
          || result.sources.some((item: Counts) => !counts(item))) throw new Error("Invalid storage status");
        setStatus({ phase: "connected", data: result });
      } catch {
        if (!controller.signal.aborted) setStatus({ phase: "unavailable" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return { status, retry: () => setAttempt((previous) => previous + 1) };
}

function validRecord(record: LawRecord) {
  return Boolean(record) && officialSources.some(({ id }) => id === record.source)
    && typeof record.law_id === "string" && typeof record.version_id === "string" && typeof record.title === "string"
    && [record.effective_date, record.publication_date, record.source_url, record.raw_sha256, record.stored_at]
      .every((value) => value === null || typeof value === "string");
}
function officialUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password
      || !(url.hostname === "law.go.kr" || url.hostname.endsWith(".law.go.kr"))
      || [...url.searchParams.keys()].some((key) => key.toLowerCase() === "oc")) return null;
    return url.href;
  } catch { return null; }
}

export default function OfficialLaws({ status, retry }: { status: OfficialStatus; retry: () => void }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState({ q: "", source: "", offset: 0 });
  const [list, setList] = useState<LawList | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<LawRecord | null>(null);
  const [document, setDocument] = useState<LawDocument | null>(null);
  const [documentState, setDocumentState] = useState<"loading" | "ready" | "error">("loading");
  const [documentAttempt, setDocumentAttempt] = useState(0);
  const listRequest = useRef(0);
  useEffect(() => {
    if (status.phase !== "connected") { setList(null); setSelected(null); return; }
    const controller = new AbortController();
    const requestId = ++listRequest.current;
    setList(null); setListState("loading"); setSelected(null); setDocument(null);
    async function load() {
      try {
        const params = new URLSearchParams({ q: query.q, limit: "20", offset: String(query.offset) })
        if (query.source) params.set("source", query.source);
        const response = await fetch(`/api/official/laws?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.items) || !result.items.every(validRecord)
          || !integer(result.total) || !integer(result.offset) || !integer(result.limit) || result.limit < 1)
          throw new Error("Invalid document list");
        if (!controller.signal.aborted && requestId === listRequest.current) { setList(result); setListState("ready"); }
      } catch {
        if (!controller.signal.aborted && requestId === listRequest.current) setListState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [query, status.phase, status.data?.checked_at]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDocument(null); setDocumentState("loading");
    async function load() {
      try {
        const params = new URLSearchParams({ source: selected!.source, law_id: selected!.law_id, version_id: selected!.version_id });
        const response = await fetch(`/api/official/document?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !validRecord(result.document) || typeof result.document.raw_text !== "string"
          || result.document.source !== selected!.source || result.document.law_id !== selected!.law_id
          || result.document.version_id !== selected!.version_id) throw new Error("Invalid document");
        if (!controller.signal.aborted) { setDocument(result.document); setDocumentState("ready"); }
      } catch { if (!controller.signal.aborted) setDocumentState("error"); }
    }
    void load();
    return () => controller.abort();
  }, [selected, documentAttempt]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery({ q: search.trim(), source, offset: 0 });
  }
  const url = document ? officialUrl(document.source_url) : null;
  return <section className="official-law-workspace" data-testid="official-law-workspace">
    <section className="panel official-storage-status" data-testid="official-storage-status" aria-live="polite">
      <div className="official-storage-heading"><div><span className={`pill ${status.phase === "connected" ? "sage" : "warning"}`} data-testid="official-connection">{connectionLabel(status)}</span><h2>보관된 공식 원문</h2></div><button className="button secondary" onClick={retry} disabled={status.phase === "loading"}><RefreshCw size={15} />다시 확인</button></div>
      <div className="official-storage-totals"><div><span>법령 문서</span><strong data-testid="official-total-documents">{displayCount(status)}<small>{status.phase === "connected" ? "건" : ""}</small></strong></div><div><span>보존된 버전</span><strong data-testid="official-total-versions">{displayCount(status, "stored_versions")}<small>{status.phase === "connected" ? "개" : ""}</small></strong></div></div>
      {status.phase === "connected" ? <p>저장소에서 확인한 건수입니다. 문서를 선택하면 저장된 원문과 버전·출처·해시를 조회합니다.</p>
        : <p>{status.phase === "loading" ? "저장소의 현재 연결 상태와 보관 건수를 확인하고 있습니다." : "아직 저장소에서 건수를 확인할 수 없습니다. 미확인은 저장된 원문이 0건이라는 뜻이 아닙니다."}</p>}
      {status.phase === "connected" && <p data-testid="official-last-stored">최근 원문 저장: {checkedAt(status.data?.totals.last_stored_at)} (한국 시간)</p>}
      <div className="official-source-counts">{officialSources.map(({ id, label }) => {
        const stored = status.data?.sources.find((item) => item.source === id);
        return <div key={id} data-testid={`official-source-${id}`}><BookOpen size={17} /><strong>{label}</strong><span>{status.phase === "connected" && stored ? `${stored.stored_documents.toLocaleString("ko-KR")}건 · ${stored.stored_versions.toLocaleString("ko-KR")}개 버전` : "저장 건수 미확인"}</span></div>;
      })}</div>
      {status.phase === "connected" && <p className="preview-record-time" data-testid="official-checked-at">조회 시각: {checkedAt(status.data?.checked_at)} (한국 시간) · 전체 이력·첨부파일 수집 완료 여부는 별도 확인이 필요합니다.</p>}
    </section>
    {status.phase === "connected" && <div className="official-document-layout">
      <section className="panel official-document-list"><form onSubmit={submit} className="official-search-form"><label htmlFor="official-search">공식 원문 검색</label><div className="official-search-input"><Search size={17} /><input id="official-search" data-testid="official-search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="법령명 검색" /></div><label htmlFor="official-source-filter">자료 유형</label><select id="official-source-filter" value={source} onChange={(event) => { setSource(event.target.value); setQuery({ q: search.trim(), source: event.target.value, offset: 0 }); }}><option value="">전체 유형</option>{officialSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select><button type="submit" className="button secondary">검색</button></form>
        <div className="official-list-results" aria-live="polite" data-testid="official-list-results">{listState === "loading" && <p className="preview-empty" role="status">공식 원문 목록을 불러오는 중입니다.</p>}{listState === "error" && <div className="preview-empty" role="alert"><p>원문 목록을 불러오지 못했습니다.</p><button className="text-button" onClick={() => setQuery({ ...query })}>목록 다시 불러오기</button></div>}{listState === "ready" && list && <><p className="official-list-count">검색 결과 {list.total.toLocaleString("ko-KR")}개 버전 · 저장된 원문</p>{list.items.map((item) => <button key={`${item.source}:${item.law_id}:${item.version_id}`} data-testid="official-law-row" className={selected === item ? "selected" : ""} aria-pressed={selected === item} onClick={() => setSelected(item)}><span><strong>{item.title || "제목 미확인"}</strong><small>{sourceName(item.source)} · 버전 {item.version_id}</small><small>시행일 {item.effective_date || "미확인"}</small></span><ChevronRight size={15} /></button>)}{list.items.length === 0 && <p className="preview-empty">{query.q || query.source ? "조건에 맞는 저장 원문이 없습니다." : "연결된 저장소에 공식 원문이 아직 없습니다."}</p>}<div className="official-pagination"><button disabled={list.offset === 0} onClick={() => setQuery({ ...query, offset: Math.max(0, list.offset - list.limit) })}><ChevronLeft size={15} />이전</button><span>{list.total ? `${list.offset + 1}–${Math.min(list.offset + list.items.length, list.total)}` : "0"} / {list.total.toLocaleString("ko-KR")}</span><button disabled={list.offset + list.limit >= list.total} onClick={() => setQuery({ ...query, offset: list.offset + list.limit })}>다음<ChevronRight size={15} /></button></div></>}</div>
      </section>
      <section className="panel official-document-reader" data-testid="official-document-reader" aria-live="polite">{!selected ? <p className="preview-empty">목록에서 법령을 선택해 저장된 원문을 읽어보세요.</p> : documentState === "loading" ? <p className="preview-empty" role="status">선택한 원문을 불러오는 중입니다.</p> : documentState === "error" ? <div className="preview-empty" role="alert"><p>선택한 원문을 불러오지 못했습니다.</p><button className="text-button" onClick={() => setDocumentAttempt((previous) => previous + 1)}>원문 다시 불러오기</button></div> : document && <><div className="preview-reader-header"><span className="pill sage">저장된 공식 원문 · 읽기 전용</span><h2>{document.title || "제목 미확인"}</h2><p>{sourceName(document.source)} · 법령 ID {document.law_id}</p><dl className="official-document-metadata"><div><dt>버전</dt><dd>{document.version_id}</dd></div><div><dt>공포·발령일</dt><dd>{document.publication_date || "미확인"}</dd></div><div><dt>시행일</dt><dd>{document.effective_date || "미확인"}</dd></div><div><dt>저장 시각</dt><dd>{checkedAt(document.stored_at)}</dd></div><div><dt>원문 SHA-256</dt><dd>{document.raw_sha256 || "미확인"}</dd></div></dl>{url ? <a className="text-button" href={url} target="_blank" rel="noreferrer">국가법령정보센터 출처 <ArrowUpRight size={14} /></a> : <p>공식 출처 주소 미확인</p>}</div><OfficialRelations record={document} onSelect={setSelected} /><OfficialReview record={document} /><pre data-testid="official-raw-text">{document.raw_text}</pre></>}</section>
    </div>}
  </section>;
}
