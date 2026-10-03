import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Code2,
  FileText,
  GitBranch,
  Image,
  Loader2,
  Network,
  Play,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import "./mcp.css";
import { McpGuide } from "./ServiceGuide";
import { apiFetch } from "./apiFetch";

type DemoNode = {
  id: string;
  path: string;
  title: string;
  agency: string;
  rule_name: string;
  article_no: string | number;
  kind: string;
  markdown: string;
};
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
type Connection = {
  server: { name: string; version: string };
  protocol_version: string;
  transport: string;
  tools: Tool[];
};
type Call = {
  tool_name: string;
  transport: string;
  is_error: boolean;
  result: Record<string, unknown>;
  server: { name: string; version: string };
  duration_ms: number;
};
type ResultNode = DemoNode & { depth?: number };
const toolCards = [
  {
    name: "query_markdown_graph",
    title: "조문 관계 탐색",
    description: "기관 지침의 상위법과 위임 관계를 확인합니다.",
    icon: Network,
    tag: "GRAPH",
  },
  {
    name: "analyze_git_delta_impact",
    title: "변경 영향 분석",
    description: "상위법 변경이 영향을 주는 규정과 서식을 찾습니다.",
    icon: GitBranch,
    tag: "IMPACT",
  },
  {
    name: "generate_statutory_diff",
    title: "신구조문대비표",
    description: "현행·개정안·이유를 함께 비교합니다.",
    icon: FileText,
    tag: "DOCUMENT",
  },
  {
    name: "parse_form_with_vision",
    title: "이미지 서식 분석",
    description: "연결된 Vision 모델로 이미지의 서식을 읽습니다.",
    icon: Image,
    tag: "VISION",
  },
];
const purpose = "인공지능 학습 목적과 안전성 요건을 명확히 하기 위함";
async function fetchJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(
    `/api/mcp/${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail || data),
    );
  return data;
}
function example(name: string, nodes: DemoNode[]): Record<string, unknown> {
  const law = nodes.find((n) => n.id === "LAW-PRIV-015");
  const rule = nodes.find((n) => n.id === "KIPA-RULE-DAT-007");
  if (name === "query_markdown_graph")
    return {
      agency_name: rule?.agency || "한국행정연구원",
      rule_name: rule?.rule_name || "공공데이터제공지침",
      article_no: 7,
      traverse_direction: "UPWARD_PARENT",
    };
  if (name === "analyze_git_delta_impact")
    return {
      target_file_path:
        law?.path || "statutes/개인정보보호법/제15조_수집이용.md",
      proposed_diff:
        (law?.markdown || "") +
        "\n③ 인공지능 학습 목적의 데이터 이용 시 처리 목적과 안전성 요건을 확인하여야 한다.\n",
    };
  if (name === "generate_statutory_diff")
    return {
      current_markdown:
        rule?.markdown ||
        "# 제7조 (데이터 반출)\n① 부서장의 승인을 받아야 한다.",
      revised_markdown:
        (rule?.markdown ||
          "# 제7조 (데이터 반출)\n① 부서장의 승인을 받아야 한다.") +
        "\n③ 인공지능 모델 학습 목적의 반출은 개인정보 보호 요건을 사전에 확인하여야 한다.\n",
      amendment_reason: purpose,
    };
  return {
    image_data_base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE5kAAAAASUVORK5CYII=",
    output_format: "markdown_table",
  };
}

export default function McpPlayground({
  nodes,
  onOpenNode,
  onConnectionCheck,
}: {
  nodes: DemoNode[];
  onOpenNode: (node: DemoNode) => void;
  onConnectionCheck: () => void;
}) {
  const [selected, setSelected] = useState(toolCards[0].name),
    [parameters, setParameters] = useState(() =>
      JSON.stringify(example(toolCards[0].name, nodes), null, 2),
    );
  const [connection, setConnection] = useState<Connection | null>(null),
    [connecting, setConnecting] = useState(true),
    [running, setRunning] = useState(false),
    [error, setError] = useState("");
  const [response, setResponse] = useState<Call | null>(null),
    [showRaw, setShowRaw] = useState(false),
    [executionCount, setExecutionCount] = useState(0);
  const card = toolCards.find((t) => t.name === selected)!;
  async function connect() {
    setConnecting(true);
    setError("");
    try {
      setConnection(await fetchJson<Connection>("tools"));
    } catch (e) {
      setConnection(null);
      setError((e as Error).message);
    } finally {
      setConnecting(false);
      onConnectionCheck();
    }
  }
  useEffect(() => {
    void connect();
  }, []);
  function choose(name: string) {
    setSelected(name);
    setParameters(JSON.stringify(example(name, nodes), null, 2));
    setResponse(null);
    setError("");
    setShowRaw(false);
  }
  async function run() {
    setRunning(true);
    setError("");
    setResponse(null);
    try {
      const args = JSON.parse(parameters);
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error("입력은 JSON 객체여야 합니다.");
      const result = await fetchJson<Call>("call", {
        tool_name: selected,
        arguments: args,
      });
      setResponse(result);
      setExecutionCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      onConnectionCheck();
    }
  }
  const available = connection?.tools.some((t) => t.name === selected);
  const unavailable =
    response?.result.status === "unavailable" ||
    response?.result.status === "invalid_input";
  return (
    <>
      <div className="page-heading mcp-page-heading">
        <div>
          <div className="eyebrow">
            <span className="small-line" /> MCP EXAMPLE WORKSPACE
          </div>
          <h1>연결을 확인하고, 결과를 살펴보세요.</h1>
          <p>예제 조문으로 실제 MCP 도구를 실행하고 반환 결과를 확인합니다.</p>
        </div>
        <button
          className="button secondary"
          disabled={connecting || running}
          onClick={() => void connect()}
        >
          <RefreshCw size={15} className={connecting ? "spin" : ""} />
          MCP 연결 확인
        </button>
      </div>
      <McpGuide />
      <section
        className={`mcp-connection ${connection ? "connected" : ""}`}
        data-testid="mcp-connection"
      >
        <span className="mcp-connection-icon">
          <PlugZap size={22} />
        </span>
        <div>
          <strong>
            {connection
              ? `${connection.server.name} MCP 서버`
              : connecting
                ? "MCP 서버에 연결하고 있습니다."
                : "MCP 서버 연결을 확인해주세요."}
          </strong>
          <p>
            {connection
              ? `초기화와 도구 목록 조회 완료 · ${connection.tools.length}개 도구 · ${connection.transport} 전송`
              : "웹 → API 호스트 → MCP 서버 순서로 실제 연결을 확인합니다."}
          </p>
        </div>
        <span className={`pill ${connection ? "sage" : "neutral"}`}>
          {connecting ? (
            <>
              <Loader2 size={11} className="spin" />
              연결 중
            </>
          ) : connection ? (
            <>
              <CheckCircle2 size={11} />
              연결 확인됨
            </>
          ) : (
            "연결 실패"
          )}
        </span>
        {connection && (
          <span className="mcp-protocol">
            Protocol {connection.protocol_version}
          </span>
        )}
      </section>
      <div className="mcp-tool-grid">
        {toolCards.map((t) => (
          <button
            className={`mcp-tool-card ${selected === t.name ? "active" : ""}`}
            key={t.name}
            data-testid={`mcp-tool-${t.name}`}
            onClick={() => choose(t.name)}
            disabled={running}
          >
            <span className="mcp-tool-heading">
              <span className="mcp-tool-icon">
                <t.icon size={20} />
              </span>
              <span>{t.tag}</span>
              {selected === t.name && <CheckCircle2 size={15} />}
            </span>
            <strong>{t.title}</strong>
            <p>{t.description}</p>
            <code>{t.name}</code>
          </button>
        ))}
      </div>
      <div className="mcp-workbench">
        <section className="panel mcp-input-panel">
          <div className="panel-heading">
            <div>
              <h3>
                {card.title}
                <span className="count-tag">INPUT</span>
              </h3>
              <p>예제 입력을 바꾸어 결과를 비교해볼 수 있습니다.</p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setParameters(
                  JSON.stringify(example(selected, nodes), null, 2),
                );
                setError("");
                setResponse(null);
              }}
              disabled={running}
            >
              <RefreshCw size={12} />
              예제 다시 불러오기
            </button>
          </div>
          <div className="mcp-example-note">
            <ShieldCheck size={16} />
            <span>
              {selected === "query_markdown_graph"
                ? "예제: 공공데이터제공지침 제7조의 상위법 탐색"
                : selected === "analyze_git_delta_impact"
                  ? "예제: 개인정보보호법 제15조에 AI 학습 요건 추가"
                  : selected === "generate_statutory_diff"
                    ? "예제: 데이터 반출 조문에 AI 학습 사전 검토 요건 추가"
                    : "Vision 모델 미연결 시 사용 불가 상태를 그대로 표시합니다."}
            </span>
          </div>
          <label className="mcp-input-label" htmlFor="mcp-json-input">
            도구 입력 (JSON)
          </label>
          <textarea
            id="mcp-json-input"
            className="code-editor mcp-json-editor"
            aria-label="MCP 도구 입력"
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            spellCheck={false}
          />
          <button
            className="button primary wide"
            data-testid="mcp-run"
            onClick={() => void run()}
            disabled={connecting || running || !available}
          >
            {running ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Play size={15} />
            )}
            실제 MCP 실행
          </button>
          <p className="mcp-input-foot">
            실행은 미리보기입니다. 원본 규정 파일을 변경하지 않습니다.
          </p>
        </section>
        <section className="panel mcp-result-panel" data-testid="mcp-result">
          <div className="panel-heading">
            <div>
              <h3>
                도구 실행 결과 <span className="count-tag">OUTPUT</span>
              </h3>
              <p>
                {response
                  ? `${response.server.name} · ${response.transport} · ${response.duration_ms}ms`
                  : "MCP 서버가 반환한 결과를 표시합니다."}
              </p>
            </div>
            {response && (
              <button
                className={`text-button ${showRaw ? "selected" : ""}`}
                onClick={() => setShowRaw(!showRaw)}
              >
                <Code2 size={14} />
                {showRaw ? "결과 보기" : "JSON 보기"}
              </button>
            )}
          </div>
          {error && (
            <div className="mcp-error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}
          {running && (
            <div className="empty-state mcp-wait">
              <span>
                <Loader2 size={30} className="spin" />
              </span>
              <h3>MCP 도구를 실행하고 있습니다.</h3>
              <p>서버 초기화 → tools/call → 결과 수신</p>
            </div>
          )}
          {!response && !running && !error && (
            <div className="empty-state">
              <span>
                <PlugZap size={30} />
              </span>
              <h3>예제로 연결을 확인해보세요.</h3>
              <p>
                왼쪽의 실행 버튼을 누르면
                <br />
                실제 MCP 반환 결과가 여기에 표시됩니다.
              </p>
            </div>
          )}
          {response && (
            <>
              <div
                className={`mcp-result-status ${response.is_error || unavailable ? "unavailable" : ""}`}
              >
                <span>
                  {response.is_error || unavailable ? (
                    <AlertTriangle size={18} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                </span>
                <div>
                  <strong>
                    {response.is_error
                      ? "도구가 오류를 반환했습니다."
                      : unavailable
                        ? "이 도구는 현재 사용할 수 없습니다."
                        : "MCP 호출이 완료되었습니다."}
                  </strong>
                  <small>
                    {response.is_error
                      ? "입력과 서버 오류를 확인해주세요."
                      : unavailable
                        ? "모델 연결 상태를 확인한 실제 응답입니다."
                        : "표시된 결과는 MCP 서버의 실제 반환 값입니다."}
                  </small>
                </div>
              </div>
              {showRaw ? (
                <pre className="mcp-raw-result">
                  {JSON.stringify(response.result, null, 2)}
                </pre>
              ) : (
                <ResultView
                  response={response}
                  selected={selected}
                  onOpenNode={onOpenNode}
                />
              )}
            </>
          )}
        </section>
      </div>
      <div className="mcp-bottom-note">
        <ShieldCheck size={17} />
        <p>
          예제 법령은 시연용 데이터입니다. MCP는 도구 연결을 표준화하며, 인용
          검증이 법률 검토를 대신하지는 않습니다.
        </p>
        <span>{executionCount}회 실행</span>
      </div>
    </>
  );
}

function ResultView({
  response,
  selected,
  onOpenNode,
}: {
  response: Call;
  selected: string;
  onOpenNode: (node: DemoNode) => void;
}) {
  const data = response.result;
  if (data.status === "unavailable" || data.status === "invalid_input")
    return (
      <div className="mcp-unavailable-result">
        <Image size={33} />
        <h3>Vision 모델 연결이 필요합니다.</h3>
        <p>{String(data.error || "LLaVA 서버가 연결되어 있지 않습니다.")}</p>
        <small>이미지 인식 결과를 생성하지 않았습니다.</small>
      </div>
    );
  if (response.is_error)
    return (
      <pre className="mcp-raw-result">{JSON.stringify(data, null, 2)}</pre>
    );
  if (selected === "query_markdown_graph") {
    const nodes = (data.nodes || []) as ResultNode[];
    const edges = (data.edges || []) as {
      source: string;
      target: string;
      type: string;
    }[];
    return (
      <>
        <div className="mcp-result-metrics">
          <div>
            <strong>{nodes.length}</strong>
            <span>연결된 조문</span>
          </div>
          <div>
            <strong>{edges.length}</strong>
            <span>인용·위임 관계</span>
          </div>
          <div>
            <strong>{((data.issues || []) as unknown[]).length}</strong>
            <span>검증 항목</span>
          </div>
        </div>
        <McpGraph nodes={nodes} edges={edges} />
        <div className="mcp-node-list">
          {nodes.map((n) => (
            <button key={n.id} onClick={() => onOpenNode(n)}>
              <span className={`file-icon ${n.kind === "form" ? "form" : ""}`}>
                <FileText size={16} />
              </span>
              <span>
                <strong>
                  {n.rule_name} {n.article_no}
                </strong>
                <small>
                  {n.title} · {n.agency}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <ResultIssues issues={data.issues} />
      </>
    );
  }
  if (selected === "analyze_git_delta_impact") {
    const nodes = (data.impacted_nodes || []) as ResultNode[];
    return (
      <>
        <div className="mcp-impact-summary">
          <GitBranch size={24} />
          <div>
            <strong data-testid="mcp-impact-count">
              {nodes.length}개 문서에 영향
            </strong>
            <span>
              {data.changed
                ? "상위 조문 개정안에서 변경이 감지되었습니다."
                : "현행 조문과 변경 내용이 같습니다."}
            </span>
          </div>
        </div>
        <div className="mcp-node-list">
          {nodes.map((n) => (
            <button key={n.id} onClick={() => onOpenNode(n)}>
              <span className={`file-icon ${n.kind === "form" ? "form" : ""}`}>
                <FileText size={16} />
              </span>
              <span>
                <strong>{n.title}</strong>
                <small>
                  {n.rule_name} ·{" "}
                  {n.depth === 1 ? "직접 영향" : `${n.depth}단계 연결`}
                </small>
              </span>
              <span className="pill sage">
                {n.kind === "form" ? "별지 서식" : "조문"}
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <ResultIssues issues={data.issues} />
        {((data.suggested_link_edits || []) as unknown[]).length > 0 && (
          <pre className="mcp-raw-result">
            {JSON.stringify(data.suggested_link_edits, null, 2)}
          </pre>
        )}
      </>
    );
  }
  if (selected === "generate_statutory_diff")
    return (
      <>
        <div className="mcp-diff-caption">
          <FileText size={16} />
          <strong>현행 · 개정안 · 개정이유</strong>
          <span className="pill sage">검토용 초안</span>
        </div>
        <Comparison markdown={String(data.markdown || "")} />
        <p className="mcp-review-note">
          담당자가 근거와 문안을 확인한 후 확정해야 합니다.
        </p>
      </>
    );
  return <pre className="mcp-raw-result">{JSON.stringify(data, null, 2)}</pre>;
}
function ResultIssues({ issues }: { issues: unknown }) {
  return Array.isArray(issues) && issues.length > 0 ? (
    <div className="issue-list">
      {issues.map((i, index) => (
        <div key={index}>
          <AlertTriangle size={14} />
          <span>{String(i.message || i.code)}</span>
        </div>
      ))}
    </div>
  ) : null;
}
function Comparison({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n").filter((l) => l.startsWith("|"));
  const cells = (line: string) =>
    line
      .slice(1, line.lastIndexOf("|"))
      .split("|")
      .map((c) => c.trim());
  function decode(text: string) {
    return text
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/&#124;/g, "|")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return (
    <div className="mcp-comparison-scroll">
      <table className="mcp-comparison">
        <thead>
          <tr>
            {(lines[0] ? cells(lines[0]) : ["현행", "개정안", "개정이유"]).map(
              (h, i) => (
                <th key={i}>{decode(h)}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {lines.slice(2).map((line, i) => (
            <tr key={i}>
              {cells(line).map((cell, j) => (
                <td key={j}>{decode(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function McpGraph({
  nodes,
  edges,
}: {
  nodes: ResultNode[];
  edges: { source: string; target: string; type: string }[];
}) {
  const laws = nodes.filter((n) => n.agency === "국가법령"),
    rules = nodes.filter((n) => n.agency !== "국가법령");
  const positions = new Map<string, { x: number; y: number }>();
  const width = 600;
  function place(row: ResultNode[], startY: number) {
    row.forEach((n, i) => {
      const group = Math.floor(i / 3);
      const count = Math.min(3, row.length - group * 3);
      positions.set(n.id, {x: (i % 3 + 0.5) * (width / count), y: startY + group * 90});
    });
  }
  place(laws, 54);
  const rulesY = 54 + Math.max(1, Math.ceil(laws.length / 3)) * 115;
  place(rules, rulesY);
  const height = Math.max(235, rulesY + Math.max(0, Math.ceil(rules.length / 3) - 1) * 90 + 65);
  const unique = edges.filter(
    (e, i) =>
      edges.findIndex((o) => o.source === e.source && o.target === e.target) ===
      i,
  );
  return (
    <div className="mcp-result-graph">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="MCP가 반환한 조문 관계"
      >
        <defs>
          <pattern
            id="mcp-dots"
            width="17"
            height="17"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#c6d3bd" />
          </pattern>
        </defs>
        <rect width={width} height="100%" fill="url(#mcp-dots)" />
        {unique.map((e) => {
          const s = positions.get(e.source),
            t = positions.get(e.target);
          return s && t ? (
            <path
              key={e.source + e.target}
              d={`M${s.x},${s.y} C${s.x},${(s.y + t.y) / 2} ${t.x},${(s.y + t.y) / 2} ${t.x},${t.y}`}
              stroke="#a5b99a"
              strokeWidth="1.5"
              fill="none"
            />
          ) : null;
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const law = n.agency === "국가법령";
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <rect
                x="-95"
                y="-25"
                width="190"
                height="50"
                rx="9"
                fill={law ? "#f7f4e8" : "#2d5746"}
                stroke={law ? "#dcd6bc" : "#2d5746"}
              />
              <text
                textAnchor="middle"
                y="-3"
                fontSize="11"
                fontWeight="600"
                fill={law ? "#7c7658" : "#fff"}
              >
                {n.rule_name.length > 16
                  ? n.rule_name.slice(0, 16) + "…"
                  : n.rule_name}
              </text>
              <text
                textAnchor="middle"
                y="14"
                fontSize="9"
                fill={law ? "#a79e7d" : "#c6d8bd"}
              >
                {n.article_no} · {n.title.slice(0, 17)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
