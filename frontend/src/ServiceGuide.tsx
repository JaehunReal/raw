import { useState } from "react";
import { ArrowRight, BookOpen, Network, FileCheck2, Monitor, PlugZap, MessageSquare, Copy, Check, ChevronRight } from "lucide-react";
import "./service-guide.css";

type Destination = "vault" | "graph" | "impact" | "packages" | "laws" | "mcp";
const examples = [
  { title: "상위 근거 찾기", request: "RuleCraft로 한국행정연구원 공공데이터제공지침 제7조의 상위 근거 관계를 조회해 줘. 합성 예제임을 표시하고, 확인한 조문과 연결 근거를 함께 보여 줘.", result: "대상 조문 · 상위 근거 · 연결 관계", check: "실무에서는 기관명·규정명·조 번호를 실제 자료에 맞추고, 원문과 시행일을 확인하세요." },
  { title: "변경 영향 살피기", request: "RuleCraft의 statutes/개인정보보호법/제15조_수집이용.md 합성 예제에서 연결된 규정과 서식을 찾아 줘. 실제 개정안을 제공하기 전에는 영향이 확정됐다고 표현하지 마.", result: "연결된 규정 · 서식 · 추가 검토 대상", check: "실제 영향 분석에는 현재 파일과 일치하는 개정안이 필요합니다. 담당 업무에 적용되는지는 직접 검토하세요." },
  { title: "신구조문대비표 만들기", request: "RuleCraft로 다음 합성 예제의 신구조문대비표 초안을 만들어 줘. 현행: 제7조 ① 신청서를 제출하여야 한다. 개정안: 제7조 ① 신청서에 처리 목적을 기재하여야 한다. 개정 이유: 신청 목적을 명확히 확인하기 위함. 담당자 검토가 필요한 초안임을 표시해 줘.", result: "현행 조문 · 개정안 · 개정 이유", check: "표현, 근거, 시행일을 확인한 뒤 기관의 검토·결재 절차를 진행하세요." },
];

export function ServiceOverview({ onNavigate }: { onNavigate: (view: Destination) => void }) {
  return <div className="service-guide" data-testid="service-overview">
    <section className="guide-hero">
      <div className="guide-intro"><span className="guide-kicker">공무원을 위한 규정 검토 도우미</span>
        <h1>규정을 찾고,<br />근거를 연결하고,<br /><em>개정 검토를 준비하세요.</em></h1>
        <p>RuleCraft는 법령·기관 규정·서식의 연결을 살펴보고,<br className="guide-desktop-break" /> 규정을 고칠 때 함께 검토할 자료를 찾는 작업 공간입니다.</p>
        <div className="guide-actions"><button className="guide-primary" onClick={() => onNavigate("laws")}>공식 법령 찾아보기 <ArrowRight size={17} /></button><button className="guide-secondary" onClick={() => onNavigate("mcp")}>MCP 사용법 보기 <ChevronRight size={16} /></button></div>
        <span className="guide-caption">처음이라면 아래의 업무 흐름부터 살펴보세요.</span>
      </div>
      <figure className="guide-map" aria-label="법령에서 기관 규정과 서식까지 연결해 검토하는 개념도">
        <figcaption>흩어진 문서를 하나의 검토 흐름으로 <span>개념도</span></figcaption>
        <div className="guide-map-node"><BookOpen /><div><small>근거를 확인합니다</small><strong>법령 · 행정규칙 · 자치법규</strong></div></div>
        <div className="guide-map-link"><span />위임·인용 관계<span /></div>
        <div className="guide-map-node central"><Network /><div><small>우리 기관의 업무와 연결합니다</small><strong>기관 규정 · 업무 지침</strong></div></div>
        <div className="guide-map-link"><span />함께 검토할 대상<span /></div>
        <div className="guide-map-pair"><div><FileCheck2 /><strong>신청서·서식</strong></div><div><FileCheck2 /><strong>개정 검토 문서</strong></div></div>
        <p>관계 탐색 화면에서는 합성 예제로 이 흐름을 체험합니다.</p>
      </figure>
    </section>
    <section className="guide-section" aria-labelledby="workflow-heading"><div className="guide-section-heading"><span className="guide-kicker">업무는 이렇게 시작합니다</span><h2 id="workflow-heading">찾기 → 연결 확인 → 검토 준비</h2></div>
      <div className="guide-steps">{[
        { n: "01", icon: BookOpen, title: "검토할 규정을 찾습니다", text: "공식 법령에서 원문을 조회하거나, 규정 예제로 조문 읽기를 체험하세요.", action: "규정 예제 열기", view: "vault" },
        { n: "02", icon: Network, title: "함께 볼 근거를 찾습니다", text: "조문을 선택해 상위 근거와 연결된 지침·서식을 확인하세요.", action: "관계도 체험하기", view: "graph" },
        { n: "03", icon: FileCheck2, title: "검토 결과를 정리합니다", text: "변경 영향과 대비표 등 문서 예제를 살펴보고 검토 항목을 이해하세요.", action: "검토 문서 예제 보기", view: "packages" },
      ].map(step => <article key={step.n}><div className="guide-step-top"><span>{step.n}</span><step.icon size={25} /></div><h3>{step.title}</h3><p>{step.text}</p><button onClick={() => onNavigate(step.view as Destination)}>{step.action}<ArrowRight size={16} /></button></article>)}</div>
    </section>
    <section className="guide-section guide-ways" aria-labelledby="ways-heading"><div><span className="guide-kicker">사용 방법 두 가지</span><h2 id="ways-heading">웹에서 둘러보고,<br />연결된 AI에서 요청하세요.</h2></div><article><Monitor /><h3>웹페이지에서 직접 보기</h3><p>공식 원문 조회와 예제 탐색을 메뉴로 사용합니다. 별도의 MCP 설정 없이 시작할 수 있습니다.</p><button onClick={() => onNavigate("laws")}>공식 원문 조회 <ArrowRight size={15} /></button></article><article><PlugZap /><h3>AI 도구에서 MCP로 요청하기</h3><p>담당자가 RuleCraft를 연결한 AI 도구에서, 원하는 업무를 문장으로 요청합니다.</p><button onClick={() => onNavigate("mcp")}>연결과 요청 방법 <ArrowRight size={15} /></button></article></section>
  </div>;
}

