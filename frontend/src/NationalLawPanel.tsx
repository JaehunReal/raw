import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Download, ExternalLink, FileText, Loader2, RefreshCw, Search, ShieldCheck, Square,
} from "lucide-react";
import "./national-laws.css";

type Source = "law" | "administrative" | "ordinance";
const SOURCES: { id: Source; label: string; description: string }[] = [
  { id: "law", label: "법령", description: "법률 · 대통령령 · 총리령 · 부령" },
  { id: "administrative", label: "행정규칙", description: "훈령 · 예규 · 고시 등" },
  { id: "ordinance", label: "자치법규", description: "지방자치단체 조례 · 규칙" },
];
type CollectionError = { code?: string; message?: string; title?: string; law_id?: string; status_code?: number | string } | string;
type SourceCoverage = {
  expected: number | null; collected: number; failed: number; status: string;
  complete?: boolean;
  errors?: CollectionError[]; last_synced_at?: string | null;
};
type Coverage = {
  complete: boolean; scope: Source[]; sources: Partial<Record<Source, SourceCoverage>>;
  last_synced_at?: string | null; limitations?: string[]; scope_description?: string;
};
type Job = {
  id: string; status: string; started_at?: string; finished_at?: string;
  progress?: Record<string, unknown> | string | number;
};
type Status = { configured: boolean; missing_requirements?: string[]; coverage: Coverage; job: Job | null };
type LawRecord = {
  law_id: string; source: Source; source_id: string; version_id: string; title: string;
  effective_date?: string; publication_date?: string; publication_no?: string;
  source_url?: string; fetched_at?: string; sha256?: string; text?: string; markdown?: string;
  as_of?: string; temporal_verified?: boolean; raw_integrity_verified?: boolean;
  provisions?: {
    article_no?: string; title?: string; text?: string;
    paragraphs?: { paragraph_no?: string; text?: string; items?: { item_no?: string; text?: string }[] }[];
  }[];
};
type SearchResult = { items: LawRecord[]; total: number; coverage: Coverage };
type LawChange = {
  law_id: string; title: string; source: Source; change_type: string;
  before_version_id?: string | null; after_version_id?: string | null;
  before_sha256?: string | null; after_sha256?: string | null;
  impact?: { count: number; scope: string; applicability_verified: boolean;
    impacted_nodes: { id: string; title: string; rule_name?: string; path?: string; demo?: boolean }[] };
};
type ChangeResult = { items: LawChange[]; total: number; run_id?: string | null; limit: number; offset: number };
const PAGE_SIZE = 20;
const ACTIVE = new Set(["pending", "queued", "running", "cancelling"]);
const EMPTY_COVERAGE: Coverage = { complete: false, scope: [], sources: {} };

