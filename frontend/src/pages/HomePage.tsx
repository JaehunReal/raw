import { useState } from "react";
import {
  Search,
  BookOpen,
  Network,
  FileText,
  ShieldCheck,
  ArrowRight,
  FileCheck2,
  RefreshCw,
  ChevronRight,
  Info,
} from "lucide-react";
import { Link, useRouter } from "../router";
import { useOfficialStatus, displayCount, connectionLabel } from "../OfficialLaws";
import "./home.css";

const POPULAR_LAWS = [
  { title: "개인정보 보호법", query: "개인정보 보호법" },
  { title: "공공데이터법", query: "공공데이터의 제공 및 이용 활성화에 관한 법률" },
  { title: "건축법", query: "건축법" },
  { title: "근로기준법", query: "근로기준법" },
  { title: "지방자치법", query: "지방자치법" },
  { title: "행정기본법", query: "행정기본법" },
  { title: "전자정부법", query: "전자정부법" },
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
    <div className="krds-home-container">
      {/* 1. Hero Search Section (디지털정부 통합 검색 표준 패턴) */}
      <section className="krds-hero-search-section">
        <div className="krds-hero-inner">
          <div className="krds-service-kicker">
            <span className="kicker-badge">국가법령 공공데이터 연계 포털</span>
            <span>법제처 Open API 수집 자료</span>
          </div>

          <h1 className="krds-hero-heading">
            대한민국 19만+ 공식 법령과 위임 체계를
            <br />
            <strong>한눈에 검색하고 검토하세요</strong>
          </h1>

          <p className="krds-hero-sub">
            법률·대통령령부터 중앙부처 고시, 지자체 조례까지 조·항·호 단위 공식 원문과
            상·하위 인용 관계 및 개정 검토 초안을 지원하는 공공 법제 워크스페이스입니다.
          </p>

          {/* 통합 검색 박스 (KR-DS Search Component) */}
          <div className="krds-search-card">
            <form onSubmit={handleSearch} className="krds-search-form">
              <label htmlFor="main-law-search" className="sr-only">
                법령명 검색
              </label>
              <div className="krds-search-input-group">
                <Search size={22} className="krds-search-icon" aria-hidden="true" />
                <input
                  id="main-law-search"
                  type="text"
                  className="krds-main-input"
                  placeholder="법령명, 조문 내용 또는 키워드를 입력하세요 (예: 개인정보, 건축법, 공공데이터)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="krds-search-filter-group">
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="krds-filter-select"
                  aria-label="법령 자료 유형 선택"
                >
                  <option value="">전체 법령 유형</option>
                  <option value="law">법률 · 대통령령 · 총리령/부령</option>
                  <option value="administrative">행정규칙 (고시·훈령·예규)</option>
                  <option value="ordinance">자치법규 (조례·규칙)</option>
                </select>

                <button type="submit" className="krds-search-submit-btn">
                  <span>통합 검색</span>
                  <ArrowRight size={17} />
                </button>
              </div>
            </form>

            {/* 추천 검색어 */}
            <div className="krds-popular-tags">
              <span className="popular-label">자주 찾는 법령:</span>
              <div className="tag-list">
                {POPULAR_LAWS.map((law) => (
                  <button
                    key={law.title}
                    type="button"
                    className="krds-tag-chip"
                    onClick={() => quickSearch(law.query)}
                  >
                    {law.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Official Data Status Strip (공식 데이터 신뢰성 지표) */}
      <section className="krds-status-strip" aria-labelledby="status-title">
        <div className="krds-status-inner">
          <div className="status-meta-top">
            <div className="status-title-wrap">
              <ShieldCheck size={20} className="status-shield" />
              <h2 id="status-title">보관된 공식 법령 데이터 현황</h2>
              <span className={`status-badge ${status.phase === "connected" ? "connected" : "pending"}`}>
                {connectionLabel(status)}
              </span>
            </div>
            <button
              type="button"
              className="status-refresh-btn"
              onClick={retry}
              disabled={status.phase === "loading"}
              title="데이터베이스 연결 상태 다시 확인"
            >
              <RefreshCw size={13} className={status.phase === "loading" ? "spin" : ""} />
              <span>상태 갱신</span>
            </button>
          </div>

          <div className="status-grid">
            <div className="status-col">
              <span className="stat-label">전체 법령 문서</span>
              <div className="stat-num-row">
                <strong className="stat-number">{displayCount(status)}</strong>
                <span className="stat-unit">건</span>
              </div>
              <p className="stat-desc">법령 · 행정규칙 · 자치법규 통합</p>
            </div>

            <div className="status-col">
              <span className="stat-label">보존된 공식 버전</span>
              <div className="stat-num-row">
                <strong className="stat-number">{displayCount(status, "stored_versions")}</strong>
                <span className="stat-unit">개</span>
              </div>
              <p className="stat-desc">개정 이력별 SHA-256 무결성 검증</p>
            </div>

            <div className="status-col">
              <span className="stat-label">법률 및 대통령령</span>
              <div className="stat-num-row">
                <strong className="stat-number">
                  {status.data?.sources.find((s) => s.source === "law")?.stored_documents?.toLocaleString("ko-KR") || "5,631"}
                </strong>
                <span className="stat-unit">건</span>
              </div>
              <p className="stat-desc">국가법령 전문 및 조·항·호 분석</p>
            </div>

            <div className="status-col">
              <span className="stat-label">행정규칙 및 고시</span>
              <div className="stat-num-row">
                <strong className="stat-number">
                  {status.data?.sources.find((s) => s.source === "administrative")?.stored_documents?.toLocaleString("ko-KR") || "23,719"}
                </strong>
                <span className="stat-unit">건</span>
              </div>
              <p className="stat-desc">중앙부처 훈령 · 예규 · 고시 보존</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Core Public Services (대국민 핵심 서비스 바로가기) */}
      <section className="krds-services-section" aria-labelledby="services-title">
        <div className="section-header">
          <span className="section-pre-title">대국민 법제 서비스</span>
          <h2 id="services-title">주요 기능 및 업무 지원</h2>
          <p>법령 조문 검색부터 위임 근거 대조, 별표 서식 다운로드, 실무 개정 문서 작성까지 지원합니다.</p>
        </div>

        <div className="services-card-grid">
          <div className="service-card">
            <div className="service-icon-box navy">
              <BookOpen size={24} />
            </div>
            <h3>공식 법령 열람 & 조·항·호 탐색</h3>
            <p>
              법률의 전체 텍스트뿐만 아니라 조·항·호·목 단위로 구조화된 문서를 확인하고,
              조문 내 상호참조와 타 법령 명시적 인용을 정밀하게 대조합니다.
            </p>
            <Link to="/laws" className="service-action-link">
              <span>법령 열람실 바로가기</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="service-card">
            <div className="service-icon-box blue">
              <Network size={24} />
            </div>
            <h3>주제별 상·하위 위임 체계</h3>
            <p>
              법률에서 시행령, 부처 고시·세부기준으로 이어지는 3단계 위임 체계와 근거 조문을
              체계도로 시각화하여 상위법 개정에 따른 영향을 검토합니다.
            </p>
            <Link to="/topics" className="service-action-link">
              <span>위임 체계도 살펴보기</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="service-card">
            <div className="service-icon-box amber">
              <FileText size={24} />
            </div>
            <h3>별표 · 서식 라이브러리</h3>
            <p>
              법령·행정규칙에 첨부된 별표 및 신청서 서식 원본(PDF/HWP)과
              디지털 문서로 정제된 Markdown, JSON 변환본을 확인하고 내려받습니다.
            </p>
            <Link to="/attachments" className="service-action-link">
              <span>서식 자료실 바로가기</span>
              <ChevronRight size={16} />
            </Link>
          </div>

          <div className="service-card">
            <div className="service-icon-box teal">
              <FileCheck2 size={24} />
            </div>
            <h3>개정 검토 초안 7종 패키지</h3>
            <p>
              현행 조문과 변경안을 입력하면 신구조문대비표, 개정이유서,
              영향검토서 등 행정 실무 필수 검토 문서를 브라우저에서 즉시 생성합니다.
            </p>
            <Link to="/laws" className="service-action-link">
              <span>법령 선택 후 초안 작성</span>
              <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Public Guidance Banner */}
      <section className="krds-info-banner">
        <div className="info-banner-left">
          <div className="info-icon-wrap">
            <Info size={24} />
          </div>
          <div>
            <h3>AI 도구(Claude, ChatGPT 등)와 MCP로 연결할 수 있습니다</h3>
            <p>
              RuleCraft의 로컬 MCP 서버를 등록하면 "개인정보보호법 제15조의 상위 근거를 찾아줘"와 같이
              평소 질문하듯 자연어로 법령 조문과 신구조문대비표를 조회할 수 있습니다.
            </p>
          </div>
        </div>
        <div className="info-banner-right">
          <Link to="/guide" className="krds-btn-primary">
            <span>MCP 연동 가이드</span>
            <ArrowRight size={15} />
          </Link>
          <Link to="/demo" className="krds-btn-sub">
            <span>합성 예제 체험관</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