export function McpGuide() {
  const [selected, setSelected] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const example = examples[selected];
  async function copyRequest() {
    try { await navigator.clipboard.writeText(example.request); setCopyStatus("복사했습니다. RuleCraft가 연결된 AI 도구에 붙여 넣으세요."); }
    catch { setCopyStatus("자동 복사를 사용할 수 없습니다. 아래 요청문을 선택해 복사하세요."); }
  }
  return <section className="service-guide guide-mcp" data-testid="mcp-guide">
    <header><span className="guide-kicker">처음 사용하는 담당자를 위한 MCP 안내</span><h2>평소처럼 질문하면,<br />AI가 규정 도구를 사용합니다.</h2><p>MCP는 <strong>AI와 규정 자료·업무 도구를 연결하는 방식</strong>입니다.<br />담당자가 한 번 연결하면, 사용자는 필요한 일을 문장으로 요청할 수 있습니다.</p></header>
    <ol className="guide-mcp-flow" aria-label="MCP가 동작하는 순서"><li><MessageSquare /><strong>내가 업무를 요청</strong><span>“이 조문의 근거를 찾아 줘”</span></li><li><PlugZap /><strong>AI가 RuleCraft 도구 사용</strong><span>연결된 규정과 원문 조회</span></li><li><FileCheck2 /><strong>내가 근거와 결과 확인</strong><span>원문·기준일·검토 범위 확인</span></li></ol>
    <div className="guide-mcp-note"><Monitor size={20} /><p><strong>이 웹페이지에서는 사용 방법과 예제를 살펴봅니다.</strong><br />아래 요청문은 RuleCraft가 연결된 AI 도구에서 사용하세요. Vercel 웹 주소를 MCP 서버 주소로 입력하면 연결되지 않습니다.</p></div>
    <div className="guide-mcp-columns"><section className="guide-connect"><h3>처음 연결할 때는 이렇게</h3><ol><li><strong>연결 담당자에게 요청하세요</strong><p>“사용 중인 AI 도구에 RuleCraft 로컬 MCP를 연결해 주세요.”</p></li><li><strong>도구가 보이는지 확인하세요</strong><p>AI 도구에서 RuleCraft와 ‘조문 관계 탐색’, ‘신구조문대비표’ 도구가 확인되면 요청할 준비가 된 것입니다.</p></li><li><strong>예제 요청부터 실행하세요</strong><p>예제 요청문을 복사해 AI 도구에 붙여 넣고, 합성 예제 결과가 돌아오는지 확인하세요.</p></li></ol></section>
    <section className="guide-prompt"><span className="guide-kicker">바로 써 볼 수 있는 요청문</span><h3>어떤 업무를 해 보고 싶으세요?</h3><div className="guide-prompt-options" aria-label="MCP 요청 예제 선택">{examples.map((e, i) => <button key={e.title} aria-pressed={i === selected} onClick={() => { setSelected(i); setCopyStatus(""); }}>{e.title}</button>)}</div><div className="guide-request" data-testid="mcp-request"><span>합성 자료로 연습하는 예제</span><p>{example.request}</p></div><button className="guide-primary" onClick={() => void copyRequest()}>{copyStatus.startsWith("복사했습니다") ? <Check size={16} /> : <Copy size={16} />} 요청문 복사</button><p role="status" className="guide-copy-status">{copyStatus}</p><div className="guide-result"><strong>확인할 결과</strong><p>{example.result}</p><small>{example.check}</small></div></section></div>
    <details className="guide-admin"><summary>연결 담당자용 설정 안내</summary><div><p>현재 RuleCraft는 컴퓨터에서 실행하는 로컬 stdio MCP 서버를 제공합니다. Python 3.12 이상과 uv를 준비하고 프로젝트를 설치한 뒤, AI 도구의 로컬 MCP 설정에 서버 실행 명령을 등록하세요.</p><pre>{"git clone https://github.com/JaehunReal/raw.git\ncd raw\nuv sync --project backend --frozen"}</pre><p>실행 명령: <code>uv</code><br />인수: <code>run --frozen --project /실제경로/raw/backend rulecraft-mcp</code></p><p>규정집 경로와 공식 원문 저장소를 지정해야 해당 자료를 조회할 수 있습니다. 클라이언트별 설정 형식과 자료 경로는 연결 가이드를 확인하세요.</p><a href="https://github.com/JaehunReal/raw/blob/main/docs/mcp.md" target="_blank" rel="noreferrer">전체 연결 가이드 열기 <ArrowRight size={15} /></a></div></details>
    <p className="guide-caption">생성된 대비표는 담당자가 검토할 초안입니다. 이미지 서식 분석은 별도 모델 연결이 필요합니다.</p>
  </section>;
}
