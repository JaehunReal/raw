import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, ChevronRight,
  FileText, Files, GitBranch, LayoutDashboard, Library, LockKeyhole, Network,
  PlugZap, Search, ShieldCheck, Sparkles, CircleAlert, Clock3,
} from "lucide-react";
import { ServiceOverview, McpGuide } from "./ServiceGuide";
import previewSnapshot from "./preview-snapshot.json";
import OfficialLaws, { checkedAt, connectionLabel, displayCount, useOfficialStatus } from "./OfficialLaws";
import "./public-preview.css";

type PreviewNode = {
  id: string; path: string; agency: string; rule_name: string;
  article_no: string | number; title: string; kind: string;
  body: string; markdown: string;
};
type Edge = { source: string; target: string; type: string };
type Document = { name: string; content: string; format: string };
type SourceRecord = {
  source: string; catalogue_verified?: boolean; full_document_verified?: boolean;
  catalogue_total?: number; catalogue_sample_count?: number;
  sample_title?: string; article_count?: number;
  response_identity_verified?: boolean; response_version_verified?: boolean;
  parse_warnings?: string[];
  error?: { code?: string; status_code?: number; message?: string };
};
type Snapshot = {
  graph: { nodes: PreviewNode[]; edges: Edge[]; issues: unknown[] };
  verification: {
    recorded_at?: string;
    provider?: {
      checked_at?: string; provider_access_verified?: boolean;
      sources?: SourceRecord[];
    };
    internal_api_mcp?: {
      checked_at?: string;
      mcp_tools?: { tool_count?: number; transport?: string; http_status?: number };
      mcp_graph?: { nodes?: number; transport?: string; http_status?: number; is_error?: boolean };
    };
    regression_validation?: { backend_tests_passed?: number };
  };
  package_example: { documents: Document[] };
};
const snapshot: Snapshot = previewSnapshot;
const graph = snapshot.graph;
const evidence = snapshot.verification;
const repository = "https://github.com/JaehunReal/raw";
const lawSources = [
  { id: "law", label: "법령" },
  { id: "administrative", label: "행정규칙" },
  { id: "ordinance", label: "자치법규" },
];
const providerRecords = lawSources.map((source) => ({ ...source,
  recorded: evidence.provider?.sources?.find((item) => item.source === source.id) }));
const catalogueVerified = providerRecords.filter(({ recorded }) => recorded?.catalogue_verified).length;
const fullDocumentVerified = providerRecords.filter(({ recorded }) => recorded?.full_document_verified).length;
const providerSummary = fullDocumentVerified === lawSources.length ? "3종 목록·전문 샘플 확인"
  : fullDocumentVerified > 0 ? "전문 샘플 일부 확인"
  : catalogueVerified > 0 ? "목록 샘플 일부 확인"
  : evidence.provider ? "샘플 연결 미확인" : "API 검증 기록 없음";
type View = "dashboard" | "vault" | "graph" | "impact" | "packages" | "laws" | "mcp";
const navigation = [
  { id: "dashboard", label: "서비스 소개 · 시작하기", icon: LayoutDashboard },
  { id: "vault", label: "규정 예제 저장소", icon: Library },
  { id: "graph", label: "규정 관계 그래프", icon: Network },
  { id: "impact", label: "변경 영향 예제", icon: GitBranch },
  { id: "packages", label: "문서 패키지 예제", icon: Files },
  { id: "laws", label: "공식 법령 현황", icon: BookOpen },
  { id: "mcp", label: "MCP 사용 안내", icon: PlugZap },
] as const;
const tools = [
  { name: "query_markdown_graph", title: "조문 관계 탐색", icon: Network,
    description: "시연 규정의 상위법·위임·인용 관계를 조회하는 도구입니다.",
    parameters: { agency_name: "한국행정연구원", rule_name: "공공데이터제공지침", article_no: 7, traverse_direction: "UPWARD_PARENT" } },
  { name: "analyze_git_delta_impact", title: "변경 영향 분석", icon: GitBranch,
    description: "조문 변경안과 Git 변경의 역참조 대상을 찾는 도구입니다.",
    parameters: { target_file_path: "statutes/개인정보보호법/제15조_수집이용.md", proposed_diff: "시연용 변경안" } },
  { name: "generate_statutory_diff", title: "신구조문대비표", icon: FileText,
    description: "현행·개정안·개정 이유를 비교하는 도구입니다.",
    parameters: { current_markdown: "시연용 현행 조문", revised_markdown: "시연용 개정안", amendment_reason: "인공지능 학습 목적과 안전성 요건 검토" } },
  { name: "parse_form_with_vision", title: "이미지 서식 분석", icon: Files,
    description: "연결된 Vision 모델로 이미지 서식을 읽습니다. 모델 연결은 별도로 필요합니다.",
    parameters: { image_data_base64: "<서식 이미지의 base64>", output_format: "markdown_table" } },
];

