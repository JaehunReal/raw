import { useState, useMemo, type KeyboardEvent } from "react";
import {
  FlaskConical,
  Library,
  Network,
  GitBranch,
  Files,
  Search,
  FileText,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "../router";
import previewSnapshot from "../preview-snapshot.json";
import "../public-preview.css";

type PreviewNode = {
  id: string;
  path: string;
  agency: string;
  rule_name: string;
  article_no: string | number;
  title: string;
  kind: string;
  body: string;
  markdown: string;
};
type Edge = { source: string; target: string; type: string };
type Document = { name: string; content: string; format: string };

type Snapshot = {
  graph: { nodes: PreviewNode[]; edges: Edge[]; issues: unknown[] };
  package_example: { documents: Document[] };
};

const snapshot = previewSnapshot as unknown as Snapshot;
const graph = snapshot.graph;

function article(node: PreviewNode) {
  if (node.kind === "form") return "별지 서식";
  return String(node.article_no || "안내 문서");
}
function short(value: string, length = 16) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
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
  return graph.nodes
    .filter((node) => node.id !== root && visited.has(node.id))
    .map((node) => ({ ...node, depth: visited.get(node.id)! }));
}

function PreviewGraph({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
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
      positions.set(node.id, {
        x: 460 + (column - (count - 1) / 2) * 213,
        y: group === 0 ? 76 : group === 1 ? 238 + row * 105 : 480,
      });
    });
  });
  const uniqueEdges = Array.from(
    new Map(
      graph.edges.map((edge) => {
        const key = [edge.source, edge.target].sort().join("|");
        return [key, edge];
      })
    ).values()
  );
  const neighbors = new Set<string>([selected]);
  for (const edge of graph.edges) {
    if (edge.source === selected) neighbors.add(edge.target);
    if (edge.target === selected) neighbors.add(edge.source);
  }
  function selectWithKey(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }
  return (
    <div className="preview-graph-scroll">
      <svg
        viewBox="0 0 920 555"
        role="group"
        aria-label={`합성 예제 규정 ${graph.nodes.length}개 관계도.`}
      >
        <defs>
          <pattern
            id="preview-dots-demo"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" fill="#bccab7" opacity="0.55" />
          </pattern>
        </defs>
        <rect width="920" height="555" fill="url(#preview-dots-demo)" />
        {/* Tier Swimlanes (계층별 체계화 영역 배경) */}
        <g className="demo-graph-swimlanes">
          {/* 1단계: 상위법령 */}
          <rect
            x="12"
            y="12"
            width="896"
            height="128"
            rx="8"
            fill="#f0f7ff"
            stroke="#bae6fd"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          <g transform="translate(24, 32)">
            <rect x="0" y="-12" width="220" height="20" rx="4" fill="#e0f2fe" stroke="#7dd3fc" />
            <text x="8" y="2" fontSize="11" fontWeight="700" fill="#0369a1">
              🏛️ 제1계층: 상위법령 (법률) {groups[0].length}건
            </text>
          </g>

          {/* 2단계: 소관 규정 */}
          <rect
            x="12"
            y="152"
            width="896"
            height="235"
            rx="8"
            fill="#f0fdf4"
            stroke="#bbf7d0"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          <g transform="translate(24, 172)">
            <rect x="0" y="-12" width="220" height="20" rx="4" fill="#dcfce7" stroke="#86efac" />
            <text x="8" y="2" fontSize="11" fontWeight="700" fill="#15803d">
              📜 제2계층: 기관 소관 규정 {groups[1].length}건
            </text>
          </g>

          {/* 3단계: 별지 서식 */}
          <rect
            x="12"
            y="400"
            width="896"
            height="142"
            rx="8"
            fill="#fffbeb"
            stroke="#fde68a"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          <g transform="translate(24, 420)">
            <rect x="0" y="-12" width="230" height="20" rx="4" fill="#fef3c7" stroke="#fcd34d" />
            <text x="8" y="2" fontSize="11" fontWeight="700" fill="#b45309">
              📋 제3계층: 별지 서식 및 부속서류 {groups[2].length}건
            </text>
          </g>
        </g>

        {uniqueEdges.map((edge) => {
          const from = positions.get(edge.source);
          const to = positions.get(edge.target);
          if (!from || !to) return null;
          const highlighted =
            edge.source === selected || edge.target === selected;
          return (
            <path
              key={`${edge.source}-${edge.target}`}
              d={`M${from.x},${from.y} C${from.x},${(from.y + to.y) / 2} ${to.x},${
                (from.y + to.y) / 2
              } ${to.x},${to.y}`}
              fill="none"
              stroke={highlighted ? "#0b3b60" : "#94a3b8"}
              strokeWidth={highlighted ? 2.2 : 1.2}
              opacity={highlighted ? 1 : 0.6}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const position = positions.get(node.id)!;
          const active = node.id === selected;
          const law = node.agency === "국가법령";
          const isForm = node.kind !== "article";
          const themeColor = law ? "#0284c7" : isForm ? "#d97706" : "#16a34a";
          return (
            <g
              key={node.id}
              transform={`translate(${position.x},${position.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${node.rule_name} ${article(node)} ${node.title}`}
              aria-pressed={active}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => selectWithKey(event, node.id)}
              className="preview-graph-node"
              opacity={neighbors.has(node.id) ? 1 : 0.67}
            >
              <rect
                x="-96"
                y="-33"
                width="192"
                height="66"
                rx="11"
                fill={active ? "#0b3b60" : "#ffffff"}
                stroke={active ? "#3b82f6" : themeColor}
                strokeWidth={active ? "2.5" : "1.4"}
              />
              <path
                d="M-85,-33 h170 a11,11 0 0 1 11,11 v0 h-192 v0 a11,11 0 0 1 11,-11 z"
                fill={active ? "#60a5fa" : themeColor}
              />
              <text
                textAnchor="middle"
                y="-7"
                fontSize="12.5"
                fontWeight="700"
                fill={active ? "#fff" : themeColor}
              >
                {short(node.rule_name, 13)}
              </text>
              <text
                textAnchor="middle"
                y="14"
                fontSize="11.5"
                fill={active ? "#e2e8f0" : "#475569"}
                fontWeight="500"
              >
                {article(node)} · {short(node.title, 13)}
              </text>
              <title>
                {node.rule_name} {article(node)} · {node.title}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function DemoPage() {
  const { searchParams } = useRouter();
  const initialTab = (searchParams.get("tab") as "vault" | "graph" | "impact" | "packages") || "vault";
  const [tab, setTab] = useState<"vault" | "graph" | "impact" | "packages">(initialTab);
  const defaultNode =
    graph.nodes.find((node) => node.id === "KIPA-RULE-DAT-007") ||
    graph.nodes[0];

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(defaultNode.id);
  const [sourceView, setSourceView] = useState(false);
  const [graphSelected, setGraphSelected] = useState(defaultNode.id);
  const [impactId, setImpactId] = useState("LAW-PRIV-015");
  const initialDocIndex = parseInt(searchParams.get("doc") || "0", 10) || 0;
  const [documentIndex, setDocumentIndex] = useState(initialDocIndex);

  const selected =
    graph.nodes.find((node) => node.id === selectedId) || defaultNode;
  const graphNode =
    graph.nodes.find((node) => node.id === graphSelected) || defaultNode;
  const filtered = useMemo(
    () =>
      graph.nodes.filter((node) =>
        `${node.title} ${node.rule_name} ${node.agency} ${article(node)} ${node.id}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())
      ),
    [search]
  );
  const impacted = useMemo(() => backlinks(impactId), [impactId]);
  const selectedDocument = snapshot.package_example.documents[documentIndex];
  const connectedEdges = graph.edges.filter(
    (edge) => edge.source === graphSelected || edge.target === graphSelected
  );

  return (
    <div className="demo-page public-preview">
      {/* Header Banner */}
      <div
        className="page-header-card"
        style={{
          background: "#ffffff",
          border: "1px solid #e1ebe0",
          borderRadius: "14px",
          padding: "24px 28px",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "16px" }}>
          <FlaskConical size={26} color="#2b6348" style={{ marginTop: 2 }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1a3827", margin: 0 }}>
                합성 예제 규정 체험관
              </h1>
              <span className="pill warning">합성 시뮬레이션 자료</span>
            </div>
            <p style={{ fontSize: "13px", color: "#688070", margin: "6px 0 0" }}>
              한국행정연구원 공공데이터제공지침 등 12개 가상 조문과 서식으로 규정 관계 탐색, 역참조 영향 분석, 7종 개정 문서를 체험합니다.
            </p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setTab("vault")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "vault" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "vault" ? "#285b41" : "#ffffff",
              color: tab === "vault" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
          >
            <Library size={15} />
            <span>예제 저장소 열람</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("graph")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "graph" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "graph" ? "#285b41" : "#ffffff",
              color: tab === "graph" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
          >
            <Network size={15} />
            <span>관계도 시각화</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("impact")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "impact" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "impact" ? "#285b41" : "#ffffff",
              color: tab === "impact" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
          >
            <GitBranch size={15} />
            <span>변경 영향 예제</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("packages")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "packages" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "packages" ? "#285b41" : "#ffffff",
              color: tab === "packages" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
          >
            <Files size={15} />
            <span>검토 문서 7종 예제</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Vault */}
      {tab === "vault" && (
        <div className="preview-vault-layout">
          <section className="panel preview-vault-list">
            <label className="preview-search">
              <Search size={17} />
              <input
                aria-label="예제 규정 검색"
                placeholder="규정명, 조문, 기관 검색"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="preview-list-count">합성 예제 {filtered.length}개</div>
            <div className="preview-node-list">
              {filtered.map((node) => (
                <button
                  key={node.id}
                  className={node.id === selectedId ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(node.id);
                    setSourceView(false);
                  }}
                >
                  <FileText size={18} />
                  <span>
                    <strong>{node.title}</strong>
                    <small>
                      {node.rule_name} · {article(node)}
                    </small>
                    <em>{node.agency}</em>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {!filtered.length && (
                <p className="preview-empty">일치하는 예제 문서가 없습니다.</p>
              )}
            </div>
          </section>

          <section className="panel preview-reader">
            <div className="preview-reader-header">
              <span className="pill warning">합성 예제 · 읽기 전용</span>
              <h2>{selected.title}</h2>
              <p>
                {selected.rule_name} · {article(selected)}
              </p>
              <div className="preview-reader-actions">
                <button
                  className={!sourceView ? "selected" : ""}
                  onClick={() => setSourceView(false)}
                >
                  조문 내용
                </button>
                <button
                  className={sourceView ? "selected" : ""}
                  onClick={() => setSourceView(true)}
                >
                  Markdown 원본
                </button>
              </div>
            </div>
            <pre>{sourceView ? selected.markdown : selected.body}</pre>
            <div className="preview-reader-path">
              <FileText size={13} />
              <span>{selected.path}</span>
            </div>
          </section>
        </div>
      )}

      {/* Tab 2: Graph */}
      {tab === "graph" && (
        <div className="preview-graph-layout">
          <section className="panel preview-graph-panel">
            <div className="panel-heading">
              <div>
                <h3>규정 관계 그래프</h3>
                <p>
                  {graph.nodes.length}개 예제 문서 · {graph.edges.length}개 관계
                </p>
              </div>
              <span className="pill neutral">브라우저 내 탐색</span>
            </div>
            <PreviewGraph selected={graphSelected} onSelect={setGraphSelected} />
            <div className="preview-graph-legend">
              <span>
                <i className="law" />
                상위법 예제
              </span>
              <span>
                <i />
                기관 규정·서식 예제
              </span>
            </div>
          </section>

          <section className="panel preview-graph-detail">
            <span className="pill warning">선택한 합성 예제</span>
            <h2>{graphNode.title}</h2>
            <p>
              {graphNode.rule_name} · {article(graphNode)}
            </p>
            <h3>
              연결된 관계 <span>{connectedEdges.length}</span>
            </h3>
            <div className="preview-connections">
              {connectedEdges.map((edge, index) => {
                const other = graph.nodes.find(
                  (node) =>
                    node.id ===
                    (edge.source === graphSelected ? edge.target : edge.source)
                );
                return other ? (
                  <button
                    key={`${edge.type}-${index}`}
                    onClick={() => setGraphSelected(other.id)}
                  >
                    <small>{edge.type}</small>
                    <strong>{other.title}</strong>
                    <span>
                      {other.rule_name} · {article(other)}
                    </span>
                  </button>
                ) : null;
              })}
              {!connectedEdges.length && (
                <p className="preview-empty">이 예제에 연결된 관계가 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Impact */}
      {tab === "impact" && (
        <section className="panel preview-impact">
          <label htmlFor="preview-impact-target">살펴볼 예제 문서</label>
          <select
            id="preview-impact-target"
            value={impactId}
            onChange={(event) => setImpactId(event.target.value)}
          >
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.rule_name} {article(node)} · {node.title}
              </option>
            ))}
          </select>
          <div className="preview-inline-note">
            <GitBranch size={18} />
            <p>
              예제 관계의 역참조 탐색입니다. 선택한 문서를 참조하는 하위 규정과 서식을 추적합니다.
            </p>
          </div>
          <h3>
            연결을 따라 확인할 문서 <span>{impacted.length}개</span>
          </h3>
          <div className="preview-impact-results">
            {impacted.map((node) => (
              <button
                key={node.id}
                onClick={() => {
                  setSelectedId(node.id);
                  setTab("vault");
                }}
              >
                <span className="preview-depth">{node.depth}단계</span>
                <span>
                  <strong>{node.title}</strong>
                  <small>
                    {node.rule_name} · {article(node)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!impacted.length && (
              <p className="preview-empty">이 예제 그래프에는 역참조 대상이 없습니다.</p>
            )}
          </div>
        </section>
      )}

      {/* Tab 4: Packages */}
      {tab === "packages" && (
        <div className="preview-package-layout">
          <section className="panel preview-package-list">
            <div className="panel-heading">
              <div>
                <h3>데이터 반출 조문 검토 예제</h3>
                <p>공공데이터제공지침 · 제7조</p>
              </div>
            </div>
            {snapshot.package_example.documents.map((doc, index) => (
              <button
                key={doc.name}
                className={documentIndex === index ? "selected" : ""}
                onClick={() => setDocumentIndex(index)}
              >
                <span className="preview-document-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>
                    {doc.name.replace(/^\d+_/, "").replace(/\.md$/, "")}
                  </strong>
                  <small>Markdown · 검토용 합성 예제</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </section>

          <section className="panel preview-package-reader">
            <div className="preview-reader-header">
              <span className="pill warning">합성 예제 · 검토용 초안</span>
              <h2>
                {selectedDocument?.name
                  .replace(/^\d+_/, "")
                  .replace(/\.md$/, "")}
              </h2>
              <p>미리 만든 문서를 읽기 전용으로 보여줍니다.</p>
            </div>
            <pre>{selectedDocument?.content}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