async function readJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/laws${path}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : detail?.message || detail?.error || body?.message;
    throw new Error(typeof message === "string" ? message : `요청을 처리하지 못했습니다 (HTTP ${response.status}).`);
  }
  return body as T;
}
function sourceLabel(source: string) {
  return SOURCES.find((item) => item.id === source)?.label || source;
}
function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function knownExpected(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function sourceStatus(value: string | undefined, errors: CollectionError[] = []) {
  if (value === "blocked") {
    const details = errors.filter((error) => typeof error !== "string");
    if (details.some((error) => error.code === "missing_credentials")) return "설정 필요";
    if (details.some((error) => error.code === "access_denied" || Number(error.status_code) === 403)) return "접근 차단";
    return "수집 보류";
  }
  return ({ not_synced: "미수집", pending: "미수집", queued: "수집 대기", running: "수집 중", completed: "수집 완료", complete: "수집 완료", success: "수집 완료",
    failed: "수집 실패", cancelled: "수집 중단", cancelling: "중단 요청 중" } as Record<string, string>)[value || ""] || "상태 미확인";
}
function timeLabel(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}
function errorMessage(error: CollectionError) {
  return typeof error === "string" ? error : error.message || "해당 자료를 수집하지 못했습니다.";
}
function safeSourceUrl(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function progressLabel(progress: Job["progress"]) {
  if (typeof progress === "string") return progress;
  if (typeof progress === "number") return `처리 진행: ${progress}`;
  if (!progress) return "수집 결과가 도착하는 대로 진행 상황을 갱신합니다.";
  if (typeof progress.message === "string") return progress.message;
  const phase = ({ starting: "수집 준비", catalogue: "수집 대상 확인", listing: "수집 대상 확인", list: "수집 대상 확인", detail: "전문 수집", collecting: "전문 수집", completed: "수집 결과 정리" } as Record<string, string>)[String(progress.phase || "")] || "수집 진행 중";
  const source = typeof progress.source === "string" ? `${sourceLabel(progress.source)} · ` : "";
  const processed = typeof progress.collected === "number" ? ` · 전문 ${progress.collected}건 수집` : typeof progress.processed === "number" ? ` · ${progress.processed}건 처리` : "";
  const pages = typeof progress.page === "number" ? ` · 목록 ${progress.page}페이지 확인` : "";
  const failures = typeof progress.failed === "number" && progress.failed > 0 ? ` · 실패 ${progress.failed}건` : "";
  return `${source}${phase}${pages}${processed}${failures}`;
}

export default function NationalLawPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Source[]>(SOURCES.map((item) => item.id));
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [asOf, setAsOf] = useState("");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [reload, setReload] = useState(0);
  const [changes, setChanges] = useState<ChangeResult | null>(null);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changesError, setChangesError] = useState("");
  const [changesOffset, setChangesOffset] = useState(0);
  const [selected, setSelected] = useState<LawRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [documentView, setDocumentView] = useState<"text" | "articles">("text");
  const detailRequest = useRef<AbortController | null>(null);
  const coverage = status?.coverage || search?.coverage || EMPTY_COVERAGE;
  const jobActive = !!status?.job && ACTIVE.has(status.job.status);
  const scope = Array.isArray(coverage.scope) ? coverage.scope.filter((kind) => SOURCES.some((item) => item.id === kind)) : [];
  const collectedTotal = SOURCES.reduce((sum, item) => sum + count(coverage.sources[item.id]?.collected), 0);
  const failedTotal = SOURCES.reduce((sum, item) => sum + count(coverage.sources[item.id]?.failed), 0);
  // Missing denominators or unfinished sources must never imply complete coverage.
  const complete = coverage.complete === true && !statusLoading && !statusError && !jobActive && scope.length > 0 && collectedTotal > 0 && scope.every((kind) => {
    const item = coverage.sources[kind];
    return !!item && item.complete === true && ["complete", "completed", "success"].includes(item.status) && knownExpected(item.expected) !== null && item.collected === item.expected && count(item.failed) === 0 && !item.errors?.length;
  });
  const blocked = status?.configured === false || SOURCES.some((item) => ["blocked", "failed"].includes(coverage.sources[item.id]?.status || ""));
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await readJson<Status>("/status"));
      setStatusError("");
    } catch (error) { setStatusError((error as Error).message); }
    finally { setStatusLoading(false); }
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!jobActive) return;
    const timer = window.setInterval(() => { void loadStatus(); setReload((value) => value + 1); }, 2500);
    return () => window.clearInterval(timer);
  }, [jobActive, loadStatus]);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ q: submittedQuery, limit: String(PAGE_SIZE), offset: String(offset) });
    if (source) parameters.set("source", source);
    if (asOf) parameters.set("as_of", asOf);
    setSearchLoading(true);
    setSearchError("");
    readJson<SearchResult>(`?${parameters}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setSearch(result);
    }).catch((error) => {
      if (!controller.signal.aborted) setSearchError((error as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    return () => controller.abort();
  }, [submittedQuery, source, asOf, offset, reload]);
  useEffect(() => { detailRequest.current?.abort(); setSelected(null); setDetailError(""); setDetailLoading(false); }, [asOf]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => { setChangesOffset(0); }, [source]);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(changesOffset) });
    if (source) parameters.set("source", source);
    setChangesLoading(true); setChangesError("");
    readJson<ChangeResult>(`/changes?${parameters}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setChanges(result);
    }).catch((error) => {
      if (!controller.signal.aborted) setChangesError((error as Error).message);
    }).finally(() => { if (!controller.signal.aborted) setChangesLoading(false); });
    return () => controller.abort();
  }, [source, changesOffset, reload]);

  async function synchronize() {
    setActionBusy(true); setActionError("");
    try {
      const result = await readJson<{ job: Job }>("/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources: selectedSources }) });
      setStatus((previous) => previous ? { ...previous, job: result.job } : previous);
    } catch (error) { setActionError((error as Error).message); }
    finally { await loadStatus(); setReload((value) => value + 1); setActionBusy(false); }
  }
  async function cancel() {
    setActionBusy(true); setActionError("");
    try { await readJson("/sync/cancel", { method: "POST" }); }
    catch (error) { setActionError((error as Error).message); }
    finally { await loadStatus(); setActionBusy(false); }
  }
  async function openLaw(record: LawRecord) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true); setDetailError(""); setSelected(null); setDocumentView("text");
    const parameters = asOf ? `?${new URLSearchParams({ as_of: asOf })}` : "";
    try {
      const loaded = await readJson<LawRecord>(`/${record.source}/${encodeURIComponent(record.source_id)}${parameters}`, { signal: controller.signal });
      if (!controller.signal.aborted) setSelected(loaded);
    } catch (error) { if (!controller.signal.aborted) setDetailError((error as Error).message); }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }
  const sourceUrl = safeSourceUrl(selected?.source_url);
  const selectedText = selected?.text || selected?.markdown || "";
  return (
    <div className="national-laws" data-testid="laws-panel">
      <div className="page-heading laws-page-heading">
        <div>
          <div className="eyebrow"><span className="small-line" /> OFFICIAL LAW CORPUS</div>
          <h1>공식 원문을 모으고, 근거를 확인하세요.</h1>
          <p>법령·행정규칙·자치법규의 수집 범위와 실제 확보한 전문을 확인합니다.</p>
        </div>
        <button className="button secondary" onClick={() => { void loadStatus(); setReload((value) => value + 1); }} disabled={statusLoading}>
          <RefreshCw size={15} /> 상태 새로고침
        </button>
      </div>
      <section className={`laws-coverage ${complete ? "complete" : blocked ? "blocked" : ""}`} data-testid="laws-status" data-complete={String(complete)} data-status={complete ? "complete" : jobActive ? "running" : blocked ? "blocked" : "incomplete"}>
        <span className="laws-coverage-icon">{jobActive ? <Loader2 size={25} className="spin" /> : complete ? <CheckCircle2 size={25} /> : <BookOpen size={25} />}</span>
        <div>
          <strong>{statusLoading ? "공식 법령 수집 상태를 확인하고 있습니다." : complete ? "선택 범위 수집 완료" : jobActive ? "공식 법령을 수집하고 있습니다." : blocked ? "공식 법령 수집에 필요한 접근을 확인하세요." : "공식 법령 전체 반영이 완료되지 않았습니다."}</strong>
          <p>{complete ? "공식 API 목록의 전체 페이지와 전문 수집 건수를 대조했습니다. 수집한 범위의 원문 확보를 뜻하며, 법률 해석과 적용 가능성은 별도 검토가 필요합니다." : "수집 대상 수·누락·실패가 확인되기 전에는 전체 반영 완료로 표시하지 않습니다."}</p>
        </div>
        <span className={`pill ${complete ? "sage" : "warning"}`} data-testid="laws-completion-badge">{complete ? "선택 범위 수집 완료" : jobActive ? "수집 중 · 전체 반영 미완료" : "전체 반영 미완료"}</span>
      </section>
      {(statusError || actionError) && <div className="laws-alert" role="alert"><AlertTriangle size={17} /><span>{actionError || statusError}</span></div>}
      {status?.configured === false && <div className="laws-requirements" data-testid="laws-requirements">
        <ShieldCheck size={19} /><div><strong>국가법령 공동활용 API 연결 설정이 필요합니다.</strong><p>환경 설정에서 <code>RULECRAFT_LAW_OC</code>를 등록한 후 수집 상태를 새로고침하세요. 아직 수집하지 못한 법령을 반영 완료로 간주하지 않습니다.</p>
          {!!status.missing_requirements?.length && <small>미충족 항목: {status.missing_requirements.join(", ")}</small>}
        </div>
      </div>}
      <section className="panel laws-collection-panel">
        <div className="panel-heading"><div><h3>수집 범위와 커버리지</h3><p>분류별 대상 수와 전문 수집 결과를 확인합니다.</p></div><span className="laws-last-sync"><Clock3 size={13} /> 최근 수집: {timeLabel(coverage.last_synced_at)}</span></div>
        <div className="laws-source-grid">
          {SOURCES.map((item) => {
            const data = coverage.sources[item.id]; const expected = knownExpected(data?.expected);
            const collected = count(data?.collected); const failed = count(data?.failed);
            const sourceComplete = data?.complete === true && expected !== null && expected === collected && failed === 0 && !data.errors?.length;
            const statusLabel = !data ? "이번 범위 제외" : ["complete", "completed", "success"].includes(data.status) && !sourceComplete ? "일부 수집 · 대조 미완료" : sourceStatus(data.status, data.errors);
            const percent = expected !== null && expected > 0 ? Math.min(100, (collected / expected) * 100) : 0;
            return <div className="laws-source-card" key={item.id} data-testid={`laws-source-${item.id}`}>
              <div className="laws-source-heading"><label><input type="checkbox" aria-label={`${item.label} 수집 범위`} checked={selectedSources.includes(item.id)} disabled={jobActive || actionBusy} onChange={(event) => setSelectedSources((previous) => event.target.checked ? [...previous, item.id] : previous.filter((value) => value !== item.id))} /><strong>{item.label}</strong></label><span className={`pill ${sourceComplete ? "sage" : ["failed", "blocked"].includes(data?.status || "") ? "warning" : "neutral"}`}>{statusLabel}</span></div>
              <p>{item.description}</p>
              <div className="laws-source-count"><strong data-testid={`laws-source-${item.id}-collected`}>{data ? collected.toLocaleString("ko-KR") : "—"}</strong><span>/ <span data-testid={`laws-source-${item.id}-expected`}>{expected === null ? "대상 수 미확인" : `${expected.toLocaleString("ko-KR")}건`}</span></span></div>
              <div className="laws-progress-track" role="progressbar" aria-label={`${item.label} 전문 수집`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={expected === null ? undefined : percent} aria-valuetext={`${collected}건 수집, ${expected === null ? "대상 수 미확인" : `${expected}건 대상`}`}><span style={{ width: `${percent}%` }} /></div>
              <div className="laws-source-details"><span>실패 <b>{data ? `${failed.toLocaleString("ko-KR")}건` : "미확인"}</b></span><span>미수집 <b>{expected === null ? "미확인" : `${Math.max(0, expected - collected).toLocaleString("ko-KR")}건`}</b></span></div>
              <small className="laws-source-last-sync">마지막 수집: {timeLabel(data?.last_synced_at)}</small>
              {!!data?.errors?.length && <details className="laws-source-errors" open={data.status === "blocked" || data.status === "failed"}><summary>수집 오류 {data.errors.length}건</summary><ul>{data.errors.map((error, index) => <li key={index}>{errorMessage(error)}{typeof error !== "string" && (error.title || error.law_id) && <small>{error.title || error.law_id}</small>}</li>)}</ul></details>}
            </div>;
          })}
        </div>
        <div className="laws-collection-actions"><div><strong data-testid="laws-count">공식 전문 {collectedTotal.toLocaleString("ko-KR")}건 수집</strong><span>실패 {failedTotal.toLocaleString("ko-KR")}건 · 마지막 수집 범위: {scope.length ? scope.map(sourceLabel).join(" · ") : "아직 없음"}</span></div>
          {jobActive ? <button className="button secondary" data-testid="laws-cancel" disabled={actionBusy} onClick={() => void cancel()}><Square size={13} /> 수집 중단</button> : <button className="button primary" data-testid="laws-sync" disabled={actionBusy || !status?.configured || !selectedSources.length} onClick={() => void synchronize()}>{actionBusy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}{selectedSources.length === SOURCES.length ? "전체 수집 시작" : "선택 범위 수집"}<ArrowRight size={15} /></button>}
        </div>
        {status?.job && <div className="laws-job" data-testid="laws-job"><Clock3 size={16} /><div><strong>{jobActive ? progressLabel(status.job.progress) : `최근 수집 작업: ${sourceStatus(status.job.status)}`}</strong><small>시작 {timeLabel(status.job.started_at)}{status.job.finished_at ? ` · 종료 ${timeLabel(status.job.finished_at)}` : ""}</small></div></div>}
        {coverage.scope_description && <p className="laws-scope-description">{coverage.scope_description}</p>}
        {!!coverage.limitations?.length && <div className="laws-limitations"><AlertTriangle size={16} /><div>{coverage.limitations.map((item, index) => <p key={index}>{item}</p>)}</div></div>}
      </section>
      <form className="laws-search-toolbar" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query.trim()); setOffset(0); }}>
        <div className="search-input"><Search size={17} /><input aria-label="공식 법령 검색" placeholder="법령명으로 수집한 원문 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <label>분류<select aria-label="공식 법령 분류" value={source} onChange={(event) => { setSource(event.target.value as Source | ""); setOffset(0); }}><option value="">전체 분류</option>{SOURCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>조회 기준일<input aria-label="법령 조회 기준일" type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); setOffset(0); }} /></label>
        <button className="button secondary" type="submit"><Search size={14} /> 검색</button>
      </form>
      <p className="laws-as-of-note">기준일 조회는 저장된 버전을 대상으로 합니다. 수집하지 않은 과거 법령의 존재 여부나 내용을 추정하지 않습니다.</p>
      <section className="panel laws-changes" data-testid="laws-changes">
        <div className="panel-heading"><div><h3>원문 변경과 영향 후보 <span className="count-tag">{changes?.total || 0}</span></h3><p>최근 수집 작업의 원문 차이와 지식 저장소에 선언된 참조를 확인합니다.</p></div>{changesLoading && <Loader2 size={17} className="spin" />}</div>
        <p className="laws-changes-scope">기준일 검색과 별도로 최근 수집 작업을 표시합니다. 영향 후보는 등록된 내부 참조에서 찾으며, 기관 규정에 대한 실제 적용 여부는 검증하지 않았습니다.</p>
        {changesError && <div className="laws-alert" role="alert"><AlertTriangle size={16} /><span>{changesError}</span></div>}
        {!changesLoading && !changesError && !changes?.items?.length && <p className="laws-changes-empty" data-testid="laws-changes-empty">수집한 원문 변경이 없습니다. 수집하지 않은 법령의 변경 여부를 뜻하지 않습니다.</p>}
        <div className="laws-change-list">{changes?.items?.map((change, index) => <article key={`${change.law_id}:${change.after_version_id || change.before_version_id}:${index}`}>
          <div className="laws-change-heading"><span className="pill neutral">{change.change_type === "added" ? "신규 수집" : change.change_type === "updated" ? "원문 변경" : change.change_type === "removed_from_catalogue" ? "이번 목록에서 제외" : "수집 결과 변경"}</span><strong>{change.title}</strong><small>{sourceLabel(change.source)}</small>
            {change.change_type !== "removed_from_catalogue" && <button onClick={() => void openLaw({ law_id: change.law_id, source: change.source, source_id: change.law_id, title: change.title, version_id: change.after_version_id || "" })}>{asOf ? "기준일 전문 보기" : "수집 전문 보기"} <ArrowRight size={12} /></button>}
          </div>
          {change.change_type === "removed_from_catalogue" && <p>최근 수집 목록에서 제외되었습니다. 법령 폐지를 확정하는 표시가 아닙니다.</p>}
          <details><summary>저장소 영향 후보 {count(change.impact?.count)}건 · 적용 여부 미검증</summary>{change.impact?.impacted_nodes?.length ? <ul>{change.impact.impacted_nodes.map((node) => <li key={node.id}><strong>{node.rule_name || node.title}</strong><span>{node.title} · {node.id}{node.demo ? " · 시연 자료" : " · 등록 자료"}</span></li>)}</ul> : <p>등록된 참조에서 영향 후보를 찾지 못했습니다. 실제 영향이 없다는 판단은 아닙니다.</p>}</details>
          <details className="laws-change-version"><summary>이전·이후 수집 버전 확인</summary><dl><div><dt>이전 버전</dt><dd>{change.before_version_id || "없음"}</dd></div><div><dt>이후 버전</dt><dd>{change.after_version_id || "이번 목록에 없음"}</dd></div><div><dt>이전 원문 해시</dt><dd>{change.before_sha256 || "없음"}</dd></div><div><dt>이후 원문 해시</dt><dd>{change.after_sha256 || "없음"}</dd></div></dl></details>
        </article>)}</div>
        {!!changes?.total && <div className="laws-pagination"><button className="icon-button" aria-label="이전 원문 변경 페이지" disabled={changesOffset === 0 || changesLoading} onClick={() => setChangesOffset(Math.max(0, changesOffset - PAGE_SIZE))}><ChevronLeft size={17} /></button><span>{Math.floor(changesOffset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(changes.total / PAGE_SIZE))}</span><button className="icon-button" aria-label="다음 원문 변경 페이지" disabled={changesOffset + PAGE_SIZE >= changes.total || changesLoading} onClick={() => setChangesOffset(changesOffset + PAGE_SIZE)}><ChevronRight size={17} /></button></div>}
      </section>
      <div className="laws-workbench">
        <section className="panel laws-results"><div className="panel-heading"><div><h3>수집한 공식 법령 <span className="count-tag">{search?.total || 0}</span></h3><p>시연용 지식 저장소와 구분하여 조회합니다.</p></div>{searchLoading && <Loader2 size={17} className="spin" />}</div>
          {searchError && <div className="laws-alert" role="alert"><AlertTriangle size={16} /><span>{searchError}</span></div>}
          {!searchLoading && !searchError && !search?.items?.length && <div className="empty-state" data-testid="laws-empty"><BookOpen size={30} /><h3>{collectedTotal === 0 ? "수집한 공식 원문이 없습니다." : "조회 조건에 맞는 원문이 없습니다."}</h3><p>{collectedTotal === 0 ? "연결 설정과 수집 결과를 먼저 확인하세요. 시연 자료는 공식 수집 건수에 포함하지 않습니다." : "검색어, 분류 또는 기준일을 확인하세요."}</p></div>}
          <div className="laws-record-list">{search?.items?.map((record) => <button key={`${record.source}:${record.source_id}:${record.version_id}`} className={selected?.version_id === record.version_id ? "selected" : ""} onClick={() => void openLaw(record)}><span className="file-icon"><FileText size={17} /></span><span><strong>{record.title}</strong><small>{sourceLabel(record.source)} · 시행일 {record.effective_date || "미확인"}</small><small>수집 {timeLabel(record.fetched_at)}</small></span><ChevronRight size={15} /></button>)}</div>
          {!!search?.total && <div className="laws-pagination"><button className="icon-button" aria-label="이전 법령 페이지" disabled={offset === 0 || searchLoading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft size={17} /></button><span>{Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(search.total / PAGE_SIZE))}</span><button className="icon-button" aria-label="다음 법령 페이지" disabled={offset + PAGE_SIZE >= search.total || searchLoading} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight size={17} /></button></div>}
        </section>
        <section className="panel laws-document" data-testid="laws-document">
          {!selected && !detailLoading && !detailError && <div className="empty-state"><FileText size={33} /><h3>법령의 전문과 출처를 확인하세요.</h3><p>왼쪽에서 수집된 법령을 선택하면<br />기준일, 원문 출처와 수집한 내용을 표시합니다.</p></div>}
          {detailLoading && <div className="empty-state"><Loader2 size={30} className="spin" /><h3>수집된 법령 버전을 불러오고 있습니다.</h3></div>}
          {detailError && <div className="laws-alert" role="alert"><AlertTriangle size={17} /><span>{detailError}</span></div>}
          {selected && <>
            <div className="laws-document-heading"><span className="pill sage">{sourceLabel(selected.source)} · 수집 원문</span><h2>{selected.title}</h2><p>조회 기준일: {asOf || "최근 수집 버전"}</p>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="laws-source-link"><ExternalLink size={14} /> 공식 원문 출처 확인</a> : <span className="laws-missing-source">원문 주소가 저장되지 않았습니다.</span>}</div>
            <dl className="laws-document-meta"><div><dt>공포일</dt><dd>{selected.publication_date || "미확인"}</dd></div><div><dt>시행일</dt><dd>{selected.effective_date || "미확인"}</dd></div><div><dt>공포번호</dt><dd>{selected.publication_no || "미확인"}</dd></div><div><dt>수집 시각</dt><dd>{timeLabel(selected.fetched_at)}</dd></div></dl>
            {selected.raw_integrity_verified === false && <div className="laws-alert" role="alert"><AlertTriangle size={16} /><span>저장된 원문 파일이 수집 당시의 내용과 일치하는지 확인하지 못했습니다. 공식 출처를 확인하세요.</span></div>}
            <p className="laws-temporal-note">{selected.temporal_verified === true ? "조회 기준일에 기록된 수집 목록과 일치합니다. 법적 효력과 해석까지 검증한 결과는 아닙니다." : "조회 기준일의 수집 목록 일치 여부가 검증되지 않았습니다. 해당 시점의 법적 효력을 확정하지 않습니다."}</p>
            <div className="laws-document-tabs"><button className={documentView === "text" ? "active" : ""} onClick={() => setDocumentView("text")}>수집 전문</button><button className={documentView === "articles" ? "active" : ""} disabled={!selected.provisions?.length} onClick={() => setDocumentView("articles")}>구조화 조문 ({selected.provisions?.length || 0})</button></div>
            {documentView === "text" ? selectedText ? <pre className="laws-document-text" data-testid="laws-full-text">{selectedText}</pre> : <div className="laws-alert"><AlertTriangle size={16} /> 저장된 본문이 없습니다. 원문 출처를 확인하세요.</div> : <div className="laws-provisions">{selected.provisions?.map((article, index) => <article key={index}><h3>{article.article_no} {article.title}</h3>{article.text && <p>{article.text}</p>}{article.paragraphs?.map((paragraph, p) => <div key={p}><p>{paragraph.paragraph_no} {paragraph.text}</p>{paragraph.items?.map((item, i) => <p key={i}>{item.item_no} {item.text}</p>)}</div>)}</article>)}</div>}
            <p className="laws-document-foot">이 화면은 수집한 원문 버전을 보여줍니다. 적용할 시점의 효력과 관련 법령은 공식 출처 및 담당자 검토로 확인하세요.</p>
          </>}
        </section>
      </div>
    </div>
  );
}