function article(node: PreviewNode) {
  if (node.kind === "form") return "별지 서식";
  return String(node.article_no || "안내 문서");
}
function short(value: string, length = 16) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
function recordedAt(value?: string) {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}
function providerFailure(recorded: SourceRecord) {
  if (!recorded.error) return "미확인";
  const status = recorded.error.status_code ? `HTTP ${recorded.error.status_code}` : "응답·연결 오류";
  return recorded.error.code ? `${status} (${recorded.error.code})` : status;
}
function providerStatus(recorded?: SourceRecord) {
  if (!recorded) return "검증 기록 없음";
  if (!recorded.catalogue_verified) return recorded.error ? `목록 미확인 · ${providerFailure(recorded)}` : "목록 미확인";
  return recorded.full_document_verified ? "목록 확인 · 전문 샘플 확인"
    : `목록 확인 · 전문 미확인${recorded.error ? ` · ${providerFailure(recorded)}` : ""}`;
}
function warningLabel(warning: string) {
  const labels: Record<string, string> = {
    unstructured_paragraphs: "항·호 구조 미확인", unparsed_provisions: "조문 구분 미확인",
    unparsed_article_number: "조문 번호 미확인", attachment_files_not_downloaded: "첨부파일 미수집",
    missing_document_identity: "응답 법령 식별자 없음", missing_document_version: "응답 버전 없음",
    requested_version_unverified: "요청 버전 미확인", missing_publication_date: "공포·발령일 없음",
    invalid_publication_date: "공포·발령일 형식 확인 필요", missing_effective_date: "시행일 없음",
    invalid_effective_date: "시행일 형식 확인 필요",
  };
  return labels[warning] || `파싱 확인 필요: ${warning}`;
}
function backlinks(root: string) {
  const visited = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const target = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.target !== target || visited.has(edge.source)) continue;
      visited.set(edge.source, visited.get(target)! + 1);
      queue.push(edge.source);
    }
  }
  return graph.nodes.filter((node) => node.id !== root && visited.has(node.id))
    .map((node) => ({ ...node, depth: visited.get(node.id)! }));
}

