import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Search,
  BookOpen,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  FileText,
  Network,
  FileCheck2,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useRouter } from "../router";
import {
  useOfficialStatus,
  officialSources,
  type OfficialStatus,
} from "../OfficialLaws";
import OfficialProvisions from "../OfficialProvisions";
import { OfficialRelations } from "../OfficialRelations";
import OfficialReview from "../OfficialReview";
import type { Provision } from "../provisionLinks";
import "./laws.css";

type Source = typeof officialSources[number]["id"];

type LawRecord = {
  source: Source;
  law_id: string;
  version_id: string;
  title: string;
  effective_date: string | null;
  publication_date: string | null;
  source_url: string | null;
  raw_sha256: string | null;
  stored_at: string | null;
};

type LawList = {
  items: LawRecord[];
  total: number;
  limit: number;
  offset: number;
};

type LawDocument = LawRecord & {
  raw_text: string;
  provisions?: Provision[];
};

type ReaderTab = "provisions" | "relations" | "review" | "raw";

function officialUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(url.hostname === "law.go.kr" || url.hostname.endsWith(".law.go.kr")) ||
      [...url.searchParams.keys()].some((key) => key.toLowerCase() === "oc")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

const sourceName = (source: Source) =>
  officialSources.find((item) => item.id === source)?.label || source;

