import { useState, type ReactNode } from "react";
import {
  BookOpen,
  FolderOpen,
  Network,
  FileText,
  HelpCircle,
  FlaskConical,
  LockKeyhole,
  Menu,
  X,
  Search,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { Link, useRouter } from "../router";
import "./layout.css";

interface LayoutProps {
  children: ReactNode;
  activeNav?: string;
}

export function Layout({ children, activeNav }: LayoutProps) {
  const { path, navigate } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");

  const currentPath = activeNav || path;

  const navItems = [
    { to: "/", label: "홈", icon: BookOpen },
    { to: "/laws", label: "공식 법령 열람", icon: Search },
    { to: "/topics", label: "주제별 위임 체계", icon: Network },
    { to: "/attachments", label: "별표 · 서식", icon: FileText },
    { to: "/guide", label: "이용 안내 · MCP", icon: HelpCircle },
  ];

  const subItems = [
    { to: "/demo", label: "합성 예제 체험관", icon: FlaskConical },
    { to: "/app", label: "워크스페이스 (로그인)", icon: LockKeyhole, highlight: true },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!headerSearch.trim()) return;
    navigate(`/laws?q=${encodeURIComponent(headerSearch.trim())}`);
  };

  return (
    <div className="modern-shell">
      {/* Mobile Top Bar */}
      <header className="mobile-header">
        <Link to="/" className="mobile-brand">
          <span className="brand-badge">
            <BookOpen size={18} />
          </span>
          <span className="brand-title">RuleCraft</span>
        </Link>
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Sidebar */}
      <aside className={`modern-sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <div className="sidebar-brand-wrap">
          <Link to="/" className="brand-logo" onClick={() => setMobileMenuOpen(false)}>
            <div className="brand-icon">
              <BookOpen size={20} />
            </div>
            <div className="brand-meta">
              <span className="brand-name">
                RuleCraft<span className="brand-accent">.</span>
              </span>
              <span className="brand-slogan">대한민국 법령 · 규정 포털</span>
            </div>
          </Link>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">공식 법령 조회</div>
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
                <Icon size={18} className="nav-icon" />
                <span className="nav-text">{item.label}</span>
                {isActive && <span className="nav-active-pill" />}
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
                <Icon size={18} className="nav-icon" />
                <span className="nav-text">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="data-badge">
            <ShieldCheck size={16} />
            <div className="badge-text">
              <strong>법제처 공식 API 연동</strong>
              <span>19만+ 법령 · 행정규칙 · 자치법규</span>
            </div>
          </div>
          <a
            href="https://github.com/JaehunReal/raw"
            target="_blank"
            rel="noreferrer"
            className="github-link"
          >
            <span>GitHub 프로젝트</span>
            <ExternalLink size={13} />
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
      <div className="modern-main-wrap">
        <header className="modern-topbar">
          <div className="topbar-search-form-wrap">
            {currentPath !== "/" && currentPath !== "/laws" && (
              <form onSubmit={handleSearchSubmit} className="topbar-quick-search">
                <Search size={16} className="search-icon" />
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
              <Search size={15} />
              <span>법령 검색</span>
            </Link>
            <Link to="/app" className="topbar-btn primary">
              <LockKeyhole size={15} />
              <span>워크스페이스</span>
            </Link>
          </div>
        </header>

        <main className="modern-page-content">{children}</main>

        <footer className="modern-footer">
          <div className="footer-content">
            <div className="footer-left">
              <strong>RuleCraft 대한민국 법령 포털</strong>
              <p>법제처 국가법령정보 공동활용 API 기반 공식 원문 및 관계 탐색 서비스</p>
            </div>
            <div className="footer-links">
              <Link to="/guide">이용 안내</Link>
              <Link to="/demo">합성 예제</Link>
              <a
                href="https://law.go.kr"
                target="_blank"
                rel="noreferrer"
              >
                국가법령정보센터 ↗
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