function PreviewGraph({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const positions = new Map<string, { x: number; y: number }>();
  const groups = [
    graph.nodes.filter((node) => node.agency === "국가법령"),
    graph.nodes.filter((node) => node.agency !== "국가법령" && node.kind === "article"),
    graph.nodes.filter((node) => node.agency !== "국가법령" && node.kind !== "article"),
  ];
  groups.forEach((nodes, group) => {
    nodes.forEach((node, index) => {
      const columns = group === 1 ? 4 : Math.max(nodes.length, 1);
      const row = Math.floor(index / columns);
      const count = Math.min(columns, nodes.length - row * columns);
      const column = index % columns;
      positions.set(node.id, { x: 460 + (column - (count - 1) / 2) * 213,
        y: group === 0 ? 76 : group === 1 ? 238 + row * 105 : 480 });
    });
  });
  const uniqueEdges = Array.from(new Map(graph.edges.map((edge) => {
    const key = [edge.source, edge.target].sort().join("|");
    return [key, edge];
  })).values());
  const neighbors = new Set<string>([selected]);
  for (const edge of graph.edges) {
    if (edge.source === selected) neighbors.add(edge.target);
    if (edge.target === selected) neighbors.add(edge.source);
  }
  function selectWithKey(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); }
  }
  return <div className="preview-graph-scroll" data-testid="preview-graph">
    <svg viewBox="0 0 920 555" role="group" aria-label={`합성 예제 규정 ${graph.nodes.length}개 관계도. 조문을 선택하면 연결을 강조합니다.`}>
      <defs><pattern id="preview-dots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.8" fill="#bccab7" opacity="0.55" />
      </pattern></defs>
      <rect width="920" height="555" fill="url(#preview-dots)" />
      {uniqueEdges.map((edge) => {
        const from = positions.get(edge.source), to = positions.get(edge.target);
        if (!from || !to) return null;
        const highlighted = edge.source === selected || edge.target === selected;
        return <path key={`${edge.source}-${edge.target}`} d={`M${from.x},${from.y} C${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2} ${to.x},${to.y}`}
          fill="none" stroke={highlighted ? "#628569" : "#ced8c7"} strokeWidth={highlighted ? 2 : 1.2}
          opacity={highlighted ? 0.9 : 0.45} />;
      })}
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)!;
        const active = node.id === selected;
        const law = node.agency === "국가법령";
        return <g key={node.id} transform={`translate(${position.x},${position.y})`}
          role="button" tabIndex={0} aria-label={`${node.rule_name} ${article(node)} ${node.title}, 합성 예제`}
          aria-pressed={active} onClick={() => onSelect(node.id)} onKeyDown={(event) => selectWithKey(event, node.id)}
          className="preview-graph-node" opacity={neighbors.has(node.id) ? 1 : 0.67}>
          <rect x="-96" y="-33" width="192" height="66" rx="11"
            fill={active ? "#214f40" : law ? "#f8f4e9" : "#fff"}
            stroke={active ? "#214f40" : law ? "#ded6bd" : "#d3dfcf"} />
          <text textAnchor="middle" y="-8" fontSize="13" fontWeight="600" fill={active ? "#fff" : "#3d5441"}>{short(node.rule_name, 13)}</text>
          <text textAnchor="middle" y="13" fontSize="12" fill={active ? "#e1ecdf" : "#536959"}>{article(node)} · {short(node.title, 13)}</text>
          <title>{node.rule_name} {article(node)} · {node.title}</title>
        </g>;
      })}
    </svg>
  </div>;
}

