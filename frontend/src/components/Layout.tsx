import { useState, useEffect, type ReactNode } from "react";
import {
  BookOpen,
  Network,
  FileText,
  HelpCircle,
  FlaskConical,
  LockKeyhole,
  Menu,
  X,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { Link, useRouter } from "../router";
import "./layout.css";
import { WorkHistory } from "../WorkHistory";

interface LayoutProps {
  children: ReactNode;
  activeNav?: string;
}

export function Layout({ children, activeNav }: LayoutProps) {
  const { path, navigate } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");
  const [govBannerOpen, setGovBannerOpen] = useState(false);
  const [fontSizeLevel, setFontSizeLevel] = useState<number>(() => {
    const saved = localStorage.getItem("rulecraft_font_zoom");
    return saved ? parseInt(saved, 10) : 0;
  });

  const currentPath = activeNav || path;

  // Font zoom effect
  useEffect(() => {
    const root = document.documentElement;
    if (fontSizeLevel === 1) {
      root.style.fontSize = "14.5px";
    } else if (fontSizeLevel === 2) {
      root.style.fontSize = "16px";
    } else if (fontSizeLevel === -1) {
      root.style.fontSize = "12px";
    } else {
      root.style.fontSize = "13px";
    }
    localStorage.setItem("rulecraft_font_zoom", String(fontSizeLevel));
  }, [fontSizeLevel]);

  const navItems = [
    { to: "/", label: "홈", icon: BookOpen },
    { to: "/laws", label: "공식 법령 열람", icon: Search },
    { to: "/topics", label: "주제별 위임 체계", icon: Network },
    { to: "/attachments", label: "별표 · 서식", icon: FileText },
    { to: "/guide", label: "이용 안내 · MCP", icon: HelpCircle },
  ];

  const subItems = [
    { to: "/demo", label: "합성 예제 체험관", icon: FlaskConical },
    { to: "/app", label: "실무 워크스페이스", icon: LockKeyhole, highlight: true },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!headerSearch.trim()) return;
    navigate(`/laws?q=${encodeURIComponent(headerSearch.trim())}`);
  };

  return (
    <div className="krds-shell">
      {/* 1. Official Government Banner (디지털정부 상단 누리집 확인 배너) */}
      <div className="krds-gov-banner">
        <div className="krds-gov-banner-inner">
          <div className="krds-gov-banner-left">
            <BookOpen size={16} aria-hidden="true" />
            <span className="krds-gov-text">
              RuleCraft · 공공데이터를 활용한 독립 법령 서비스
            </span>
          </div>
          <button
            type="button"
            className="krds-gov-banner-toggle"
            onClick={() => setGovBannerOpen(!govBannerOpen)}
            aria-expanded={govBannerOpen}
          >
            <span>운영 주체와 자료 출처</span>
            {govBannerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {govBannerOpen && (
          <div className="krds-gov-banner-dropdown">
            <div className="krds-gov-banner-dropdown-inner">
              <div className="gov-info-col">
                <strong>독립 서비스 안내</strong>
                <p>
                  RuleCraft는 정부·법제처가 운영하거나 인증한 공식 누리집이 아닙니다. 공식 원문은 국가법령정보센터에서 확인하세요.
                </p>
              </div>
              <div className="gov-info-col">
                <strong>공공데이터 개방 연계</strong>
                <p>
                  법제처 공공데이터로 수집한 원문과 별도 예제·작성 자료를 제공합니다. 수집 시각·버전·출처를 확인하고 예제 관계는 원문과 대조하세요.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Top GNB Accessibility & Utility Bar */}
      <div className="krds-util-bar">
        <div className="krds-util-inner">
          <div className="krds-util-left">
            <span className="util-org-badge">법제처 Open API 연계 포털</span>
            <span className="util-divider" />
            <span className="util-clock">수집된 법령·행정규칙·자치법규 열람</span>
          </div>
          <div className="krds-util-right">
            <WorkHistory />
            {/* 글자 크기 조절 컨트롤 (공공기관 웹 접근성 표준) */}
            <div className="font-size-controls" role="group" aria-label="글자 크기 조절">
              <span className="control-label">글자크기</span>
              <button
                type="button"
                onClick={() => setFontSizeLevel((prev) => Math.max(-1, prev - 1))}
                title="글자 축소"
                className="font-btn"
              >
                <ZoomOut size={13} />
                <span>축소</span>
              </button>
              <button
                type="button"
                onClick={() => setFontSizeLevel(0)}
                title="기본 크기"
                className={`font-btn ${fontSizeLevel === 0 ? "active" : ""}`}
              >
                <RotateCcw size={12} />
                <span>기본</span>
              </button>
              <button
                type="button"
                onClick={() => setFontSizeLevel((prev) => Math.min(2, prev + 1))}
                title="글자 확대"
                className="font-btn"
              >
                <ZoomIn size={13} />
                <span>확대</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Mobile Header */}
      <header className="mobile-header">
        <Link to="/" className="mobile-brand">
          <div className="krds-symbol-sm">
            <BookOpen size={16} />
          </div>
          <span className="brand-title">RuleCraft 법령포털</span>
        </Link>
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* 4. App Shell (Sidebar + Main) */}
      <div className="krds-body-wrap">
        {/* Sidebar */}
        <aside className={`krds-sidebar ${mobileMenuOpen ? "open" : ""}`}>
          <div className="sidebar-brand-wrap">
            <Link to="/" className="brand-logo" onClick={() => setMobileMenuOpen(false)}>
              <div className="brand-symbol">
                <BookOpen size={22} />
              </div>
              <div className="brand-meta">
                <span className="brand-name">RuleCraft</span>
                <span className="brand-slogan">대한민국 법령 · 규정 포털</span>
              </div>
            </Link>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-group-label">공식 법령 열람</div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.to === "/"
                  ? currentPath === "/"
                  : currentPath.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-link ${isActive ? "active" : ""}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon size={17} className="nav-icon" />
                  <span className="nav-text">{item.label}</span>
                  {isActive && <span className="nav-active-bar" />}
                </Link>
              );
            })}

            <div className="nav-group-label nav-separator">체험 및 관리</div>
            {subItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-link ${isActive ? "active" : ""} ${
                    item.highlight ? "workspace-link" : ""
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon size={17} className="nav-icon" />
                  <span className="nav-text">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="data-badge">
              <ShieldCheck size={16} />
              <div className="badge-text">
                <strong>법제처 국가법령 연계</strong>
                <span>수집 버전·원문 출처 확인</span>
              </div>
            </div>
            <a
              href="https://law.go.kr"
              target="_blank"
              rel="noreferrer"
              className="github-link"
            >
              <span>국가법령정보센터 바로가기</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </aside>

        {mobileMenuOpen && (
          <div
            className="mobile-backdrop"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main Content Area */}
        <div className="krds-main-wrap">
          <header className="krds-topbar">
            <div className="topbar-search-form-wrap">
              {currentPath !== "/" && currentPath !== "/laws" && (
                <form onSubmit={handleSearchSubmit} className="topbar-quick-search">
                  <Search size={15} className="search-icon" />
                  <input
                    type="text"
                    placeholder="법령명 빠른 검색 (예: 개인정보, 건축법, 공공데이터)"
                    value={headerSearch}
                    onChange={(e) => setHeaderSearch(e.target.value)}
                  />
                </form>
              )}
            </div>
            <div className="topbar-actions">
              <Link to="/laws" className="topbar-btn">
                <Search size={14} />
                <span>법령 검색</span>
              </Link>
              <Link to="/app" className="topbar-btn primary">
                <LockKeyhole size={14} />
                <span>실무 워크스페이스</span>
              </Link>
            </div>
          </header>

          <main className="krds-page-content">{children}</main>

          {/* 5. Official Public Service Footer (공공기관 표준 푸터 + 공공누리 제1유형 마크) */}
          <footer className="krds-footer">
            <div className="krds-footer-inner">
              <div className="krds-footer-top">
                <div className="footer-policy-links">
                  <a href="#privacy" onClick={(e) => e.preventDefault()}>
                    <strong>개인정보처리방침</strong>
                  </a>
                  <span className="dot">·</span>
                  <a href="#terms" onClick={(e) => e.preventDefault()}>
                    이용약관
                  </a>
                  <span className="dot">·</span>
                  <a href="#accessibility" onClick={(e) => e.preventDefault()}>
                    웹접근성정책
                  </a>
                  <span className="dot">·</span>
                  <Link to="/guide">서비스 이용안내</Link>
                  <span className="dot">·</span>
                  <a
                    href="https://law.go.kr"
                    target="_blank"
                    rel="noreferrer"
                  >
                    국가법령정보센터 ↗
                  </a>
                </div>
              </div>

              <div className="krds-footer-bottom">
                <div className="footer-agency-info">
                  <div className="agency-brand">
                    <span className="agency-title">RuleCraft 대한민국 법령정보 포털</span>
                    <span className="agency-sub">법제처 국가법령정보공동활용 OpenAPI 연동 서비스</span>
                  </div>
                  <p className="agency-address">
                    공식 법령 원문 및 인용 관계 분석 서비스 · 한국 법제 실무 및 자치행정 지원 워크스페이스
                  </p>
                  <p className="agency-copy">
                    본 누리집에 수록된 법령 원문은 법제처 공공데이터 개방 정책에 따라 제공되며, 최신성과 법적 효력은 관보 및 국가법령정보센터를 최종 기준으로 합니다.
                  </p>
                </div>

                {/* 공공누리(KOGL) 제1유형 마크 */}
                <div className="kogl-badge-wrap">
                  <div className="kogl-badge">
                    <div className="kogl-mark">
                      <span className="kogl-text-kr">공공누리</span>
                      <span className="kogl-type">제1유형</span>
                    </div>
                    <div className="kogl-desc">
                      <strong>출처표시 / 상업용 금지 제외</strong>
                      <p>공공저작물 자유이용허락</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
