import { useState } from "react";
import {
  Search,
  BookOpen,
  Network,
  FileText,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Layers,
  FileCheck2,
  ExternalLink,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Link, useRouter } from "../router";
import { useOfficialStatus, displayCount, connectionLabel } from "../OfficialLaws";
import "./home.css";

const POPULAR_LAWS = [
  { title: "개인정보 보호법", query: "개인정보 보호법", category: "법률" },
  { title: "공공데이터의 제공 및 이용 활성화에 관한 법률", query: "공공데이터", category: "법률" },
  { title: "건축법", query: "건축법", category: "법률" },
  { title: "근로기준법", query: "근로기준법", category: "법률" },
  { title: "지방자치법", query: "지방자치법", category: "법률" },
  { title: "행정기본법", query: "행정기본법", category: "법률" },
];

export function HomePage() {
  const { navigate } = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const { status, retry } = useOfficialStatus();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const params = new URLSearchParams({ q: searchQuery.trim() });
    if (selectedSource) params.set("source", selectedSource);
    navigate(`/laws?${params.toString()}`);
  };

  const quickSearch = (query: string) => {
    navigate(`/laws?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="home-container">
      {/* Hero Section */}
      <section className="home-hero">
        <div className="hero-badge">
          <Sparkles size={14} />
          <span>공식 법제처 API 연동 대한민국 법령 · 자치법규 통합 포털</span>
        </div>

        <h1 className="hero-title">
          법령을 찾고, 위임 근거를 연결하며,
          <br />
          <em>개정 검토를 한곳에서 준비하세요.</em>
        </h1>

        <p className="hero-desc">
          RuleCraft는 대한민국 법령 5천여 건, 행정규칙 2만여 건, 자치법규 16만여 건의
          공식 원문과 조·항·호 체계 및 상·하위 인용 관계를 검토하는 워크스페이스입니다.
        </p>

        {/* Main Search Bar */}
        <div className="hero-search-box">
          <form onSubmit={handleSearch} className="hero-search-form">
            <div className="search-input-wrap">
              <Search size={22} className="search-lead-icon" />
              <input
                type="text"
                className="hero-search-input"
                placeholder="검토할 법령명이나 키워드를 입력하세요 (예: 개인정보, 전자정부, 소방시설)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <select
              className="search-source-select"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
            >
              <option value="">전체 자료 유형</option>
              <option value="law">법률 · 명령</option>
              <option value="administrative">행정규칙</option>
              <option value="ordinance">자치법규</option>
            </select>
            <button type="submit" className="hero-search-submit">
              <span>법령 검색</span>
              <ArrowRight size={18} />
            </button>
          </form>

          {/* Quick Keywords */}
          <div className="hero-quick-tags">
            <span className="quick-label">자주 찾는 법령:</span>
            {POPULAR_LAWS.map((law) => (
              <button
                key={law.title}
                type="button"
                className="quick-tag-btn"
                onClick={() => quickSearch(law.query)}
              >
                {law.title}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Database Status Strip */}
      <section className="status-strip">
        <div className="status-strip-header">
          <div className="status-lead">
            <ShieldCheck size={18} className="status-icon" />
            <strong>보관된 공식 원문 현황</strong>
            <span className={`status-pill ${status.phase === "connected" ? "connected" : "pending"}`}>
              {connectionLabel(status)}
            </span>
          </div>
          <button className="status-retry-btn" onClick={retry} disabled={status.phase === "loading"}>
            <RefreshCw size={13} />
            <span>상태 갱신</span>
          </button>
        </div>

        <div className="status-strip-grid">
          <div className="status-card">
            <span className="card-label">전체 법령 문서</span>
            <strong className="card-value">
              {displayCount(status)}
              <small>건</small>
            </strong>
            <span className="card-desc">법령 · 행정규칙 · 자치법규</span>
          </div>

          <div className="status-card">
            <span className="card-label">보존된 공식 버전</span>
            <strong className="card-value">
              {displayCount(status, "stored_versions")}
              <small>개</small>
            </strong>
            <span className="card-desc">이력별 무결성 SHA-256 검증</span>
          </div>

          <div className="status-card">
            <span className="card-label">법률 및 대통령령</span>
            <strong className="card-value">
              {status.data?.sources.find((s) => s.source === "law")?.stored_documents?.toLocaleString("ko-KR") || "5,631"}
              <small>건</small>
            </strong>
            <span className="card-desc">국가법령 전문 및 조항호 분석</span>
          </div>

          <div className="status-card">
            <span className="card-label">행정규칙 및 고시</span>
            <strong className="card-value">
              {status.data?.sources.find((s) => s.source === "administrative")?.stored_documents?.toLocaleString("ko-KR") || "23,719"}
              <small>건</small>
            </strong>
            <span className="card-desc">중앙부처 훈령 · 예규 · 고시</span>
          </div>
        </div>
      </section>

      {/* Core Workflow Pillars */}
      <section className="home-features">
        <div className="section-head">
          <span className="section-kicker">핵심 기능 안내</span>
          <h2>흩어진 법령 문서를 하나의 검토 흐름으로</h2>
          <p>법령 검색부터 상·하위 조문 위임 체계 확인, 별표 서식 열람, 개정 초안 작성까지 원스톱으로 지원합니다.</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-wrap law">
              <BookOpen size={24} />
            </div>
            <h3>공식 원문 & 조·항·호 탐색</h3>
            <p>
              법령의 전체 텍스트뿐만 아니라 조·항·호·목 단위로 구조화된 문서를 열람하고,
              조문 내 상호참조와 타 법령 인용을 명확히 대조합니다.
            </p>
            <Link to="/laws" className="feature-link">
              <span>법령 검색 및 열람 시작</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrap topic">
              <Network size={24} />
            </div>
            <h3>주제별 상·하위 위임 체계</h3>
            <p>
              법률에서 시행령, 부처 고시·세부기준으로 이어지는 위임 체계와 근거 조문을
              한눈에 흐름도로 대조하여 개정 영향 범위를 파악합니다.
            </p>
            <Link to="/topics" className="feature-link">
              <span>위임 체계 지도 살펴보기</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrap attachment">
              <FileText size={24} />
            </div>
            <h3>별표 · 서식 및 변환본</h3>
            <p>
              법령에 포함된 PDF, HWP 등 별표·서식 원본과 Docling 기반으로
              정제된 Markdown, JSON 변환본을 바로 내려받아 검토합니다.
            </p>
            <Link to="/attachments" className="feature-link">
              <span>별표 · 서식 라이브러리</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrap draft">
              <FileCheck2 size={24} />
            </div>
            <h3>개정 검토 초안 7종 패키지</h3>
            <p>
              현행 조문과 변경안을 입력하면 신구조문대비표, 개정이유서,
              영향검토서 등 실무 검토 문서를 브라우저에서 즉시 생성합니다.
            </p>
            <Link to="/laws" className="feature-link">
              <span>법령 선택 후 초안 작성</span>
              <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Guide Banner */}
      <section className="home-banner">
        <div className="banner-content">
          <div className="banner-text">
            <h3>AI 도구(Claude, ChatGPT 등)와 MCP로 연결할 수 있습니다</h3>
            <p>
              RuleCraft의 로컬 MCP 서버를 등록하면 "개인정보보호법 제15조의 상위 근거를 찾아줘"와 같이
              자연어로 법령 조문과 신구조문대비표를 조회할 수 있습니다.
            </p>
          </div>
          <div className="banner-actions">
            <Link to="/guide" className="banner-btn primary">
              <span>MCP 연결 가이드</span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/demo" className="banner-btn secondary">
              <span>합성 예제 체험관</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