export default function PublicPreview() {
  const official = useOfficialStatus();
  const defaultNode = graph.nodes.find((node) => node.id === "KIPA-RULE-DAT-007") || graph.nodes[0];
  const [view, setView] = useState<View>("dashboard");
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [view]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(defaultNode.id);
  const [sourceView, setSourceView] = useState(false);
  const [graphSelected, setGraphSelected] = useState(defaultNode.id);
  const [impactId, setImpactId] = useState("LAW-PRIV-015");
  const [documentIndex, setDocumentIndex] = useState(0);
  const [toolIndex, setToolIndex] = useState(0);
  const selected = graph.nodes.find((node) => node.id === selectedId) || defaultNode;
  const graphNode = graph.nodes.find((node) => node.id === graphSelected) || defaultNode;
  const filtered = useMemo(() => graph.nodes.filter((node) =>
    `${node.title} ${node.rule_name} ${node.agency} ${article(node)} ${node.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [search]);
  const impacted = useMemo(() => backlinks(impactId), [impactId]);
  const selectedDocument = snapshot.package_example.documents[documentIndex];
  const chosenTool = tools[toolIndex];
  const mcp = evidence.internal_api_mcp;
  const connectedEdges = graph.edges.filter((edge) => edge.source === graphSelected || edge.target === graphSelected);
  function openNode(id: string) { setSelectedId(id); setSearch(""); setSourceView(false); setView("vault"); }

  return <div className="app-shell public-preview" data-testid="public-preview">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView("dashboard"); }}>
        <span className="brand-mark"><BookOpen size={23} /></span><span>RuleCraft<span className="brand-dot">.</span></span>
      </a>
      <span className="brand-sub">규정의 연결, 행정의 다음.</span>
      <div className="organization"><span className="org-avatar">규</span><span><strong>공개 워크스페이스</strong><small>공식 원문 · 규정 예제</small></span><LockKeyhole size={14} /></div>
      <div className="nav-label">프로젝트 둘러보기</div>
      <nav aria-label="공개 워크스페이스 메뉴">{navigation.map((item) => <button key={item.id}
        className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}
        aria-current={view === item.id ? "page" : undefined}><item.icon size={19} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom preview-sidebar-bottom">
        <div className="preview-local-note"><ShieldCheck size={20} /><div><strong>예제를 직접 살펴보세요.</strong><p>검색과 관계 탐색은<br />브라우저에서 동작합니다.</p></div></div>
        <a className="preview-repository" href={repository} target="_blank" rel="noreferrer">GitHub에서 프로젝트 보기 <ArrowUpRight size={14} /></a>
      </div>
    </aside>
    <div className="main-wrap">
      <header className="topbar"><div className="breadcrumb"><span>공개 워크스페이스</span><ChevronRight size={13} /><strong>{navigation.find((item) => item.id === view)?.label}</strong></div>
        <span className="preview-mode"><EyeLabel /> 읽기 전용</span></header>
      <main>
        <div className="preview-notice" data-testid="preview-notice"><LockKeyhole size={18} /><div><strong>공개 읽기 전용 워크스페이스</strong><p>공식 법령은 연결된 저장소에서 조회합니다. 규정 관계와 검토 문서는 합성 예제이며, 편집·저장과 MCP 실행은 제공하지 않습니다.</p></div></div>
        {view === "dashboard" && <>
          <ServiceOverview onNavigate={setView} />
          <div className="guide-section-heading service-guide"><span className="guide-kicker">자료와 기능의 현재 상태</span><h2>공식 자료와 예제를 구분해 확인하세요.</h2><p className="guide-caption">공식 원문 연결 상태와 공개 화면에서 사용할 수 있는 기능입니다.</p></div>
          <section className="preview-status-overview" aria-label="실제 데이터와 공개 화면 상태">
            <button className={`preview-status-card ${fullDocumentVerified === lawSources.length ? "verified" : "pending"}`} onClick={() => setView("laws")}><span className="preview-status-heading"><CheckCircle2 size={19} />공식 API 검증 기록<ArrowUpRight size={16} /></span><strong>{fullDocumentVerified} / {lawSources.length}<small>종 전문 샘플 확인</small></strong><p>법령·행정규칙·자치법규를 소량 조회한 결과입니다. 유형별 확인 범위를 살펴보세요.</p><span className="preview-status-caption"><Clock3 size={12} />기록된 결과 · 실시간 조회 아님</span></button>
            <button className={`preview-status-card ${official.status.phase === "connected" ? "verified" : "pending"}`} onClick={() => setView("laws")}><span className="preview-status-heading"><BookOpen size={19} />보관된 공식 원문<ArrowUpRight size={16} /></span><strong>{displayCount(official.status)}<small>{official.status.phase === "connected" ? "건 저장" : "저장 건수"}</small></strong><p>{connectionLabel(official.status)}. 저장소에서 확인한 원문과 버전을 살펴보세요.</p><span className="preview-status-caption">{official.status.phase === "connected" ? `조회 시각: ${checkedAt(official.status.data?.checked_at)}` : "연결 확인 전에는 저장 건수를 표시하지 않습니다."}</span></button>
            <div className="preview-status-card preview"><span className="preview-status-heading"><LockKeyhole size={19} />지금 보고 있는 화면</span><strong className="preview-status-text">읽기 전용 조회</strong><p>공식 원문과 합성 예제를 구분해 살펴보세요. 관계 탐색과 검토 문서는 예제로 체험할 수 있습니다.</p><span className="preview-status-caption">공식 원문 · 합성 규정 예제</span></div>
          </section>
          <div className="stats-grid preview-stats">{[
            { label: "읽어볼 예제 규정", value: graph.nodes.length, unit: "개 문서", detail: "합성 조문·서식 검색", icon: Library, style: "sage", target: "vault", test: "preview-node-count" },
            { label: "탐색할 규정 연결", value: graph.edges.length, unit: "개 관계", detail: "인용·위임 관계 살펴보기", icon: Network, style: "blue", target: "graph", test: "preview-edge-count" },
            { label: "공식 원문 저장", value: displayCount(official.status), unit: official.status.phase === "connected" ? "건" : "", detail: connectionLabel(official.status), icon: BookOpen, style: "sand", target: "laws", test: "preview-official-count" },
            { label: "MCP 도구 검증 기록", value: mcp?.mcp_tools?.tool_count || 4, unit: "개 도구", detail: "도구별 기능과 확인 범위", icon: PlugZap, style: "lavender", target: "mcp", test: "preview-tool-count" },
          ].map((stat) => <button key={stat.label} className="stat-card" onClick={() => setView(stat.target as View)}><div className="stat-top"><span>{stat.label}</span><span className={`stat-icon ${stat.style}`}><stat.icon size={18} /></span></div><div className="stat-value"><span className="preview-stat-number" data-testid={stat.test}>{stat.value}</span><span>{stat.unit}</span></div><div className="stat-foot"><span className="stat-foot-dot" />{stat.detail}</div></button>)}</div>
          <div className="preview-columns"><section className="panel"><div className="panel-heading"><div><h3>예제 규정 둘러보기 <span className="count-tag">{graph.nodes.length}</span></h3><p>원문 형식과 조문 간 관계를 직접 확인하세요.</p></div><button className="text-button" onClick={() => setView("vault")}>전체 보기 <ChevronRight size={14} /></button></div><div className="preview-recent-list">{[defaultNode, ...graph.nodes.filter((node) => node.id !== defaultNode.id)].slice(0, 4).map((node) => <button key={node.id} onClick={() => openNode(node.id)}><span className="preview-doc-icon"><FileText size={18} /></span><span><strong>{node.title}</strong><small>{node.rule_name} · {article(node)}</small></span><span className="pill neutral">합성 예제</span><ChevronRight size={15} /></button>)}</div></section>
            <section className="panel preview-progress"><div className="panel-heading"><div><h3>사용 가능한 기능과 확인할 부분</h3><p>체험 기능과 실제 운영 기능을 구별합니다.</p></div></div><ul><li><CheckCircle2 size={19} /><div><strong>검색·관계 탐색·역참조 확인</strong><span>이 화면에서 예제를 선택하며 직접 사용할 수 있습니다.</span></div></li><li><CheckCircle2 size={19} /><div><strong>검토 문서 7종 읽기</strong><span>미리 만든 초안입니다. 새 문서를 생성하지 않습니다.</span></div></li><li className="preview-progress-limited"><CircleAlert size={19} /><div><strong>AI 작성·이미지 문자 인식은 미연동</strong><span>현재 문서 작성은 템플릿 방식이며, 이미지 분석 모델은 연결되지 않았습니다.</span></div></li></ul><a className="text-button" href={`${repository}/blob/main/docs/api-connection-review.md`} target="_blank" rel="noreferrer">실제 연동 검토 결과 <ArrowUpRight size={14} /></a></section></div>
        </>}
        {view === "vault" && <>
          <Heading eyebrow="규정 예제 저장소" title="조문을 읽고, 연결을 이해하세요." description="저장소에 포함된 12개 합성 예제입니다. 실제 법령 원문이나 기관의 현행 규정이 아닙니다." />
          <div className="preview-vault-layout"><section className="panel preview-vault-list"><label className="preview-search"><Search size={17} /><input aria-label="예제 규정 검색" data-testid="preview-vault-search" placeholder="규정명, 조문, 기관 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="preview-list-count">합성 예제 {filtered.length}개</div><div className="preview-node-list">{filtered.map((node) => <button key={node.id} data-testid={`preview-vault-row-${node.id}`} className={node.id === selectedId ? "selected" : ""} aria-pressed={node.id === selectedId} onClick={() => { setSelectedId(node.id); setSourceView(false); }}><FileText size={18} /><span><strong>{node.title}</strong><small>{node.rule_name} · {article(node)}</small><em>{node.agency}</em></span><ChevronRight size={14} /></button>)}{!filtered.length && <p className="preview-empty">일치하는 예제 문서가 없습니다.</p>}</div></section>
            <section className="panel preview-reader" data-testid="preview-reader"><div className="preview-reader-header"><span className="pill warning">합성 예제 · 읽기 전용</span><h2>{selected.title}</h2><p>{selected.rule_name} · {article(selected)}</p><div className="preview-reader-actions"><button className={!sourceView ? "selected" : ""} onClick={() => setSourceView(false)}>조문 내용</button><button className={sourceView ? "selected" : ""} onClick={() => setSourceView(true)}>Markdown 원본</button><button onClick={() => { setGraphSelected(selected.id); setView("graph"); }}><Network size={14} />관계 보기</button></div></div><pre>{sourceView ? selected.markdown : selected.body}</pre><div className="preview-reader-path"><FileText size={13} /><span>{selected.path}</span></div></section></div>
        </>}
        {view === "graph" && <>
          <Heading eyebrow="규정 관계 탐색" title="하나의 조문에서, 연결된 규정까지." description="합성 예제의 관계를 탐색합니다. 조문을 선택하면 해당 조문의 연결이 강조됩니다." />
          <div className="preview-graph-layout"><section className="panel preview-graph-panel"><div className="panel-heading"><div><h3>규정 관계 그래프</h3><p>{graph.nodes.length}개 예제 문서 · {graph.edges.length}개 관계</p></div><span className="pill neutral">브라우저 내 탐색</span></div><PreviewGraph selected={graphSelected} onSelect={setGraphSelected} /><div className="preview-graph-legend"><span><i className="law" />상위법 예제</span><span><i />기관 규정·서식 예제</span><span>여러 관계를 가진 같은 문서 쌍은 하나의 선으로 표시합니다.</span></div><details className="preview-all-relations"><summary>전체 {graph.edges.length}개 관계 보기</summary><ul>{graph.edges.map((edge, index) => <li key={`${edge.source}-${edge.target}-${edge.type}-${index}`} data-testid="preview-edge"><span>{graph.nodes.find((node) => node.id === edge.source)?.title}</span><small>{edge.type}</small><span>{graph.nodes.find((node) => node.id === edge.target)?.title}</span></li>)}</ul></details></section>
            <section className="panel preview-graph-detail"><span className="pill warning">선택한 합성 예제</span><h2>{graphNode.title}</h2><p>{graphNode.rule_name} · {article(graphNode)}</p><button className="button secondary" onClick={() => openNode(graphNode.id)}><FileText size={15} />예제 조문 보기</button><h3>연결된 관계 <span>{connectedEdges.length}</span></h3><div className="preview-connections">{connectedEdges.map((edge, index) => { const other = graph.nodes.find((node) => node.id === (edge.source === graphSelected ? edge.target : edge.source)); return other ? <button key={`${edge.type}-${index}`} onClick={() => setGraphSelected(other.id)}><small>{edge.type}</small><strong>{other.title}</strong><span>{other.rule_name} · {article(other)}</span></button> : null; })}{!connectedEdges.length && <p className="preview-empty">이 예제에 연결된 관계가 없습니다.</p>}</div></section></div>
        </>}
        {view === "impact" && <>
          <Heading eyebrow="변경 영향 예제" title="변경 시 함께 살펴볼 문서를 찾으세요." description="합성 예제 그래프에서 선택한 문서를 인용하는 대상을 역방향으로 탐색합니다." />
          <section className="panel preview-impact"><label htmlFor="preview-impact-target">살펴볼 예제 문서</label><select id="preview-impact-target" data-testid="preview-impact-target" value={impactId} onChange={(event) => setImpactId(event.target.value)}>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.rule_name} {article(node)} · {node.title}</option>)}</select><div className="preview-inline-note"><GitBranch size={18} /><p>예제 관계의 역참조 탐색입니다. 개정안 분석, Git 비교, 실제 법적 영향 판정은 이 공개 화면에서 실행하지 않습니다.</p></div><h3>연결을 따라 확인할 문서 <span>{impacted.length}개</span></h3><div className="preview-impact-results" data-testid="preview-impact-results">{impacted.map((node) => <button key={node.id} onClick={() => openNode(node.id)}><span className="preview-depth">{node.depth}단계</span><span><strong>{node.title}</strong><small>{node.rule_name} · {article(node)}</small></span><ChevronRight size={16} /></button>)}{!impacted.length && <p className="preview-empty">이 예제 그래프에는 역참조 대상이 없습니다.</p>}</div></section>
        </>}
        {view === "packages" && <>
          <Heading eyebrow="검토 문서 예제" title="개정 검토에 필요한 문서를 한곳에." description="합성 조문으로 미리 만든 7개 문서 예제입니다. 새 문서를 생성하거나 저장하지 않습니다." />
          <div className="preview-inline-note"><ShieldCheck size={18} /><p>아래 문서는 합성 예제 조문 1개의 검토용 초안입니다. 공식 원문 저장소와 연결해 생성한 결과가 아니며, 법적 검토·승인·공포를 마친 결과가 아닙니다.</p></div>
          <div className="preview-package-layout"><section className="panel preview-package-list"><div className="panel-heading"><div><h3>데이터 반출 조문 검토 예제</h3><p>공공데이터제공지침 · 제7조</p></div></div>{snapshot.package_example.documents.map((document, index) => <button key={document.name} data-testid={`preview-package-doc-${index}`} className={documentIndex === index ? "selected" : ""} onClick={() => setDocumentIndex(index)} aria-pressed={documentIndex === index}><span className="preview-document-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{document.name.replace(/^\d+_/, "").replace(/\.md$/, "")}</strong><small>Markdown · 검토용 합성 예제</small></span><ChevronRight size={15} /></button>)}</section><section className="panel preview-package-reader" data-testid="preview-package-reader"><div className="preview-reader-header"><span className="pill warning">합성 예제 · 검토용 초안</span><h2>{selectedDocument?.name.replace(/^\d+_/, "").replace(/\.md$/, "")}</h2><p>미리 만든 문서를 읽기 전용으로 보여줍니다.</p></div><pre>{selectedDocument?.content}</pre></section></div>
        </>}
        {view === "laws" && <>
          <Heading eyebrow="공식 법령 저장소" title="보관된 법령과 버전을 확인하세요." description="법령·행정규칙·자치법규의 저장 원문을 검색하고, 버전·출처·해시를 함께 확인합니다." />
          <OfficialLaws status={official.status} retry={official.retry} />
          <section className="panel preview-law-status" data-testid="preview-law-status">
            <div className="preview-law-summary"><span className="preview-law-icon"><BookOpen size={26} /></span><div>
              <span className="pill warning" data-testid="preview-provider-summary">{providerSummary}</span>
              <h2>공식 API의 과거 연결 검증 기록</h2>
              <p>자료 유형 {lawSources.length}종 중 목록 {catalogueVerified}종, 전문 샘플 {fullDocumentVerified}종의 응답을 확인한 기록입니다. 이 검증 당시 샘플은 저장하지 않았습니다. 현재 저장소의 건수와 수집 범위는 위 조회 결과에서 확인하세요.</p>
            </div></div>
            <div className="preview-law-sources">{providerRecords.map(({ id, label, recorded }) =>
              <div key={id} data-testid={`preview-law-source-${id}`} style={{ overflowWrap: "anywhere" }}>
                <BookOpen size={18} /><strong>{label}</strong><span>과거 표본 검증</span>
                <em data-testid={`preview-law-result-${id}`}>{providerStatus(recorded)}</em>
                <small data-testid={`preview-law-catalogue-${id}`}>{recorded?.catalogue_verified
                  ? `목록 총 ${recorded.catalogue_total?.toLocaleString("ko-KR") ?? "미확인"}건 · 샘플 ${recorded.catalogue_sample_count ?? 0}건`
                  : "당시 목록 미확인"}</small>
                {recorded?.full_document_verified && <>
                  <small data-testid={`preview-law-sample-${id}`}>전문 샘플: {recorded.sample_title || "제목 미기록"} · 조문 {recorded.article_count?.toLocaleString("ko-KR") ?? "미확인"}개</small>
                  <small data-testid={`preview-law-identity-${id}`}>응답 식별자 {recorded.response_identity_verified ? "확인" : "미확인"} · 요청 버전 {recorded.response_version_verified ? "확인" : "미확인"}</small>
                  {recorded.parse_warnings?.map((warning) => <small key={warning} data-warning-code={warning}>{warningLabel(warning)}</small>)}
                </>}
              </div>
            )}</div>
            <p className="preview-record-time">검토 시각: {recordedAt(evidence.provider?.checked_at)} (한국 시간) · 실시간 상태 아님</p>
          </section>
          <a className="text-button preview-evidence-link" href={`${repository}/blob/main/docs/api-connection-review.md`} target="_blank" rel="noreferrer">API 검토 기록 <ArrowUpRight size={15} /></a>
        </>}
        {view === "mcp" && <>
          <Heading eyebrow="MCP 사용 안내" title="AI 도구에서 RuleCraft 사용하기" description="처음 연결하는 방법과 업무별 요청 예제를 살펴보세요." />
          <McpGuide />
          <details className="guide-admin"><summary>도구별 기술 설명과 과거 검증 기록 보기</summary><div>
          <Heading eyebrow="MCP 도구 검증 기록" title="구현된 도구와 연동 검증을 확인하세요." description="내부 테스트 환경에서 수행한 실제 stdio MCP 검증 기록입니다. 현재 공개 화면의 실시간 연결 상태가 아닙니다." />
          <section className="preview-mcp-record" data-testid="preview-mcp-record"><PlugZap size={24} /><div><strong>2026-10-01 실제 MCP 내부 검증 완료</strong><p>도구 {mcp?.mcp_tools?.tool_count || 4}개 확인 · 조문 관계 조회 {mcp?.mcp_graph?.nodes || 3}개 노드 · stdio 전송</p><small>{recordedAt(mcp?.checked_at)} (한국 시간) · 임시 인증 API와 실제 자식 프로세스 사용</small></div><span className="pill sage">과거 검증 기록</span></section>
          <div className="preview-mcp-layout"><div className="preview-tool-cards">{tools.map((tool, index) => <button key={tool.name} className={`panel ${index === toolIndex ? "selected" : ""}`} onClick={() => setToolIndex(index)} aria-pressed={index === toolIndex}><span className="preview-tool-icon"><tool.icon size={21} /></span><strong>{tool.title}</strong><small>{tool.name}</small><p>{tool.description}</p><span className={`pill ${index === 3 ? "warning" : "neutral"}`}>{index === 3 ? "이미지 모델 미연결" : "도구 구현 · 공개 실행 없음"}</span></button>)}</div><section className="panel preview-tool-reader"><div className="preview-reader-header"><span className="pill neutral">요청 형식 예제 · 읽기 전용</span><h2>{chosenTool.title}</h2><p>아래 JSON은 형식 예제이며 요청을 전송하지 않습니다.</p></div><pre>{JSON.stringify(chosenTool.parameters, null, 2)}</pre>{toolIndex === 0 ? <div className="preview-record-result"><h3>기록된 관계 조회 결과</h3><dl><div><dt>HTTP 상태</dt><dd>{mcp?.mcp_graph?.http_status || 200}</dd></div><div><dt>반환 노드</dt><dd>{mcp?.mcp_graph?.nodes || 3}개 합성 조문</dd></div><div><dt>검증 대상</dt><dd>데이터 반출 조문과 상위법 예제</dd></div></dl><p>이 결과는 공식 법령 API 연결 성공이나 법적 적용성 확인을 뜻하지 않습니다.</p></div> : <div className="preview-record-result"><h3>{toolIndex === 3 ? "이미지 분석 모델 미연결" : "현재 시연 범위"}</h3><p>{toolIndex === 3 ? "기본 구성에서는 이미지를 분석하지 않고 모델 미연결 상태를 반환합니다. 이 화면에서는 입력 형식만 확인할 수 있습니다." : "공개 화면에서는 도구 설명과 입력 형식만 제공합니다."}</p></div>}</section></div>
          <div className="preview-mcp-links"><a className="text-button preview-evidence-link" href={`${repository}/blob/main/docs/mcp.md`} target="_blank" rel="noreferrer">내 MCP 클라이언트에서 사용하기 <ArrowUpRight size={14} /></a><a className="text-button preview-evidence-link" href={`${repository}/blob/main/docs/api-connection-evidence.json`} target="_blank" rel="noreferrer">전체 공개 검증 기록 보기 <ArrowUpRight size={14} /></a></div>
          </div></details>
        </>}
        <footer className="preview-footer"><span>RuleCraft · 공식 원문 조회와 합성 규정 예제</span><a href={`${repository}/blob/main/docs/api-connection-evidence.json`} target="_blank" rel="noreferrer">검증 기록 <ArrowUpRight size={12} /></a></footer>
      </main>
    </div>
  </div>;
}

function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="small-line" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div></div>;
}
function EyeLabel() { return <LockKeyhole size={12} />; }