export function LawsPage() {
  const { searchParams, navigate } = useRouter();
  const { status, retry } = useOfficialStatus();

  // URL state
  const initialQ = searchParams.get("q") || "";
  const initialSource = (searchParams.get("source") as Source) || "";
  const initialLawId = searchParams.get("law_id") || "";
  const initialVersionId = searchParams.get("version_id") || "";
  const initialOffset = parseInt(searchParams.get("offset") || "0", 10) || 0;
  const initialArticle = searchParams.get("article") || null;

  const [searchInput, setSearchInput] = useState(initialQ);
  const [selectedSource, setSelectedSource] = useState(initialSource);
  const [activeTab, setActiveTab] = useState<ReaderTab>(initialArticle ? "provisions" : "provisions");
  const [jumpArticle, setJumpArticle] = useState<string | null>(initialArticle);
  const [copiedHash, setCopiedHash] = useState(false);

  // Sync jumpArticle when URL parameter changes
  useEffect(() => {
    const art = searchParams.get("article");
    if (art) {
      setJumpArticle(art);
      setActiveTab("provisions");
    }
  }, [searchParams]);

  // List State
  const [list, setList] = useState<LawList | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);

  // Document State
  const [document, setDocument] = useState<LawDocument | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(false);

  const readerRef = useRef<HTMLDivElement>(null);

  // Sync search input when URL query changes
  useEffect(() => {
    setSearchInput(initialQ);
  }, [initialQ]);

  useEffect(() => {
    setSelectedSource(initialSource);
  }, [initialSource]);

  // Search Submit
  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set("q", searchInput.trim());
    if (selectedSource) params.set("source", selectedSource);
    params.set("offset", "0");
    if (status.phase !== "connected") {
      retry();
    }
    navigate(`/laws?${params.toString()}`);
  };

  // Fetch List when query changes or when status becomes connected
  useEffect(() => {
    if (status.phase !== "connected") {
      setList(null);
      setListLoading(false);
      return;
    }
    const controller = new AbortController();
    setListLoading(true);
    setListError(false);

    const params = new URLSearchParams({
      q: initialQ,
      limit: "20",
      offset: String(initialOffset),
    });
    if (initialSource) params.set("source", initialSource);

    fetch(`/api/official/laws?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setList(data);
          setListLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setListError(true);
          setListLoading(false);
        }
      });

    return () => controller.abort();
  }, [initialQ, initialSource, initialOffset, status.phase]);

  // Fetch Document when law_id/version_id changes
  useEffect(() => {
    if (!initialLawId || !initialVersionId || !initialSource) {
      setDocument(null);
      return;
    }

    const controller = new AbortController();
    setDocLoading(true);
    setDocError(false);

    const params = new URLSearchParams({
      source: initialSource,
      law_id: initialLawId,
      version_id: initialVersionId,
    });

    fetch(`/api/official/document?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted && data.document) {
          setDocument(data.document);
          setDocLoading(false);
          readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDocError(true);
          setDocLoading(false);
        }
      });

    return () => controller.abort();
  }, [initialLawId, initialVersionId, initialSource]);

  // Select Law item (with optional target provision)
  const handleSelectLaw = (item: LawRecord, article?: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("source", item.source);
    params.set("law_id", item.law_id);
    params.set("version_id", item.version_id);
    if (article) {
      params.set("article", article);
      setJumpArticle(article);
      setActiveTab("provisions");
    } else {
      params.delete("article");
      setJumpArticle(null);
    }
    navigate(`/laws?${params.toString()}`);
  };

  // Jump to provision within current law
  const handleJumpCurrentProvision = (article: string) => {
    setJumpArticle(article);
    setActiveTab("provisions");
    const params = new URLSearchParams(searchParams);
    params.set("article", article);
    navigate(`/laws?${params.toString()}`);
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const currentSourceUrl = document ? officialUrl(document.source_url) : null;

  return (
    <div className="laws-page">
      {/* Search Header Strip */}
      <section className="laws-header-card">
        <div className="laws-header-title">
          <BookOpen size={24} className="header-icon" />
          <div>
            <h1>공식 법령 열람 및 인용 관계 탐색</h1>
            <p>법제처 공식 API에 보존된 19만+ 법령 원문, 조·항·호 체계 및 위임 관계를 확인합니다.</p>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="laws-search-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="법령명 검색 (예: 개인정보보호법, 건축법, 도로교통법)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              maxLength={200}
            />
          </div>

          <select
            value={selectedSource}
            onChange={(e) => {
              setSelectedSource(e.target.value as Source);
            }}
            className="source-select"
          >
            <option value="">전체 유형</option>
            {officialSources.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <button type="submit" className="search-btn">
            검색
          </button>
        </form>
      </section>

      {/* Main Two-column Workbench */}
      <div className="laws-workbench">
        {/* Left Column: Search Results */}
        <aside className="laws-list-panel">
          <div className="panel-top">
            <span className="results-count">
              {listLoading ? (
                "검색 중..."
              ) : list ? (
                `검색 결과 ${list.total.toLocaleString("ko-KR")}건`
              ) : (
                "법령 목록"
              )}
            </span>
            {initialQ && (
              <span className="query-badge">키워드: ‘{initialQ}’</span>
            )}
          </div>

          <div className="laws-scroll-list">
            {status.phase === "loading" && (
              <div className="list-loading">
                <RefreshCw size={20} className="spin" />
                <p>저장소 연결 상태를 확인하고 있습니다...</p>
              </div>
            )}

            {status.phase !== "connected" && status.phase !== "loading" && (
              <div className="list-error">
                <p style={{ fontWeight: 600 }}>
                  {status.phase === "not_configured"
                    ? "법령 저장소(PostgreSQL) 연결 대기 중"
                    : "데이터 저장소에 연결할 수 없습니다"}
                </p>
                <small style={{ color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                  {status.phase === "not_configured"
                    ? "Vercel 배포 시 환경 변수(DATABASE_URL) 설정이 필요합니다."
                    : "로컬 게이트웨이(포트 8766) 상태를 점검해 주세요."}
                </small>
                <button
                  type="button"
                  className="retry-btn"
                  onClick={retry}
                  style={{ marginTop: 12 }}
                >
                  연결 다시 시도
                </button>
              </div>
            )}

            {status.phase === "connected" && listLoading && (
              <div className="list-loading">
                <RefreshCw size={20} className="spin" />
                <p>법령 목록을 불러오고 있습니다...</p>
              </div>
            )}

            {status.phase === "connected" && listError && (
              <div className="list-error">
                <p>목록을 불러오지 못했습니다.</p>
                <button
                  type="button"
                  className="retry-btn"
                  onClick={() => navigate(`/laws?${searchParams.toString()}`)}
                >
                  다시 시도
                </button>
              </div>
            )}

            {status.phase === "connected" && !listLoading && !listError && list?.items.length === 0 && (
              <div className="list-empty">
                <p>일치하는 법령이 없습니다.</p>
                <small>다른 검색어나 유형으로 다시 조회해 보세요.</small>
              </div>
            )}

            {!listLoading &&
              list?.items.map((item) => {
                const isSelected =
                  document?.law_id === item.law_id &&
                  document?.version_id === item.version_id;
                return (
                  <button
                    key={`${item.source}:${item.law_id}:${item.version_id}`}
                    type="button"
                    className={`law-item-btn ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelectLaw(item)}
                  >
                    <div className="item-meta">
                      <span className={`type-tag ${item.source}`}>
                        {sourceName(item.source)}
                      </span>
                      <span className="version-tag">v{item.version_id}</span>
                    </div>
                    <strong className="item-title">{item.title}</strong>
                    <div className="item-dates">
                      <span>시행일: {item.effective_date || "미확인"}</span>
                      {item.publication_date && (
                        <span>공포: {item.publication_date}</span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>

          {/* Pagination */}
          {list && list.total > list.limit && (
            <div className="laws-pagination">
              <button
                disabled={list.offset === 0}
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set(
                    "offset",
                    String(Math.max(0, list.offset - list.limit))
                  );
                  navigate(`/laws?${params.toString()}`);
                }}
              >
                <ChevronLeft size={16} />
                <span>이전</span>
              </button>
              <span className="page-indicator">
                {list.offset + 1} - {Math.min(list.offset + list.items.length, list.total)} / {list.total.toLocaleString("ko-KR")}
              </span>
              <button
                disabled={list.offset + list.limit >= list.total}
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("offset", String(list.offset + list.limit));
                  navigate(`/laws?${params.toString()}`);
                }}
              >
                <span>다음</span>
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </aside>

        {/* Right Column: Law Document Viewer */}
        <section ref={readerRef} className="laws-reader-panel">
          {docLoading && (
            <div className="reader-placeholder">
              <RefreshCw size={26} className="spin" />
              <h3>법령 원문을 조회하고 있습니다...</h3>
              <p>원문과 조항호 구조, 인용 관계를 불러옵니다.</p>
            </div>
          )}

          {docError && (
            <div className="reader-placeholder error">
              <h3>원문을 불러오지 못했습니다</h3>
              <p>네트워크 상태나 법령 식별자를 확인해 주세요.</p>
            </div>
          )}

          {!document && !docLoading && (
            <div className="reader-placeholder empty">
              <BookOpen size={48} className="empty-icon" />
              <h3>조회할 법령을 선택하세요</h3>
              <p>왼쪽 목록에서 법령을 선택하면 원문, 조항호 체계, 인용 관계가 여기에 표시됩니다.</p>
            </div>
          )}

          {document && !docLoading && (
            <div className="document-container">
              {/* Document Header */}
              <div className="doc-header">
                <div className="doc-title-row">
                  <div className="doc-badges">
                    <span className={`type-tag ${document.source}`}>
                      {sourceName(document.source)}
                    </span>
                    <span className="doc-id">법령ID: {document.law_id}</span>
                    <span className="doc-version">버전: {document.version_id}</span>
                  </div>
                  {currentSourceUrl && (
                    <a
                      href={currentSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="official-ext-link"
                    >
                      <span>국가법령정보센터 원문</span>
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>

                <h2 className="doc-title">{document.title}</h2>

                {/* Metadata Grid */}
                <div className="doc-meta-strip">
                  <div className="meta-item">
                    <span>시행일</span>
                    <strong>{document.effective_date || "미확인"}</strong>
                  </div>
                  <div className="meta-item">
                    <span>공포·발령일</span>
                    <strong>{document.publication_date || "미확인"}</strong>
                  </div>
                  <div className="meta-item">
                    <span>저장 시각</span>
                    <strong>{document.stored_at ? new Date(document.stored_at).toLocaleDateString("ko-KR") : "미확인"}</strong>
                  </div>
                  <div className="meta-item hash">
                    <span>SHA-256 무결성 검증</span>
                    <div className="hash-wrap">
                      <code>{document.raw_sha256?.slice(0, 16)}...</code>
                      <button
                        type="button"
                        onClick={() => copyHash(document.raw_sha256 || "")}
                        title="전체 해시 복사"
                      >
                        {copiedHash ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tab Switcher */}
                <div className="doc-tabs">
                  <button
                    className={`tab-btn ${activeTab === "provisions" ? "active" : ""}`}
                    onClick={() => setActiveTab("provisions")}
                  >
                    <FileText size={16} />
                    <span>조·항·호 체계</span>
                    {document.provisions && (
                      <span className="tab-count">{document.provisions.length}</span>
                    )}
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "relations" ? "active" : ""}`}
                    onClick={() => setActiveTab("relations")}
                  >
                    <Network size={16} />
                    <span>인용 및 시행 근거</span>
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "review" ? "active" : ""}`}
                    onClick={() => setActiveTab("review")}
                  >
                    <FileCheck2 size={16} />
                    <span>검토 초안 7종 작성</span>
                  </button>
                  <button
                    className={`tab-btn ${activeTab === "raw" ? "active" : ""}`}
                    onClick={() => setActiveTab("raw")}
                  >
                    <BookOpen size={16} />
                    <span>전체 원문 텍스트</span>
                  </button>
                </div>
              </div>

              {/* Tab Contents */}
              <div className="doc-tab-body">
                {activeTab === "provisions" && (
                  <div className="provisions-tab-wrap">
                    <OfficialProvisions
                      key={`${document.law_id}:${document.version_id}`}
                      provisions={document.provisions || []}
                      initialArticle={jumpArticle}
                    />
                  </div>
                )}

                {activeTab === "relations" && (
                  <div className="relations-tab-wrap">
                    <OfficialRelations
                      record={document}
                      onSelect={(rec, article) => handleSelectLaw(rec as LawRecord, article)}
                      onJumpCurrent={handleJumpCurrentProvision}
                    />
                  </div>
                )}

                {activeTab === "review" && (
                  <div className="review-tab-wrap">
                    <OfficialReview record={document} />
                  </div>
                )}

                {activeTab === "raw" && (
                  <div className="raw-tab-wrap">
                    <pre className="raw-text-content">{document.raw_text}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
