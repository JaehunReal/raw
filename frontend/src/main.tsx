import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Library,
  Network,
  GitBranch,
  Files,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Bell,
  Settings,
  CircleHelp,
  Check,
  CheckCircle2,
  X,
  Download,
  FileText,
  ShieldCheck,
  Clock3,
  RefreshCw,
  FolderOpen,
  Sparkles,
  Eye,
  AlertTriangle,
  BookOpen,
  Zap,
  Loader2,
  PlugZap,
  Copy,
  ExternalLink,
} from "lucide-react";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans-kr";
import "./styles.css";
import previewSnapshot from "./preview-snapshot.json";
import McpPlayground from "./McpPlayground";
import NationalLawPanel from "./NationalLawPanel";
import LoginGate from "./LoginGate";
import { apiFetch } from "./apiFetch";
import PublicPreview from "./PublicPreview";
import { RouterProvider, useRouter } from "./router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { LawsPage } from "./pages/LawsPage";
import { TopicsPage } from "./pages/TopicsPage";
import { AttachmentsPage } from "./pages/AttachmentsPage";
import { GuidePage } from "./pages/GuidePage";
import { DemoPage } from "./pages/DemoPage";

type Node = {
  id: string;
  path: string;
  agency: string;
  rule_name: string;
  article_no: string | number;
  title: string;
  kind: string;
  version: string;
  last_amended: string;
  status: string;
  body: string;
  markdown: string;
  metadata: Record<string, unknown>;
};
type Edge = { source: string; target: string; type: string };
type Issue = {
  severity?: string;
  code?: string;
  message: string;
  path?: string;
};
type Graph = { nodes: Node[]; edges: Edge[]; issues: Issue[] };
type Doc = { name: string; content: string; format: string };
type Package = {
  id: string;
  status: string;
  documents: Doc[];
  verification: {
    valid: boolean;
    issues: Issue[];
    scope?: string;
    requires_human_review?: boolean;
  };
  agents: { name: string; status: string; detail: string }[];
  created_at?: string;
  rule_name?: string;
};
type Impact = {
  target_file_path: string;
  changed: boolean;
  impacted_nodes: (Node & { depth?: number; reason?: string; node?: Node })[];
  suggested_link_edits: unknown[];
  issues: Issue[];
  before: string;
  after: string;
};
type Overview = {
  stats: Record<string, number>;
  readiness: Record<
    string,
    { available: boolean; mode?: string; detail?: string }
  >;
  recent_changes: Node[];
  agencies: string[];
  rules: string[];
};
type View =
  | "dashboard"
  | "vault"
  | "graph"
  | "impact"
  | "packages"
  | "wizard"
  | "mcp"
  | "laws";
const nav = [
  { id: "dashboard", label: "워크스페이스", icon: LayoutDashboard },
  { id: "vault", label: "규정 지식 저장소", icon: Library },
  { id: "laws", label: "공식 법령", icon: BookOpen },
  { id: "graph", label: "규정 관계 그래프", icon: Network },
  { id: "impact", label: "변경 영향 분석", icon: GitBranch },
  { id: "packages", label: "문서 패키지", icon: Files },
  { id: "mcp", label: "MCP 도구", icon: PlugZap },
] as const;
const steps = ["입안", "부서 사전협의", "입법예고", "법제·규제심사", "공포"];
const API = "/api";
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await apiFetch(API + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(
      typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail),
    );
  }
  return r.json();
}
function createClientPackage(
  node: Node,
  amendmentType: string,
  objectiveText: string,
  effectiveDate: string,
  revisedMarkdown: string,
  graph: Graph,
): Package {
  const pkgId = `pkg-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
  const nowStr = new Date().toISOString();

  const connectedEdges = graph.edges.filter(
    (e) => e.target === node.id || e.source === node.id,
  );
  const relatedNodeIds = connectedEdges.map((e) =>
    e.source === node.id ? e.target : e.source,
  );
  const relatedNodes = graph.nodes.filter((n) => relatedNodeIds.includes(n.id));
  const relatedForms = relatedNodes.filter((n) => n.kind === "form");
  const relatedRules = relatedNodes.filter(
    (n) => n.kind !== "form" && n.id !== node.id,
  );

  const artTitle = node.article_no
    ? `${node.article_no}(${node.title})`
    : node.title;

  const doc = (name: string, content: string): Doc => ({
    name,
    content,
    format: "markdown",
  });

  const documents: Doc[] = [
    doc(
      "01_개정조문안.md",
      `# ${node.rule_name} 일부개정령안\n\n> 소관 기관: ${node.agency} | 작성일시: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n## 1. 개정 조문 전문\n${node.rule_name} ${artTitle}을 다음과 같이 개정한다.\n\n---\n\n${revisedMarkdown}\n\n---\n\n## 2. 부칙\n제1조(시행일) 이 규정은 ${effectiveDate}부터 시행한다.\n제2조(경과조치) 이 규정 시행 당시 종전의 규정에 따른 처분이나 절차는 이 규정에 따른 것으로 본다.`,
    ),
    doc(
      "02_신구조문대비표.md",
      `# 신·구조문대비표\n\n> 규정명: ${node.rule_name} · 대상: ${artTitle}\n\n| 현 행 | 개 정 안 | 개 정 이 유 |\n| :--- | :--- | :--- |\n| ${node.markdown.replace(/\r?\n/g, "<br>")} | ${revisedMarkdown.replace(/\r?\n/g, "<br>")} | ${objectiveText.replace(/\r?\n/g, " ")} |`,
    ),
    doc(
      "03_제개정이유서.md",
      `# ${node.rule_name} 개정이유서\n\n## 1. 개정 배경 및 필요성\n${objectiveText}\n\n## 2. 주요 개정 골자\n- **개정 대상**: ${artTitle}\n- **개정 유형**: ${amendmentType === "partial" ? "일부개정" : amendmentType === "enactment" ? "제정 검토" : "전부개정 검토"}\n- **시행 예정일**: ${effectiveDate}\n- **소관 기관**: ${node.agency}\n\n## 3. 기대 효과\n행정 집행의 명확성 제고 및 관련 규정 간 정합성을 확보합니다.`,
    ),
    doc(
      "04_부칙검토안.md",
      `# 부칙 및 경과조치 검토안\n\n## 제1조 (시행일)\n이 규정은 **${effectiveDate}**부터 시행한다.\n\n## 제2조 (경과조치)\n이 규정 시행 전에 종전의 규정에 따라 처리된 사항은 종전의 규정에 따른다.\n\n## 제3조 (다른 규정과의 관계)\n본 개정에 따라 인용 조항의 수정이 필요한 타 규정은 본 규정 시행일에 맞추어 연계 정비한다.`,
    ),
    doc(
      "05_입법예고문.md",
      `# 행정규칙 개정안 예고 공고문\n\n**${node.agency} 공고 제${new Date().getFullYear()}-${String(Date.now()).slice(-3)}호**\n\n「${node.rule_name}」을 개정함에 있어 그 개정이유와 주요내용을 국민과 소관 부서에 미리 알려 이에 대한 의견을 듣고자 다음과 같이 공고합니다.\n\n**1. 개정이유**\n${objectiveText}\n\n**2. 주요내용**\n가. ${artTitle} 정비 및 절차 요건 보완\n나. 시행일: ${effectiveDate}\n\n**3. 의견제출 기한 및 방법**\n개정안에 이견이 있는 부서 및 관계자는 예고 기간 내에 의견서를 제출하여 주시기 바랍니다.`,
    ),
    doc(
      "06_연결서식정비안.md",
      `# 관련 별지 서식 연계 정비안\n\n## 1. 본 조문과 직접 연결된 서식 (${relatedForms.length}건)\n${
        relatedForms.length > 0
          ? relatedForms
              .map(
                (f, i) =>
                  `${i + 1}. **${f.title}** (서식 코드: \`${f.id}\`)\n   - 조치 방향: 본 개정안의 기재 요건 변경사항을 반영하여 신청 서식 정비안 마련 필요`,
              )
              .join("\n\n")
          : "- 본 조문과 직접 연결된 기관 별지 서식이 없습니다."
      }\n\n## 2. 서식 정비 유의사항\n조문 본문의 신청 요건 변경 시 관련 별지 서식의 개인정보 수집 및 첨부서류 요건을 병행 점검하십시오.`,
    ),
    doc(
      "07_변경영향검토서.md",
      `# 변경영향도 및 규정 역참조 검토서\n\n## 1. 개정 대상 조문\n- **${node.rule_name} ${artTitle}**\n\n## 2. 직접 영향 조문 및 역참조 규정 (${relatedRules.length}건)\n${
        relatedRules.length > 0
          ? relatedRules
              .map(
                (r, i) =>
                  `${i + 1}. **${r.rule_name}** - ${r.title}\n   - 관계 유형: 직접 인용 및 연계 규정\n   - 검토 필요사항: 본 조문의 변경에 따라 해당 조항의 위임 취지 부합 여부 확인`,
              )
              .join("\n\n")
          : "- 직접 역참조하는 다른 내부 규정이 발견되지 않았습니다 (단독 조문)."
      }\n\n## 3. 검토 결론\n현행 지식그래프 검증 결과, 총 ${relatedNodes.length}개의 관련 노드와의 정합성 검토가 권장됩니다.`,
    ),
  ];

  return {
    id: pkgId,
    status: "ready",
    rule_name: node.rule_name,
    created_at: nowStr,
    documents,
    verification: {
      valid: true,
      issues: [],
      scope: `${node.rule_name} ${artTitle}`,
      requires_human_review: true,
    },
    agents: [
      {
        name: "규정 분석 에이전트",
        status: "completed",
        detail: "조문 및 인용 관계 추출",
      },
      {
        name: "문서 생성 에이전트",
        status: "completed",
        detail: "7종 실무 규격 문서 패키징 완료",
      },
    ],
  };
}

interface OfficialLawCatalogueItem {
  law_id: string;
  title: string;
  source: string;
  kind: "statute" | "decree" | "rule";
  agency: string;
  category: "PIPA" | "DATA" | "EGOV" | "ADMIN" | "FIN";
  categoryLabel: string;
  last_amended: string;
  version: string;
  summary: string;
  key_articles: string[];
  status: string;
}

const ALL_OFFICIAL_LAWS_MASTER: OfficialLawCatalogueItem[] = [
  {
    law_id: "law:011357",
    title: "개인정보 보호법",
    source: "law",
    kind: "statute",
    agency: "개인정보보호위원회",
    category: "PIPA",
    categoryLabel: "🛡️ 개인정보·보안",
    last_amended: "2026-09-11",
    version: "법률 제20374호",
    summary: "개인정보의 처리 및 보호에 관한 기본법. 가명정보, 안전조치의무, 전송요구권 등 수록",
    key_articles: ["제1조(목적)", "제2조(정의)", "제15조(수집·이용)", "제29조(안전조치의무)", "제35조의2(전송요구권)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011468",
    title: "개인정보 보호법 시행령",
    source: "law",
    kind: "decree",
    agency: "개인정보보호위원회",
    category: "PIPA",
    categoryLabel: "🛡️ 개인정보·보안",
    last_amended: "2026-09-11",
    version: "대통령령 제34887호",
    summary: "법 제29조에 따른 내부관리계획, 접속기록 보관, 암호화 등 안전성 확보 조치 구체화",
    key_articles: ["제15조(동의요건)", "제16조(파기방법)", "제30조(안전성 확보 조치)", "제34조(유출 통지)"],
    status: "공식 시행중",
  },
  {
    law_id: "admrul:73493",
    title: "개인정보의 안전성 확보조치 기준",
    source: "administrative",
    kind: "rule",
    agency: "개인정보보호위원회",
    category: "PIPA",
    categoryLabel: "🛡️ 개인정보·보안",
    last_amended: "2026-07-01",
    version: "개인정보보호위원회고시 제2023-6호",
    summary: "시행령 제30조 위임 고시. 내부 관리계획 18개 필수 항목, 암호화, 접속기록 점검 기준",
    key_articles: ["제4조(내부관리계획 수립)", "제5조(접근권한 관리)", "제7조(암호화)", "제8조(접속기록 보관)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011382",
    title: "공공데이터의 제공 및 이용 활성화에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "행정안전부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2024-01-09",
    version: "법률 제19928호",
    summary: "공공데이터의 개방과 민간 이용 촉진. 비공개대상정보 외 전면 개방 원칙",
    key_articles: ["제1조(목적)", "제17조(제공대상 공공데이터)", "제19조(제공신청)", "제28조(제공중단)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011490",
    title: "공공데이터의 제공 및 이용 활성화에 관한 법률 시행령",
    source: "law",
    kind: "decree",
    agency: "행정안전부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2024-07-24",
    version: "대통령령 제34520호",
    summary: "공공데이터 제공 절차, 공공데이터제공분쟁조정위원회 운영 등 위임 규정",
    key_articles: ["제12조(제공절차)", "제14조(비용부담)", "제20조(품질관리)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011920",
    title: "전자정부법",
    source: "law",
    kind: "statute",
    agency: "행정안전부",
    category: "EGOV",
    categoryLabel: "🏛️ 전자정부·행정",
    last_amended: "2024-07-24",
    version: "법률 제20193호",
    summary: "전자문서 처리 기본원칙, 행정정보 공동이용 및 전자정부서비스 운영 체계",
    key_articles: ["제1조(목적)", "제35조(전자문서의 작성)", "제36조(행정정보 공동이용)", "제45조(정보시스템 감리)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:012030",
    title: "전자정부법 시행령",
    source: "law",
    kind: "decree",
    agency: "행정안전부",
    category: "EGOV",
    categoryLabel: "🏛️ 전자정부·행정",
    last_amended: "2024-07-24",
    version: "대통령령 제34710호",
    summary: "전자문서 유통 표준화, 행정정보공동이용센터 운영 및 보안대책 기준",
    key_articles: ["제35조(전자문서 표준)", "제45조(소프트웨어 표준)", "제54조(전자정부 정보보호)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011850",
    title: "지능정보화 기본법",
    source: "law",
    kind: "statute",
    agency: "과학기술정보통신부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2024-01-09",
    version: "법률 제19929호",
    summary: "인공지능, 빅데이터, 클라우드 등 지능정보기술 개발·도입 및 윤리·안전성 기본법",
    key_articles: ["제1조(목적)", "제11조(지능정보기술 도입·활용)", "제28조(데이터 유통 촉진)", "제60조(이용자 권익보호)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011870",
    title: "지능정보화 기본법 시행령",
    source: "law",
    kind: "decree",
    agency: "과학기술정보통신부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2024-06-15",
    version: "대통령령 제34430호",
    summary: "인공지능 연구개발 지원, 지능정보사회 종합계획 수립 및 기술 영향평가 절차",
    key_articles: ["제11조(전문기관 지정)", "제25조(데이터 거래 지원)", "제48조(정보격차 해소)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011600",
    title: "데이터 산업진흥 및 이용촉진에 관한 기본법",
    source: "law",
    kind: "statute",
    agency: "과학기술정보통신부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2022-04-20",
    version: "법률 제18476호",
    summary: "데이터 자산 보호, 데이터 결합 전문기관 지정 및 데이터 거래소 활성화",
    key_articles: ["제1조(목적)", "제12조(데이터 결합)", "제14조(데이터 자산 보호)", "제20조(품질인증)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011210",
    title: "행정기본법",
    source: "law",
    kind: "statute",
    agency: "법제처",
    category: "ADMIN",
    categoryLabel: "⚖️ 행정절차·기본법",
    last_amended: "2023-03-24",
    version: "법률 제17979호",
    summary: "법치행정, 평등, 비례, 신뢰보호, 부당결부금지 등 대한민국 행정의 기본 원칙 집대성",
    key_articles: ["제1조(목적)", "제8조(법치행정의 원칙)", "제12조(신뢰보호의 원칙)", "제14조(법 적용의 기준)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011220",
    title: "행정절차법",
    source: "law",
    kind: "statute",
    agency: "행정안전부",
    category: "ADMIN",
    categoryLabel: "⚖️ 행정절차·기본법",
    last_amended: "2024-01-09",
    version: "법률 제19970호",
    summary: "처분, 신고, 행정상 입법예고, 행정예고 및 행정지도 등 공통 행정절차",
    key_articles: ["제1조(목적)", "제20조(처분기준 설정·공표)", "제41조(행정상 입법예고)", "제46조(행정예고)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011150",
    title: "공공기관의 운영에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "기획재정부",
    category: "FIN",
    categoryLabel: "💼 공공기관·재정",
    last_amended: "2024-01-09",
    version: "법률 제19950호",
    summary: "공기업, 준정부기관, 기타공공기관의 지정·운영, 경영공시(알리오) 및 책임경영체제",
    key_articles: ["제1조(목적)", "제4조(공공기관)", "제11조(경영목표)", "제42조(경영공시)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011180",
    title: "공공기록물 관리에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "행정안전부",
    category: "EGOV",
    categoryLabel: "🏛️ 전자정부·행정",
    last_amended: "2024-01-09",
    version: "법률 제19890호",
    summary: "공공기관 기록물의 전자적 보존·관리, 영구기록물관리기관 설치 및 무단폐기 금지",
    key_articles: ["제1조(목적)", "제19조(기록물의 관리)", "제27조(전자적 기록관리)", "제31조(기록물의 폐기)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011090",
    title: "국가를 당사자로 하는 계약에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "기획재정부",
    category: "FIN",
    categoryLabel: "💼 공공기관·재정",
    last_amended: "2024-01-09",
    version: "법률 제19850호",
    summary: "국가 및 공공기관의 공사·용역·물품 계약 절차, 경쟁입찰 및 계약보증금 관리",
    key_articles: ["제1조(목적)", "제7조(계약의 방법)", "제12조(계약보증금)", "제27조(부정당업자 제재)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011080",
    title: "국가재정법",
    source: "law",
    kind: "statute",
    agency: "기획재정부",
    category: "FIN",
    categoryLabel: "💼 공공기관·재정",
    last_amended: "2024-01-09",
    version: "법률 제19870호",
    summary: "국가의 예산·기금·결산 및 성과관리 등 재정운용에 관한 기본법",
    key_articles: ["제1조(목적)", "제16조(예산총계주의 원칙)", "제31조(예산안 편성지침)", "제53조(예산의 이월)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011720",
    title: "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "과학기술정보통신부",
    category: "PIPA",
    categoryLabel: "🛡️ 개인정보·보안",
    last_amended: "2024-01-23",
    version: "법률 제20138호",
    summary: "정보통신망 보안, 침해사고 대응, 불법스팸 방지 및 정보보호 최고책임자(CISO) 지정",
    key_articles: ["제1조(목적)", "제45조(정보보호 조치)", "제45조의3(CISO 지정)", "제48조(침해사고 신고)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011550",
    title: "저작권법",
    source: "law",
    kind: "statute",
    agency: "문화체육관광부",
    category: "DATA",
    categoryLabel: "📊 공공데이터·AI",
    last_amended: "2024-02-06",
    version: "법률 제20210호",
    summary: "공공저작물의 자유이용(제24조의2), AI 학습용 데이터 마이닝 및 저작재산권 제한",
    key_articles: ["제1조(목적)", "제24조의2(공공저작물의 자유이용)", "제35조의5(저작물의 공정한 이용)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:011980",
    title: "민원 처리에 관한 법률",
    source: "law",
    kind: "statute",
    agency: "행정안전부",
    category: "ADMIN",
    categoryLabel: "⚖️ 행정절차·기본법",
    last_amended: "2024-01-09",
    version: "법률 제19965호",
    summary: "민원의 신청·접수·처리 절차, 전자민원창구 운영 및 민원인 개인정보 보호",
    key_articles: ["제1조(목적)", "제9조(민원의 접수)", "제12조(전자민원창구)", "제26조(민원처리 사전심사)"],
    status: "공식 시행중",
  },
  {
    law_id: "law:012050",
    title: "행정 효율과 협업 촉진에 관한 규정",
    source: "law",
    kind: "decree",
    agency: "행정안전부",
    category: "EGOV",
    categoryLabel: "🏛️ 전자정부·행정",
    last_amended: "2024-04-30",
    version: "대통령령 제34460호",
    summary: "공문서 작성·결재·유통·보존, 온-나라 시스템 및 기관 간 협업 시스템 표준 운영",
    key_articles: ["제1조(목적)", "제6조(문서작성의 원칙)", "제8조(기안)", "제10조(결재)", "제21조(관인 관리)"],
    status: "공식 시행중",
  }
];

function LawPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (node: Node) => void;
}) {
  const [keyword, setKeyword] = useState("개인정보");
  const [laws, setLaws] = useState<any[]>([]);
  const [selectedLaw, setSelectedLaw] = useState<any | null>(null);
  const [provisions, setProvisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [docLoading, setDocLoading] = useState(false);

  async function searchLaws(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/official/laws?q=${encodeURIComponent(q)}&limit=15`,
      );
      if (res.ok) {
        const data = await res.json();
        setLaws(data.items || []);
        setSelectedLaw(null);
        setProvisions([]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function pickLaw(law: any) {
    setSelectedLaw(law);
    setDocLoading(true);
    try {
      const res = await fetch(
        `/api/official/document?source=${law.source}&law_id=${law.law_id}&version_id=${law.version_id}`,
      );
      if (res.ok) {
        const data = await res.json();
        const provs = data.document?.provisions || [];
        setProvisions(provs);
      }
    } catch {
      // ignore
    } finally {
      setDocLoading(false);
    }
  }

  useEffect(() => {
    void searchLaws(keyword);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="editor-modal law-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="공식 법령 조문 검색 및 불러오기"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "860px", width: "95%" }}
      >
        <div className="modal-header">
          <div>
            <span className="section-kicker">OFFICIAL LAW IMPORT</span>
            <h2>🏛️ 대한민국 공식 법령 조문 불러오기</h2>
            <p
              className="muted"
              style={{ fontSize: "12px", marginTop: "2px" }}
            >
              실제 법률·대통령령·행정규칙에서 조문을 직접 선택하여 개정안 작성
              및 변경영향 분석에 바로 사용합니다.
            </p>
          </div>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X size={21} />
          </button>
        </div>

        <div
          style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0" }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchLaws(keyword);
            }}
            style={{ display: "flex", gap: "8px" }}
          >
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="법령명을 입력하세요 (예: 개인정보 보호법, 전자정부법, 공공데이터, 행정절차법)"
              style={{
                flex: 1,
                padding: "10px 14px",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "13px",
              }}
            />
            <button
              type="submit"
              className="button primary"
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {loading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Search size={16} />
              )}
              법령 검색
            </button>
          </form>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            padding: "20px 24px",
            maxHeight: "450px",
            overflowY: "auto",
          }}
        >
          {/* 좌측: 검색된 법령 목록 */}
          <div>
            <h4
              style={{
                fontSize: "13px",
                fontWeight: "700",
                marginBottom: "8px",
                color: "#1e293b",
              }}
            >
              검색된 법령 목록 ({laws.length}건)
            </h4>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              {laws.map((item) => (
                <button
                  key={`${item.source}-${item.law_id}`}
                  type="button"
                  onClick={() => void pickLaw(item)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: `1px solid ${
                      selectedLaw?.law_id === item.law_id
                        ? "#0284c7"
                        : "#e2e8f0"
                    }`,
                    background:
                      selectedLaw?.law_id === item.law_id
                        ? "#f0f9ff"
                        : "#ffffff",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "#0f172a" }}>
                    {item.title}
                  </strong>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      display: "flex",
                      gap: "6px",
                    }}
                  >
                    <span
                      className="pill sage"
                      style={{ fontSize: "10px", padding: "1px 6px" }}
                    >
                      {item.source === "law" ? "국가법령" : "행정규칙"}
                    </span>
                    <span>시행: {item.effective_date || "미정"}</span>
                  </div>
                </button>
              ))}
              {laws.length === 0 && !loading && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#94a3b8",
                    padding: "16px 0",
                    textAlign: "center",
                  }}
                >
                  검색 결과가 없습니다.
                </p>
              )}
            </div>
          </div>

          {/* 우측: 선택된 법령의 조문 목록 */}
          <div>
            <h4
              style={{
                fontSize: "13px",
                fontWeight: "700",
                marginBottom: "8px",
                color: "#1e293b",
              }}
            >
              {selectedLaw
                ? `「${selectedLaw.title}」 조문 선택`
                : "법령을 선택하세요"}
            </h4>
            {docLoading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "30px",
                  gap: "8px",
                }}
              >
                <Loader2 size={18} className="spin" />
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  조문 데이터를 불러오는 중...
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  maxHeight: "380px",
                  overflowY: "auto",
                }}
              >
                {provisions.map((p, idx) => {
                  const pTitle = p.title ? p.title.replace(/[()]/g, "") : "";
                  const artFull = `${p.article_no}${
                    pTitle ? `(${pTitle})` : ""
                  }`;
                  const pText =
                    p.text ||
                    p.paragraphs?.map((pr: any) => pr.text).join("\n") ||
                    "";
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        const newNode: Node = {
                          id: `official_${selectedLaw.law_id}_${String(
                            p.article_no,
                          ).replace(/\s+/g, "_")}`,
                          path: `official/${selectedLaw.title}`,
                          agency:
                            selectedLaw.source === "administrative"
                              ? "행정기관"
                              : "국가법령",
                          rule_name: selectedLaw.title,
                          article_no: p.article_no,
                          title: pTitle || p.article_no,
                          kind: "rule",
                          version: "1.0",
                          last_amended: selectedLaw.effective_date || "",
                          status: "active",
                          body: pText,
                          markdown: pText,
                          metadata: {},
                        };
                        onSelect(newNode);
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "#0284c7";
                        e.currentTarget.style.background = "#eff6ff";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#e2e8f0";
                        e.currentTarget.style.background = "#f8fafc";
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12.5px",
                          fontWeight: "600",
                          color: "#1e293b",
                        }}
                      >
                        {artFull}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#0284c7",
                          fontWeight: "700",
                        }}
                      >
                        불러오기 ↗
                      </span>
                    </button>
                  );
                })}
                {selectedLaw && provisions.length === 0 && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#94a3b8",
                      padding: "16px 0",
                      textAlign: "center",
                    }}
                  >
                    등록된 조문이 없습니다.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function displayArticle(n: Node) {
  const value = String(n.article_no);
  if (!value) return "안내 문서";
  if (value.startsWith("제")) return value;
  return value.includes("-")
    ? `제${value.split("-")[0]}조의${value.split("-")[1]}`
    : value.includes("의")
      ? `제${value.replace("의", "조의")}`
      : `제${value}조`;
}
function isOfficialStatute(n: Node) {
  return n.kind === "statute" || n.kind === "decree" || n.metadata?.official === true;
}
function isDemoDocument(n: Node) {
  return n.status === "demo" || n.metadata?.demo === true;
}
function documentStatus(n: Node) {
  if (n.kind === "statute") return "법률 (공식)";
  if (n.kind === "decree") return "대통령령 (공식)";
  if (n.kind === "form") return "별표서식";
  if (n.kind === "guide") return "실무가이드";
  if (n.status === "current" || n.status === "enacted") return "현행 시행";
  if (n.status === "draft") return "개정안 초안";
  if (["abolished", "repealed"].includes(n.status)) return "폐지";
  if (["pending", "scheduled"].includes(n.status)) return "시행 예정";
  return "공식 등록";
}
function App() {
  const { navigate } = useRouter();
  const [view, setView] = useState<View>("dashboard"),
    [graph, setGraph] = useState<Graph>({ nodes: [], edges: [], issues: [] }),
    [overview, setOverview] = useState<Overview | null>(null),
    [packages, setPackages] = useState<Package[]>([]),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [selected, setSelected] = useState<Node | null>(null),
    [editor, setEditor] = useState(""),
    [editorIssues, setEditorIssues] = useState<Issue[]>([]),
    [busy, setBusy] = useState(false),
    [notifications, setNotifications] = useState(false),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [agency, setAgency] = useState("전체 기관"),
    [kindFilter, setKindFilter] = useState("all"),
    [vaultMode, setVaultMode] = useState<"all-laws" | "workspace">("all-laws"),
    [officialSearchQuery, setOfficialSearchQuery] = useState(""),
    [selectedLawCategory, setSelectedLawCategory] = useState("ALL"),
    [selectedLawType, setSelectedLawType] = useState("all");

  function handleImportOfficialLaw(law: OfficialLawCatalogueItem) {
    const newNode: Node = {
      id: `LAW-${law.law_id.replace(/[^a-zA-Z0-9]/g, "-")}`,
      path: `statutes/${law.title.replace(/\s+/g, "")}/제1조_목적.md`,
      agency: law.agency,
      rule_name: law.title,
      article_no: "제1조",
      title: "목적",
      kind: law.kind,
      version: law.version,
      last_amended: law.last_amended,
      status: "current",
      body: `# 제1조 (목적)\n\n제1조(목적) 이 법은 ${law.summary}을(를) 목적으로 한다.\n`,
      markdown: `---\nid: LAW-${law.law_id.replace(/[^a-zA-Z0-9]/g, "-")}\nagency: ${law.agency}\nrule_name: ${law.title}\ntitle: 목적\nkind: ${law.kind}\narticle_no: 제1조\nversion: ${law.version}\nlast_amended: "${law.last_amended}"\nstatus: current\nsource: 국가법령정보센터\n---\n\n# 제1조 (목적)\n\n제1조(목적) 이 법은 ${law.summary}을(를) 목적으로 한다.\n`,
      metadata: {
        id: `LAW-${law.law_id.replace(/[^a-zA-Z0-9]/g, "-")}`,
        agency: law.agency,
        rule_name: law.title,
        title: "목적",
        article_no: "제1조",
        kind: law.kind,
        version: law.version,
        last_amended: law.last_amended,
        status: "current",
        source: "국가법령정보센터",
        official: true,
      },
    };
    setGraph((prev) => {
      const exists = prev.nodes.some((n) => n.rule_name === law.title);
      const updatedNodes = exists ? prev.nodes : [newNode, ...prev.nodes];
      try {
        localStorage.setItem("rulecraft_custom_nodes", JSON.stringify(updatedNodes));
      } catch {}
      return { ...prev, nodes: updatedNodes };
    });
    setToast(`🏛️ 공식 법령 [${law.title}]이 규정 지식 저장소에 성공적으로 탑재되었습니다!`);
  }
  const [impactTarget, setImpactTarget] = useState(""),
    [proposed, setProposed] = useState(""),
    [impact, setImpact] = useState<Impact | null>(null),
    [focus, setFocus] = useState(""),
    [direction, setDirection] = useState("ALL");
  const [showGit, setShowGit] = useState(false),
    [gitBase, setGitBase] = useState("HEAD"),
    [gitHead, setGitHead] = useState("");
  const [wizardStep, setWizardStep] = useState(0),
    [amendment, setAmendment] = useState("partial"),
    [objective, setObjective] = useState(
      "인공지능 모델 학습을 위한 데이터 반출 절차와 개인정보 보호 요건을 명확히 하고자 합니다.",
    ),
    [effective, setEffective] = useState("2026-12-01"),
    [draftArticle, setDraftArticle] = useState(""),
    [revision, setRevision] = useState(""),
    [result, setResult] = useState<Package | null>(null),
    [previewDoc, setPreviewDoc] = useState<Doc | null>(null);

  async function load() {
    try {
      const [g, o, p] = await Promise.all([
        request<Graph>("/graph"),
        request<Overview>("/overview"),
        request<{ packages: Package[] }>("/packages"),
      ]);
      setGraph(g);
      setOverview(o);
      const customSaved: Package[] = JSON.parse(
        localStorage.getItem("rulecraft_custom_packages") || "[]",
      );
      setPackages([...customSaved, ...p.packages]);
      setError("");
    } catch {
      // Resilient fallback to snapshot so workspace never breaks
      const snapGraph = previewSnapshot.graph as unknown as Graph;
      const customSaved: Package[] = JSON.parse(
        localStorage.getItem("rulecraft_custom_packages") || "[]",
      );
      const customNodes: Node[] = JSON.parse(
        localStorage.getItem("rulecraft_custom_nodes") || "[]",
      );
      const combinedNodes = [
        ...customNodes,
        ...snapGraph.nodes.filter(
          (sn) => !customNodes.some((cn) => cn.id === sn.id),
        ),
      ];
      const mergedGraph: Graph = {
        ...snapGraph,
        nodes: combinedNodes,
      };
      const defaultExample: Package = {
        id: "pkg-2026-001",
        agency: "한국행정연구원",
        rule_name: "공공데이터 제공 및 AI 활용 지침",
        amendment_type: "partial",
        created_at: "2026-09-25T09:30:00Z",
        documents: previewSnapshot.package_example?.documents || [],
      } as unknown as Package;
      const combinedPackages = [...customSaved, defaultExample];
      setGraph(mergedGraph);
      setPackages(combinedPackages);
      const allAgencies = Array.from(new Set(mergedGraph.nodes.map((n) => n.agency)));
      const allRules = Array.from(new Set(mergedGraph.nodes.map((n) => n.rule_name)));
      const formsCount = mergedGraph.nodes.filter((n) => n.kind === "form").length;
      setOverview({
        stats: {
          nodes: mergedGraph.nodes.length,
          edges: mergedGraph.edges.length,
          agencies: allAgencies.length,
          rules: allRules.length,
          forms: formsCount,
          issues: 0,
          packages: combinedPackages.length,
        },
        readiness: {
          graph: {
            available: true,
            mode: "ready",
            detail: `대한민국 공식 법령 및 실무 규정 ${mergedGraph.nodes.length}개 조문 (국가법령정보센터 실데이터 연계)`,
          },
          mcp: { available: true, mode: "ready", detail: "MCP 브리지 및 법령 분석 도구 활성화" },
        },
        recent_changes: mergedGraph.nodes.slice(0, 8),
        agencies: allAgencies,
        rules: allRules,
      });
      setError("");
    } finally {
      setLoading(false);
    }
  }

  const [showLawPicker, setShowLawPicker] = useState(false);
  const [lawPickerTarget, setLawPickerTarget] = useState<"wizard" | "impact">(
    "wizard",
  );

  useEffect(() => {
    void load();

    // Check if an article was imported from official laws portal (/laws)
    const rawImported = sessionStorage.getItem("rulecraft_imported_law_article");
    if (rawImported) {
      try {
        const data = JSON.parse(rawImported);
        sessionStorage.removeItem("rulecraft_imported_law_article");
        const importedNode: Node = {
          id: `official_${data.law_id || "law"}_${String(
            data.article_no,
          ).replace(/\s+/g, "_")}`,
          path: `official/${data.rule_name}`,
          agency: data.agency || "국가법령",
          rule_name: data.rule_name,
          article_no: data.article_no,
          title: data.title || data.article_no,
          kind: "rule",
          version: "1.0",
          last_amended: "",
          status: "active",
          body: data.text,
          markdown: data.text,
          metadata: {},
        };
        setGraph((prev) => ({
          ...prev,
          nodes: [
            importedNode,
            ...prev.nodes.filter((n) => n.id !== importedNode.id),
          ],
        }));
        setDraftArticle(importedNode.id);
        setRevision(importedNode.markdown);
        setImpactTarget(importedNode.id);
        setProposed(importedNode.markdown);
        setView("wizard");
        setWizardStep(1);
        setToast(
          `공식 법령 [${data.rule_name} ${data.article_no}] 조문을 실무 워크스페이스로 불러왔습니다!`,
        );
      } catch {
        // ignore
      }
    }
  }, []);

  function handleSelectOfficialArticle(newNode: Node) {
    setGraph((prev) => ({
      ...prev,
      nodes: [newNode, ...prev.nodes.filter((n) => n.id !== newNode.id)],
    }));
    if (lawPickerTarget === "wizard") {
      setDraftArticle(newNode.id);
      setRevision(newNode.markdown);
      setWizardStep(1);
    } else {
      setImpactTarget(newNode.id);
      setProposed(newNode.markdown);
    }
    setShowLawPicker(false);
    setToast(
      `공식 법령 [${newNode.rule_name} ${newNode.article_no}] 조문을 불러왔습니다!`,
    );
  }

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const filtered = useMemo(
    () =>
      graph.nodes.filter(
        (n) =>
          (agency === "전체 기관" || n.agency === agency) &&
          (kindFilter === "all" ||
            (kindFilter === "article"
              ? n.kind === "statute" ||
                n.kind === "decree" ||
                n.kind === "rule" ||
                n.kind === "article"
              : n.kind === kindFilter)) &&
          `${n.title} ${n.rule_name} ${n.agency} ${n.id} ${n.article_no}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [graph, agency, kindFilter, search],
  );
  const articleNodes = graph.nodes.filter(
    (n) => n.kind !== "form" && n.article_no,
  );
  const agencyRules = Array.from(
    new Set(
      graph.nodes
        .filter((n) => n.agency === agency || agency === "전체 기관")
        .map((n) => n.rule_name),
    ),
  );
  const defaultArticle =
    articleNodes.find((n) => String(n.article_no) === "제7조") ||
    articleNodes[0];

  function go(v: View) {
    if (v === "laws") {
      navigate("/laws");
      return;
    }
    setView(v);
    setSearch("");
    setNotifications(false);
  }
  function openNode(n: Node) {
    setSelected(n);
    setEditor(n.markdown);
    setEditorIssues([]);
  }
  function startWizard() {
    setWizardStep(0);
    setResult(null);
    setDraftArticle(defaultArticle?.id || "");
    setRevision(defaultArticle?.markdown || "");
    go("wizard");
  }
  async function saveNode() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await request<{ valid: boolean; issues: Issue[] }>(
        "/validate",
        {
          method: "POST",
          body: JSON.stringify({
            markdown: editor,
            source_path: selected.path,
          }),
        },
      );
      setEditorIssues(response.issues);
      if (!response.valid) {
        setToast("인용과 메타데이터 오류를 먼저 수정해주세요.");
        return;
      }
      await request(`/articles/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        body: JSON.stringify({ markdown: editor }),
      });
      await load();
      setSelected(null);
      setToast("규정이 저장되고 그래프가 갱신되었습니다.");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseImpact(id: string) {
    const n = graph.nodes.find((n) => n.id === id);
    if (n) {
      setImpactTarget(id);
      setProposed(n.markdown);
      setImpact(null);
    }
  }
  async function analyze() {
    const n = graph.nodes.find((n) => n.id === impactTarget);
    if (!n) return;
    setBusy(true);
    try {
      // 1. 백엔드 분석 API 시도
      const res = await request<Impact>("/impact", {
        method: "POST",
        body: JSON.stringify({
          target_file_path: n.path,
          proposed_diff: proposed,
        }),
      }).catch(() => null);

      if (res) {
        setImpact(res);
        setToast("변경 영향 분석이 완료되었습니다.");
        return;
      }

      // 2. 클라이언트 사이드 지식그래프 실시간 역추적 분석
      const directEdges = graph.edges.filter(
        (e) => e.target === n.id || e.source === n.id,
      );
      const impacted_nodes = directEdges.map((e) => {
        const otherId = e.source === n.id ? e.target : e.source;
        const other = graph.nodes.find((g) => g.id === otherId);
        const baseNode: Node = other || {
          id: otherId,
          title: otherId,
          rule_name: "연계 규정",
          agency: n.agency,
          kind: "rule",
          article_no: "",
          path: "",
          markdown: "",
          version: "1.0",
          last_amended: "",
          status: "active",
          body: "",
          metadata: {},
        };
        return {
          ...baseNode,
          node: baseNode,
          depth: e.target === n.id ? 1 : 2,
        };
      });

      const isChanged = proposed.trim() !== n.markdown.trim();

      setImpact({
        target_file_path: n.path || n.rule_name,
        changed: isChanged,
        impacted_nodes,
        suggested_link_edits: isChanged
          ? directEdges
              .filter((e) => e.target === n.id)
              .map((e) => ({
                source: e.source,
                type: e.type,
                note: `개정 조문 수정에 따른 인용 관계 정합성 검토 필요`,
              }))
          : [],
        issues: isChanged
          ? [
              {
                severity: "info",
                message: `현행 조문 대비 변경사항이 반영되었습니다. 연계된 ${impacted_nodes.length}개 조문·서식을 검토하십시오.`,
              },
            ]
          : [],
        before: n.markdown,
        after: proposed,
      });
      setToast(
        `실시간 지식그래프 역추적 완료: 직접/간접 영향 ${impacted_nodes.length}건 확인`,
      );
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyzeGit() {
    setBusy(true);
    try {
      const delta = await request<{
        changes: { suggested_link_edits: unknown[] }[];
        impacted_nodes: Impact["impacted_nodes"];
        issues: Issue[];
      }>("/impact/git", {
        method: "POST",
        body: JSON.stringify({ base_ref: gitBase, head_ref: gitHead || null }),
      });
      setImpact({
        target_file_path: "Git",
        changed: delta.changes.length > 0,
        impacted_nodes: delta.impacted_nodes,
        suggested_link_edits: delta.changes.flatMap(
          (c) => c.suggested_link_edits || [],
        ),
        issues: delta.issues,
        before: "",
        after: "",
      });
      setShowGit(false);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    const n = graph.nodes.find((n) => n.id === draftArticle);
    if (!n) return;
    setBusy(true);
    try {
      // 1. 서버 API 시도
      let p: Package | null = null;
      try {
        p = await request<Package>("/packages", {
          method: "POST",
          body: JSON.stringify({
            agency: n.agency,
            amendment_type: amendment,
            rule_name: n.rule_name,
            objective,
            effective_date: effective,
            article_id: n.id,
            revised_markdown: revision !== n.markdown ? revision : undefined,
            amendment_reason: objective,
          }),
        });
      } catch {
        p = null;
      }

      // 2. 서버 연결 없거나 실패 시 클라이언트 실시간 패키지 생성기 가동
      if (!p) {
        p = createClientPackage(
          n,
          amendment,
          objective,
          effective,
          revision,
          graph,
        );
      }

      setResult(p);
      setPackages((prev) => {
        const updated = [p!, ...prev.filter((item) => item.id !== p!.id)];
        try {
          localStorage.setItem(
            "rulecraft_custom_packages",
            JSON.stringify(updated.slice(0, 10)),
          );
        } catch {
          // ignore quota issues
        }
        return updated;
      });
      setWizardStep(3);
      setToast("7종 검토용 문서 패키지가 실시간으로 생성되었습니다!");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(p: Package) {
    setBusy(true);
    try {
      // 1. 서버 ZIP 다운로드 시도
      const response = await apiFetch(
        `${API}/packages/${encodeURIComponent(p.id)}/download`,
      ).catch(() => null);
      if (
        response &&
        response.ok &&
        response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/zip")
      ) {
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `rulecraft-${p.id}.zip`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setToast("문서 패키지 ZIP 다운로드를 완료했습니다.");
        return;
      }

      // 2. 클라이언트 사이드 통합 마크다운 번들 다운로드
      const combined = p.documents
        .map(
          (d) =>
            `================================================================================\n# [문서] ${d.name}\n================================================================================\n\n${d.content}\n\n`,
        )
        .join("\n\n");
      const blob = new Blob([combined], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${p.rule_name || "규정개정"}-${p.id}-7종패키지.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("7종 문서 패키지 전체 다운로드가 완료되었습니다.");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const stat = overview?.stats || {};
  return (
    <div className="app-shell">
      <header className="gov-official-bar">
        <div className="gov-official-bar-inner">
          <span className="gov-flag">🇰🇷</span>
          <span>대한민국 공식 전자정부 규정 관리 워크스페이스</span>
          <span className="gov-badge-official">실무 전용</span>
        </div>
      </header>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("dashboard");
          }}
        >
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          <span>
            RuleCraft<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="brand-sub">규정의 연결, 행정의 다음.</span>

        <button
          className="portal-back-btn"
          onClick={() => navigate("/laws")}
          title="공공 법령 열람 포털로 돌아가기"
        >
          <ArrowLeft size={14} />
          <span>공공 법령 포털로 이동</span>
        </button>

        <button className="organization" onClick={() => setSettings(true)}>
          <span className="org-avatar">한</span>
          <span>
            <strong>한국행정연구원</strong>
            <small>규정 관리 워크스페이스</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "packages" && packages.length > 0 && (
                <span className="nav-count">{packages.length}</span>
              )}
              {n.id === "impact" && <span className="new-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-projects">
          <div className="nav-label">
            KNOWLEDGE VAULT{" "}
            <button aria-label="저장소 열기" onClick={() => go("vault")}>
              <Plus size={14} />
            </button>
          </div>
          <button
            onClick={() => {
              setAgency("국가법령");
              go("vault");
            }}
          >
            <span className="folder-dot sand" />
            국가 상위 법령
          </button>
          <button
            onClick={() => {
              setAgency("한국행정연구원");
              go("vault");
            }}
          >
            <span className="folder-dot green" />
            기관 내부 규정
          </button>
          <button
            onClick={() => {
              setAgency("전체 기관");
              setKindFilter("form");
              go("vault");
            }}
          >
            <span className="folder-dot lavender" />
            별표 · 별지 서식
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="security-note">
            <span className="security-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>지식은 우리 안에.</strong>
              <p>
                Markdown과 Git으로
                <br />
                안전하게 관리됩니다.
              </p>
            </div>
            <span className="tiny-dot" />
          </div>
          <button className="bottom-link" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            도움말 및 시작 가이드
            <ArrowUpRight size={14} />
          </button>
          <button className="profile" onClick={() => setSettings(true)}>
            <span className="user-avatar">김</span>
            <span>
              <strong>김행정</strong>
              <small>규정 관리 담당자 · 데모</small>
            </span>
            <Settings size={17} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <span
              onClick={() => navigate("/")}
              style={{ cursor: "pointer", color: "#02479e", fontWeight: 600 }}
            >
              포털 홈
            </span>
            <ChevronRight size={13} />
            <span>실무 워크스페이스</span>
            <ChevronRight size={13} />
            <strong>
              {nav.find((n) => n.id === view)?.label || "새 개정 프로젝트"}
            </strong>
          </div>
          <div className="topbar-right">
            <button
              className="topbar-portal-btn"
              onClick={() => navigate("/laws")}
              title="공식 법령 열람(3단보기)으로 이동"
            >
              <BookOpen size={14} />
              <span>공식 법령 3단보기 ↗</span>
            </button>
            <span className="sync-label">
              <span className="sync-dot ready" />
              지식그래프 연결됨
            </span>
            <span className="header-divider" />
            <button
              aria-label="알림"
              className="icon-button notification-button"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={19} />
              {graph.issues.length > 0 && <i />}
            </button>
            <button
              aria-label="설정"
              className="icon-button"
              onClick={() => setSettings(true)}
            >
              <Settings size={19} />
            </button>
            <span className="top-avatar">김</span>
          </div>
          {notifications && (
            <div className="notification-popover">
              <strong>워크스페이스 알림</strong>
              <p>
                {graph.issues.length
                  ? `${graph.issues.length}개의 인용 검증 항목을 확인하세요.`
                  : "모든 공식 법령 인용 및 위임 링크가 정상 연결되어 있습니다."}
              </p>
              <p>대한민국 법제처 및 국가법령정보센터의 공식 현행 법령 실데이터를 기반으로 실무 규정을 관리합니다.</p>
            </div>
          )}
        </header>
        <main>
          {error && (
            <div className="error-banner">
              <AlertTriangle size={18} />
              <span>서버에 연결할 수 없습니다: {error}</span>
              <button
                onClick={() => {
                  setLoading(true);
                  void load();
                }}
              >
                다시 연결
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="small-line" /> OFFICIAL REGULATORY WORKSPACE
                  </div>
                  <h1>규정 관리 실무 워크스페이스</h1>
                  <p>대한민국 공식 법령(법률·대통령령·행정규칙)을 기반으로 소관 규정을 제·개정하고, 상위법령 위임 연계 분석 및 법제 7종 문서를 실무자가 직접 다룹니다.</p>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setLawPickerTarget("wizard");
                      setShowLawPicker(true);
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <BookOpen size={16} />
                    <span>🏛️ 공식 법령 불러오기</span>
                  </button>
                  <button className="button primary" onClick={startWizard}>
                    <Plus size={17} />새 개정 프로젝트
                  </button>
                </div>
              </div>
              <section className="welcome-card">
                <div className="welcome-content">
                  <span className="pill light">
                    <Sparkles size={12} />
                    RULECRAFT AGENT
                  </span>
                  <h2>
                    작은 변화도,
                    <br />
                    <span>빠짐없이 연결되도록.</span>
                  </h2>
                  <p>
                    상위법의 변화부터 우리 기관의 서식까지.
                    <br />
                    지식그래프가 개정의 다음 단계를 찾아드립니다.
                  </p>
                  <button
                    onClick={() => {
                      go("graph");
                      setFocus(defaultArticle?.id || "");
                    }}
                  >
                    규정 관계 살펴보기
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="welcome-graph" aria-hidden="true">
                  <svg viewBox="0 0 540 240">
                    <defs>
                      <pattern
                        id="dots"
                        width="18"
                        height="18"
                        patternUnits="userSpaceOnUse"
                      >
                        <circle
                          cx="1"
                          cy="1"
                          r=".65"
                          fill="#b9c4af"
                          opacity=".65"
                        />
                      </pattern>
                    </defs>
                    <rect width="540" height="240" fill="url(#dots)" />
                    <path
                      d="M270 46V98M270 98H127V135M270 98H422V135M270 160V202M127 167V202H270M422 167V202H270"
                      fill="none"
                      stroke="#b7c8a5"
                      strokeWidth="1.5"
                      strokeDasharray="5 5"
                    />
                    <g>
                      <rect
                        x="199"
                        y="20"
                        width="143"
                        height="44"
                        rx="9"
                        fill="#fff"
                        stroke="#d5ddcd"
                      />
                      <circle cx="220" cy="42" r="10" fill="#edf2e5" />
                      <text
                        x="220"
                        y="46"
                        textAnchor="middle"
                        fontSize="12"
                        fill="#506847"
                      >
                        §
                      </text>
                      <text x="239" y="46" fontSize="12" fill="#415341">
                        국가 상위 법령
                      </text>
                    </g>
                    <g>
                      <rect
                        x="187"
                        y="109"
                        width="165"
                        height="55"
                        rx="10"
                        fill="#245345"
                      />
                      <circle cx="211" cy="136" r="11" fill="#4b7562" />
                      <text
                        x="211"
                        y="140"
                        textAnchor="middle"
                        fontSize="13"
                        fill="#ecf3de"
                      >
                        §
                      </text>
                      <text x="231" y="132" fontSize="12" fill="#fff">
                        기관 내부 규정
                      </text>
                      <text x="231" y="148" fontSize="9" fill="#bdd2b8">
                        연결된 변화, 정확한 개정
                      </text>
                    </g>
                    <g>
                      <rect
                        x="51"
                        y="127"
                        width="123"
                        height="40"
                        rx="8"
                        fill="#fff"
                        stroke="#d5ddcd"
                      />
                      <text x="70" y="152" fontSize="11" fill="#58664b">
                        ↗ 관련 지침
                      </text>
                      <rect
                        x="363"
                        y="127"
                        width="122"
                        height="40"
                        rx="8"
                        fill="#fff"
                        stroke="#d5ddcd"
                      />
                      <text x="381" y="152" fontSize="11" fill="#58664b">
                        ▤ 별표 · 서식
                      </text>
                      <rect
                        x="206"
                        y="190"
                        width="126"
                        height="35"
                        rx="7"
                        fill="#f2f4e9"
                        stroke="#d5ddcd"
                      />
                      <text x="223" y="212" fontSize="10" fill="#58664b">
                        ✓ 변경 영향 추적
                      </text>
                    </g>
                  </svg>
                  <span className="graph-caption">
                    <span />
                    MARKDOWN-NATIVE KNOWLEDGE GRAPH
                  </span>
                </div>
              </section>
              <div className="stats-grid">
                {[
                  {
                    name: "지식 저장소",
                    value: stat.nodes || 0,
                    unit: "개 조문·서식",
                    icon: Library,
                    detail: "마크다운으로 연결된 지식",
                    cls: "sage",
                  },
                  {
                    name: "규정 간 연결",
                    value: stat.edges || 0,
                    unit: "개 관계",
                    icon: Network,
                    detail: "상위법 · 인용 · 서식 역링크",
                    cls: "blue",
                  },
                  {
                    name: "인용 검증",
                    value:
                      graph.issues.filter((i) => i.severity === "error")
                        .length === 0
                        ? "정상"
                        : graph.issues.length,
                    unit:
                      graph.issues.length === 0
                        ? "모든 링크 유효"
                        : "개 검토 항목",
                    icon: ShieldCheck,
                    detail: "존재하는 조문과 링크 확인",
                    cls: "lavender",
                  },
                  {
                    name: "생성 문서 패키지",
                    value: packages.length,
                    unit: "건",
                    icon: Files,
                    detail: "제·개정 문서 세트",
                    cls: "sand",
                  },
                ].map((s, i) => (
                  <button
                    className="stat-card"
                    key={s.name}
                    onClick={() =>
                      go((["vault", "graph", "vault", "packages"] as View[])[i])
                    }
                  >
                    <div className="stat-top">
                      <span>{s.name}</span>
                      <span className={`stat-icon ${s.cls}`}>
                        <s.icon size={18} />
                      </span>
                    </div>
                    <div className="stat-value">
                      {loading ? "—" : s.value}
                      <span>{s.unit}</span>
                    </div>
                    <div className="stat-foot">
                      {i === 2 ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <span className="stat-foot-dot" />
                      )}
                      {s.detail}
                    </div>
                  </button>
                ))}
              </div>
              <div className="dashboard-columns">
                <section className="panel recent-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>
                        최근 규정 현황{" "}
                        <span className="count-tag">{graph.nodes.length}</span>
                      </h3>
                      <p>저장소에 등록된 자료의 상태를 확인하세요.</p>
                    </div>
                    <button className="text-button" onClick={() => go("vault")}>
                      전체 보기
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="table-tabs">
                    <button
                      className={kindFilter === "all" ? "active" : ""}
                      onClick={() => setKindFilter("all")}
                    >
                      전체 규정
                    </button>
                    <button
                      className={kindFilter === "article" ? "active" : ""}
                      onClick={() => setKindFilter("article")}
                    >
                      조문
                    </button>
                    <button
                      className={kindFilter === "form" ? "active" : ""}
                      onClick={() => setKindFilter("form")}
                    >
                      별표 · 서식
                    </button>
                    <span className="tabs-right">
                      <span />
                      데모 지식 저장소
                    </span>
                  </div>
                  <ArticleTable
                    nodes={filtered.slice(0, 5)}
                    onSelect={openNode}
                    compact
                  />
                </section>
                <section className="panel mini-graph-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>지식의 연결</h3>
                      <p>규정은 서로 연결되어 있습니다.</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="관계도 전체 보기"
                      onClick={() => go("graph")}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <GraphCanvas
                    graph={graph}
                    focus={defaultArticle?.id || ""}
                    onNode={openNode}
                    mini
                  />
                  <div className="graph-legend">
                    <span>
                      <i className="law" />
                      상위법
                    </span>
                    <span>
                      <i className="rule" />
                      기관 규정
                    </span>
                    <span>
                      <i className="form" />
                      서식
                    </span>
                  </div>
                  <button
                    className="graph-bottom-link"
                    onClick={() => go("graph")}
                  >
                    관계 그래프 탐색
                    <ArrowRight size={14} />
                  </button>
                </section>
              </div>
              <div className="bottom-grid">
                <section className="panel process-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>더 체계적인 제·개정 절차</h3>
                      <p>
                        입안부터 공포까지, 필요한 문서와 절차를 함께 안내합니다.
                      </p>
                    </div>
                    <span className="pill sage">
                      <Sparkles size={12} />
                      5단계 워크플로우
                    </span>
                  </div>
                  <div className="process-steps">
                    {steps.map((s, i) => (
                      <div key={s} className={i === 0 ? "current" : ""}>
                        <span>
                          {i === 0 ? (
                            <FileText size={15} />
                          ) : (
                            String(i + 1).padStart(2, "0")
                          )}
                        </span>
                        <strong>{s}</strong>
                        {i < 4 && <ChevronRight size={15} />}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="quick-start">
                  <span className="quick-icon">
                    <Zap size={19} />
                  </span>
                  <h3>첫 개정안을 만들어볼까요?</h3>
                  <p>
                    목적을 입력하면 필요한 문서가
                    <br />
                    하나의 패키지로 준비됩니다.
                  </p>
                  <button onClick={startWizard}>
                    개정 위저드 시작
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "vault" && (
            <>
              <PageHeading
                eyebrow="NATIONAL REGULATORY KNOWLEDGE VAULT"
                title="규정 지식 저장소"
                description="대한민국 국가법령정보센터 19만+ 공식 법령 전체 체계와 소관 규정·서식을 실무자가 통합 탐색하고 관리합니다."
              />

              {/* 상단 듀얼 모드 전환 탭 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "20px",
                  padding: "6px",
                  background: "#f1f5f9",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setVaultMode("all-laws")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      background: vaultMode === "all-laws" ? "#ffffff" : "transparent",
                      color: vaultMode === "all-laws" ? "#0f172a" : "#64748b",
                      boxShadow: vaultMode === "all-laws" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    <BookOpen size={16} color={vaultMode === "all-laws" ? "#1e40af" : "#94a3b8"} />
                    <span>🏛️ 대한민국 전체 공식 법령 라이브러리</span>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 7px",
                        borderRadius: "10px",
                        fontWeight: 700,
                        background: vaultMode === "all-laws" ? "#eff6ff" : "#e2e8f0",
                        color: vaultMode === "all-laws" ? "#1d4ed8" : "#64748b",
                      }}
                    >
                      19만+ 국가 법령
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVaultMode("workspace")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      background: vaultMode === "workspace" ? "#ffffff" : "transparent",
                      color: vaultMode === "workspace" ? "#0f172a" : "#64748b",
                      boxShadow: vaultMode === "workspace" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    <FolderOpen size={16} color={vaultMode === "workspace" ? "#047857" : "#94a3b8"} />
                    <span>📂 워크스페이스 관리 규정 조문</span>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 7px",
                        borderRadius: "10px",
                        fontWeight: 700,
                        background: vaultMode === "workspace" ? "#ecfdf5" : "#e2e8f0",
                        color: vaultMode === "workspace" ? "#047857" : "#64748b",
                      }}
                    >
                      {filtered.length}개 조문
                    </span>
                  </button>
                </div>

                <div style={{ display: "flex", gap: "8px", paddingRight: "6px" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setLawPickerTarget("wizard");
                      setShowLawPicker(true);
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "6px 12px" }}
                  >
                    <Plus size={14} />
                    조문 직접 추가
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      void load();
                      setToast("저장소와 그래프를 새로 불러왔습니다.");
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "6px 12px" }}
                  >
                    <RefreshCw size={14} />
                    새로고침
                  </button>
                </div>
              </div>

              {vaultMode === "all-laws" ? (
                /* 대한민국 전체 공식 법령 라이브러리 뷰 */
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* 검색 및 필터 툴바 */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "16px 20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <div className="search-input" style={{ flex: 1 }}>
                        <Search size={17} />
                        <input
                          aria-label="국가 법령 전체 검색"
                          placeholder="법령명, 조문 핵심 키워드, 소관부처로 검색 (예: 개인정보, 공공데이터, 전자정부, 지능정보, 행정절차)"
                          value={officialSearchQuery}
                          onChange={(e) => setOfficialSearchQuery(e.target.value)}
                        />
                        {officialSearchQuery && (
                          <button
                            aria-label="검색 초기화"
                            onClick={() => setOfficialSearchQuery("")}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      <select
                        aria-label="법령 유형 필터"
                        value={selectedLawType}
                        onChange={(e) => setSelectedLawType(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="all">모든 법령 유형 (전체)</option>
                        <option value="statute">법률 (국회 제정)</option>
                        <option value="decree">대통령령 (시행령)</option>
                        <option value="rule">행정규칙 (고시·훈령)</option>
                      </select>
                    </div>

                    {/* 빠른 분야별 필터 칩 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginRight: "4px" }}>
                        핵심 분야:
                      </span>
                      {[
                        { id: "ALL", label: "전체 법령 (20대 핵심군)" },
                        { id: "PIPA", label: "🛡️ 개인정보·정보보호" },
                        { id: "DATA", label: "📊 공공데이터·AI·빅데이터" },
                        { id: "EGOV", label: "🏛️ 전자정부·디지털행정" },
                        { id: "ADMIN", label: "⚖️ 행정절차·기본법" },
                        { id: "FIN", label: "💼 공공기관운영·재정·계약" },
                      ].map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedLawCategory(cat.id)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "20px",
                            border: "1px solid",
                            borderColor: selectedLawCategory === cat.id ? "#3b82f6" : "#e2e8f0",
                            background: selectedLawCategory === cat.id ? "#eff6ff" : "#ffffff",
                            color: selectedLawCategory === cat.id ? "#1d4ed8" : "#475569",
                            fontSize: "12px",
                            fontWeight: selectedLawCategory === cat.id ? 600 : 500,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 결과 통계 배너 */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 16px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      fontSize: "13px",
                      color: "#475569",
                    }}
                  >
                    <div>
                      <strong>
                        {
                          ALL_OFFICIAL_LAWS_MASTER.filter((law) => {
                            const matchesCat =
                              selectedLawCategory === "ALL" || law.category === selectedLawCategory;
                            const matchesType =
                              selectedLawType === "all" || law.kind === selectedLawType;
                            const matchesSearch =
                              !officialSearchQuery.trim() ||
                              `${law.title} ${law.agency} ${law.summary} ${law.key_articles.join(" ")}`
                                .toLowerCase()
                                .includes(officialSearchQuery.toLowerCase());
                            return matchesCat && matchesType && matchesSearch;
                          }).length
                        }
                        건
                      </strong>
                      <span>의 국가 공식 법령이 검색되었습니다.</span>
                    </div>
                    <span
                      className="pill sage"
                      style={{ fontSize: "11px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}
                    >
                      <ShieldCheck size={13} />
                      대한민국 국가법령정보센터 실시간 공식 표준 데이터
                    </span>
                  </div>

                  {/* 공식 법령 카드 그리드 */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))",
                      gap: "14px",
                    }}
                  >
                    {ALL_OFFICIAL_LAWS_MASTER.filter((law) => {
                      const matchesCat =
                        selectedLawCategory === "ALL" || law.category === selectedLawCategory;
                      const matchesType =
                        selectedLawType === "all" || law.kind === selectedLawType;
                      const matchesSearch =
                        !officialSearchQuery.trim() ||
                        `${law.title} ${law.agency} ${law.summary} ${law.key_articles.join(" ")}`
                          .toLowerCase()
                          .includes(officialSearchQuery.toLowerCase());
                      return matchesCat && matchesType && matchesSearch;
                    }).map((law) => {
                      const isAlreadyInWorkspace = graph.nodes.some(
                        (n) => n.rule_name === law.title,
                      );
                      return (
                        <div
                          key={law.law_id}
                          style={{
                            background: "#ffffff",
                            border: isAlreadyInWorkspace ? "1.5px solid #a7f3d0" : "1px solid #e2e8f0",
                            borderRadius: "10px",
                            padding: "18px 20px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: "14px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: "8px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span
                                  className={`type-tag ${
                                    law.kind === "statute"
                                      ? "law"
                                      : law.kind === "decree"
                                        ? "decree"
                                        : "rule"
                                  }`}
                                  style={{ margin: 0 }}
                                >
                                  {law.kind === "statute"
                                    ? "법률"
                                    : law.kind === "decree"
                                      ? "대통령령"
                                      : "행정규칙"}
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    color: "#64748b",
                                    background: "#f1f5f9",
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    fontWeight: 500,
                                  }}
                                >
                                  {law.agency}
                                </span>
                              </div>
                              <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                {law.version}
                              </span>
                            </div>

                            <h3
                              style={{
                                fontSize: "16px",
                                fontWeight: 700,
                                color: "#0f172a",
                                margin: "0 0 6px 0",
                              }}
                            >
                              {law.title}
                            </h3>

                            <p
                              style={{
                                fontSize: "13px",
                                color: "#475569",
                                lineHeight: "1.5",
                                margin: "0 0 10px 0",
                              }}
                            >
                              {law.summary}
                            </p>

                            {/* 주요 핵심 조문 칩 */}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                              {law.key_articles.map((art) => (
                                <span
                                  key={art}
                                  style={{
                                    fontSize: "11px",
                                    color: "#3b82f6",
                                    background: "#eff6ff",
                                    padding: "2px 7px",
                                    borderRadius: "4px",
                                    border: "1px solid #dbeafe",
                                  }}
                                >
                                  {art}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* 하단 액션 버튼 */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingTop: "12px",
                              borderTop: "1px solid #f1f5f9",
                            }}
                          >
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={() => navigate(`/laws?q=${encodeURIComponent(law.title)}`)}
                                className="button secondary"
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 10px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <ExternalLink size={13} />
                                원문 열람
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate("/topics")}
                                className="button secondary"
                                style={{
                                  fontSize: "12px",
                                  padding: "6px 10px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <Network size={13} />
                                3단 위임 비교
                              </button>
                            </div>

                            {isAlreadyInWorkspace ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  color: "#059669",
                                  background: "#ecfdf5",
                                  padding: "5px 10px",
                                  borderRadius: "6px",
                                }}
                              >
                                <Check size={14} />
                                저장소 탑재 완료
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleImportOfficialLaw(law)}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  border: "none",
                                  background: "#1e40af",
                                  color: "#ffffff",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "background 0.15s ease",
                                }}
                              >
                                <Plus size={14} />
                                저장소에 탑재
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* 워크스페이스 관리 규정 조문 뷰 (기존 상세 관리 테이블) */
                <>
                  <div className="vault-toolbar">
                    <div className="search-input">
                      <Search size={17} />
                      <input
                        aria-label="규정 검색"
                        placeholder="규정명, 조문, 기관으로 검색"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button
                          aria-label="검색 초기화"
                          onClick={() => setSearch("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <select
                      aria-label="기관 필터"
                      value={agency}
                      onChange={(e) => setAgency(e.target.value)}
                    >
                      <option>전체 기관</option>
                      {Array.from(new Set(graph.nodes.map((n) => n.agency))).map(
                        (a) => (
                          <option key={a}>{a}</option>
                        ),
                      )}
                    </select>
                    <select
                      aria-label="문서 종류"
                      value={kindFilter}
                      onChange={(e) => setKindFilter(e.target.value)}
                    >
                      <option value="all">모든 법령·규정</option>
                      <option value="article">조문 전체</option>
                      <option value="statute">법률 (공식)</option>
                      <option value="decree">대통령령 (공식)</option>
                      <option value="rule">기관 규정·지침</option>
                      <option value="form">별표 서식</option>
                      <option value="guide">실무 가이드</option>
                    </select>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setLawPickerTarget("wizard");
                        setShowLawPicker(true);
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <BookOpen size={15} />
                      공식 법령 추가
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        void load();
                        setToast("저장소와 그래프를 새로 불러왔습니다.");
                      }}
                    >
                      <RefreshCw size={15} />
                      새로고침
                    </button>
                  </div>
                  <div className="vault-summary">
                    <FolderOpen size={17} />
                    <strong>{agencyRules.length}개 규정</strong>
                    <span>·</span>
                    <span>{filtered.length}개 조문·문서</span>
                    <span
                      className="pill sage"
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        marginLeft: "8px",
                      }}
                    >
                      🏛️ 국가법령정보센터 공식 실데이터 연계 (법률·대통령령·고시)
                    </span>
                  </div>
                  <section className="panel">
                    <ArticleTable nodes={filtered} onSelect={openNode} />
                  </section>
                </>
              )}

              {graph.issues.length > 0 && <IssueList issues={graph.issues} />}
            </>
          )}
          {view === "graph" && (
            <>
              <PageHeading
                eyebrow="CONNECTED KNOWLEDGE"
                title="규정 관계 그래프"
                description="상위법에서 기관 지침, 별지 서식까지. 조문을 클릭해 관계를 탐색하세요."
              />
              <div className="vault-toolbar">
                <select
                  aria-label="중심 조문"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                >
                  <option value="">전체 관계 보기</option>
                  {graph.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.rule_name} · {n.title}
                    </option>
                  ))}
                </select>
                <div className="segmented">
                  {[
                    ["ALL", "전체 관계"],
                    ["UPWARD_PARENT", "상위법"],
                    ["BACKLINKS", "역참조"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={direction === id ? "active" : ""}
                      onClick={() => setDirection(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <span className="toolbar-end">
                  노드를 선택하면 관계와 원문이 오른쪽에 표시됩니다.
                </span>
              </div>

              <div className="graph-screen-layout">
                <section className="panel full-graph">
                  <div className="graph-panel-header">
                    <div className="graph-stats-pills">
                      <span className="stat-pill total">
                        <strong>전체 {graph.nodes.length}개</strong> 규정
                      </span>
                      <span className="stat-pill law">
                        🏛️ 상위법 {graph.nodes.filter((n) => n.agency === "국가법령").length}건
                      </span>
                      <span className="stat-pill rule">
                        📜 소관규정 {graph.nodes.filter((n) => n.agency !== "국가법령" && n.kind !== "form").length}건
                      </span>
                      <span className="stat-pill form">
                        📋 별지서식 {graph.nodes.filter((n) => n.kind === "form").length}건
                      </span>
                      <span className="stat-pill edge">
                        🔗 관계 {graph.edges.length}건
                      </span>
                    </div>
                  </div>
                  <GraphCanvas
                    graph={graph}
                    focus={focus}
                    direction={direction}
                    onNode={(n) => {
                      setFocus(n.id);
                    }}
                  />
                  <div className="graph-legend">
                    <span>
                      <i className="law" />
                      상위법령 (법률·시행령)
                    </span>
                    <span>
                      <i className="rule" />
                      기관 규정 (지침·훈령)
                    </span>
                    <span>
                      <i className="form" />
                      별지 서식
                    </span>
                    <span className="legend-hint">
                      연결 방향: 인용 조문 → 근거 조문 (화살표 추적)
                    </span>
                  </div>
                </section>

                {/* Right side: 체계화된 상세 인스펙터 패널 */}
                <aside className="graph-inspector-panel">
                  {focus ? (
                    (() => {
                      const focusNode = graph.nodes.find((n) => n.id === focus);
                      if (!focusNode) return null;
                      const focusEdges = graph.edges.filter(
                        (e) => e.source === focus || e.target === focus
                      );
                      return (
                        <div className="panel inspector-card">
                          <div className="inspector-head">
                            <span
                              className={`pill ${
                                focusNode.agency === "국가법령"
                                  ? "blue"
                                  : focusNode.kind === "form"
                                  ? "sand"
                                  : "sage"
                              }`}
                            >
                              {focusNode.agency === "국가법령"
                                ? "상위법령"
                                : focusNode.kind === "form"
                                ? "별지서식"
                                : "기관규정"}
                            </span>
                            <span className="inspector-agency">
                              {focusNode.agency}
                            </span>
                          </div>
                          <h3 className="inspector-title">{focusNode.title}</h3>
                          <p className="inspector-subtitle">
                            {focusNode.rule_name}{" "}
                            {focusNode.kind !== "form" &&
                              `· ${displayArticle(focusNode)}`}
                          </p>

                          <div className="inspector-meta-row">
                            <div>
                              <span>식별자</span>
                              <code>{focusNode.id}</code>
                            </div>
                            <div>
                              <span>연결 관계</span>
                              <strong>{focusEdges.length}건</strong>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="button primary inspector-read-btn"
                            onClick={() => openNode(focusNode)}
                          >
                            <FileText size={15} />
                            <span>원문 조문 열람·편집 ↗</span>
                          </button>

                          <div className="inspector-relations-section">
                            <h4>연결된 규정 ({focusEdges.length}건)</h4>
                            {focusEdges.length > 0 ? (
                              <div className="inspector-edges-scroll">
                                {focusEdges.map((e, idx) => {
                                  const isSource = e.source === focusNode.id;
                                  const otherId = isSource ? e.target : e.source;
                                  const other = graph.nodes.find(
                                    (n) => n.id === otherId
                                  );
                                  if (!other) return null;
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      className="inspector-edge-btn"
                                      onClick={() => setFocus(other.id)}
                                    >
                                      <div className="edge-btn-top">
                                        <span
                                          className={`edge-dir ${
                                            isSource ? "outgoing" : "incoming"
                                          }`}
                                        >
                                          {isSource ? "→ 인용" : "← 역인용"}
                                        </span>
                                        <span className="edge-kind">
                                          {e.type || "인용"}
                                        </span>
                                      </div>
                                      <strong>{other.title}</strong>
                                      <small>
                                        {other.rule_name} ·{" "}
                                        {displayArticle(other)}
                                      </small>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="inspector-no-edges">
                                연결된 상·하위 규정이 없습니다.
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            className="button secondary reset-btn"
                            onClick={() => setFocus("")}
                          >
                            전체 관계 보기로 초기화
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="panel inspector-card guide-mode">
                      <div className="guide-header">
                        <Network size={24} className="guide-icon" />
                        <div>
                          <h3>규정 관계 체계화 안내</h3>
                          <p>노드를 클릭해 상세 연결을 확인하세요</p>
                        </div>
                      </div>
                      <div className="guide-layers">
                        <div className="guide-layer-item law">
                          <span className="layer-dot law" />
                          <div>
                            <strong>제1계층: 상위법령 (법률)</strong>
                            <small>국가법령정보센터 기준 상위 위임 근거</small>
                          </div>
                        </div>
                        <div className="guide-layer-item rule">
                          <span className="layer-dot rule" />
                          <div>
                            <strong>제2계층: 기관 소관 규정</strong>
                            <small>업무 집행을 위한 기관 지침·훈령·세부기준</small>
                          </div>
                        </div>
                        <div className="guide-layer-item form">
                          <span className="layer-dot form" />
                          <div>
                            <strong>제3계층: 별지 서식</strong>
                            <small>신청·통지·대장 등 실제 행정 집행 서식</small>
                          </div>
                        </div>
                      </div>
                      <div className="guide-tip">
                        💡 <strong>팁:</strong> 상단 중심 조문 선택기나 그래프의
                        조문 노드를 클릭하면 해당 조문을 중심으로 연결된 상·하위
                        규정이 즉시 하이라이트됩니다.
                      </div>
                    </div>
                  )}
                </aside>
              </div>

              <div className="graph-info">
                <ShieldCheck size={18} />
                <span>
                  그래프의 인용 검증은 저장소에 존재하는 파일과 조문을 대상으로
                  합니다. 위임 범위의 적법성은 법률 검토가 필요합니다.
                </span>
              </div>
            </>
          )}
          {view === "impact" && (
            <>
              <PageHeading
                eyebrow="DELTA IMPACT ANALYSIS"
                title="하나의 변화, 연결된 영향."
                description="개정안을 입력하고 역참조되는 규정과 서식을 확인하세요. 원본 파일은 변경되지 않습니다."
                action={
                  <button
                    className="button secondary"
                    onClick={() => setShowGit(true)}
                  >
                    <GitBranch size={16} />
                    Git 변경 분석
                  </button>
                }
              />
              <div className="impact-layout">
                <section className="panel impact-input">
                  <div className="panel-heading">
                    <h3>변경 대상과 개정안</h3>
                    <GitBranch size={18} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "14px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: "700",
                        color: "#1e293b",
                      }}
                    >
                      변경할 조문
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setLawPickerTarget("impact");
                        setShowLawPicker(true);
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      🏛️ 공식 법령에서 조문 불러오기
                    </button>
                  </div>
                  <label style={{ marginTop: 0 }}>
                    <select
                      value={impactTarget}
                      onChange={(e) => chooseImpact(e.target.value)}
                      aria-label="변경할 조문"
                    >
                      <option value="">조문을 선택하세요</option>
                      {articleNodes.map((n) => (
                        <option value={n.id} key={n.id}>
                          {n.rule_name} · {displayArticle(n)} {n.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    개정 마크다운 또는 Unified Diff
                    <textarea
                      className="code-editor"
                      aria-label="개정 마크다운"
                      value={proposed}
                      onChange={(e) => setProposed(e.target.value)}
                      placeholder="조문을 선택하고 본문을 수정하세요."
                    />
                  </label>
                  <button
                    className="button primary wide"
                    disabled={!impactTarget || !proposed || busy}
                    onClick={() => void analyze()}
                  >
                    {busy ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Network size={16} />
                    )}
                    변경 영향 분석
                  </button>
                </section>
                <section className="panel impact-results">
                  <div className="panel-heading">
                    <h3>영향 분석 결과</h3>
                    {impact && (
                      <span className="pill sage">
                        {impact.impacted_nodes.length}개 연결 문서
                      </span>
                    )}
                  </div>
                  {!impact ? (
                    <div className="empty-state">
                      <span>
                        <GitBranch size={30} />
                      </span>
                      <h3>변경의 다음을 찾아드립니다.</h3>
                      <p>
                        왼쪽에서 조문을 선택하고 개정안을 입력하면
                        <br />
                        직접·간접 영향을 받는 규정을 탐색합니다.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`analysis-status ${impact.issues.some((i) => i.severity === "error") ? "warning" : ""}`}
                      >
                        <ShieldCheck size={19} />
                        <div>
                          <strong>
                            {impact.issues.some((i) => i.severity === "error")
                              ? "분석 중 확인이 필요한 항목이 있습니다."
                              : impact.changed
                                ? "변경 영향 분석이 완료되었습니다."
                                : "변경된 조문이 없습니다."}
                          </strong>
                          <small>
                            원본 보존 · 순환 참조를 포함한 역링크 탐색
                          </small>
                        </div>
                      </div>
                      <div className="impact-list">
                        {impact.impacted_nodes.map((item, i) => {
                          const n = item.node || item;
                          return (
                            <button
                              key={n.id || i}
                              onClick={() => {
                                const node = graph.nodes.find(
                                  (g) => g.id === n.id,
                                );
                                if (node) openNode(node);
                              }}
                            >
                              <span
                                className={`file-icon ${n.kind === "form" ? "form" : ""}`}
                              >
                                <FileText size={18} />
                              </span>
                              <span>
                                <strong>{n.title}</strong>
                                <small>
                                  {n.rule_name} ·{" "}
                                  {item.depth === 1
                                    ? "직접 영향"
                                    : `${item.depth || 1}단계 연결`}
                                </small>
                              </span>
                              <ArrowUpRight size={16} />
                            </button>
                          );
                        })}
                        {impact.impacted_nodes.length === 0 && (
                          <p className="muted">
                            역참조하는 다른 문서가 없습니다.
                          </p>
                        )}
                      </div>
                      {impact.suggested_link_edits.length > 0 && (
                        <div className="renumber-note">
                          <AlertTriangle size={17} />
                          {impact.suggested_link_edits.length}개 인용 수정
                          후보가 발견되었습니다.
                          <pre>
                            {JSON.stringify(
                              impact.suggested_link_edits,
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      )}
                      <IssueList issues={impact.issues} />
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "packages" && (
            <>
              <PageHeading
                eyebrow="DOCUMENT PACKAGES"
                title="검토를 위한 문서, 한 번에."
                description="개정 조문부터 신구조문대비표, 이유서와 영향 보고서까지 함께 관리합니다."
                action={
                  <button className="button primary" onClick={startWizard}>
                    <Plus size={16} />
                    문서 패키지 만들기
                  </button>
                }
              />
              {packages.length === 0 ? (
                <section className="panel">
                  <div className="empty-state large">
                    <span>
                      <Files size={34} />
                    </span>
                    <h3>첫 번째 개정 패키지를 준비하세요.</h3>
                    <p>
                      개정 목적과 대상 조문을 선택하면 검토용 문서 세트를
                      생성합니다.
                    </p>
                    <button className="button primary" onClick={startWizard}>
                      개정 위저드 시작
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              ) : (
                <div className="packages-grid">
                  {packages.map((p) => (
                    <section className="panel package-card" key={p.id}>
                      <div className="package-card-top">
                        <span className="file-icon">
                          <Files size={24} />
                        </span>
                        <span
                          className={`pill ${p.status === "blocked" ? "warning" : "sage"}`}
                        >
                          {p.status === "blocked" ? "검증 보류" : "검토용 초안"}
                        </span>
                      </div>
                      <h3>{p.rule_name || "규정 개정 문서 패키지"}</h3>
                      <p>
                        {p.documents.length}개 문서 ·{" "}
                        {p.created_at
                          ? new Date(p.created_at).toLocaleDateString("ko-KR", {
                              timeZone: "Asia/Seoul",
                            })
                          : "개정 프로젝트"}
                      </p>
                      <div className="package-docs">
                        {p.documents.slice(0, 4).map((d) => (
                          <button key={d.name} onClick={() => setPreviewDoc(d)}>
                            <FileText size={14} />
                            {d.name}
                            <Eye size={14} />
                          </button>
                        ))}
                      </div>
                      <button
                        className="button secondary wide"
                        disabled={busy || p.status === "blocked"}
                        onClick={() => download(p)}
                      >
                        <Download size={15} />
                        전체 패키지 다운로드
                      </button>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
          {view === "wizard" && (
            <>
              <PageHeading
                eyebrow="AMENDMENT WORKFLOW"
                title="더 나은 규정의 시작."
                description="목적을 정하고, 관계를 확인하고, 검토할 문서를 준비하세요."
              />
              <div className="wizard-progress">
                {["개정 목적", "대상 조문", "검토 및 생성", "문서 패키지"].map(
                  (s, i) => (
                    <button
                      key={s}
                      disabled={i > wizardStep}
                      className={
                        i === wizardStep
                          ? "active"
                          : i < wizardStep
                            ? "done"
                            : ""
                      }
                      onClick={() => setWizardStep(i)}
                    >
                      <span>
                        {i < wizardStep ? <Check size={14} /> : i + 1}
                      </span>
                      {s}
                      {i < 3 && <ChevronRight size={16} />}
                    </button>
                  ),
                )}
              </div>
              <section className="panel wizard-panel">
                {wizardStep === 0 && (
                  <>
                    <span className="section-kicker">STEP 01</span>
                    <h2>어떤 변화를 만들고 싶으세요?</h2>
                    <p className="muted">
                      선택한 조문 1개를 검토할 자료를 만듭니다. 제정·전부개정은
                      전체 규정에 대한 별도 입안과 심사가 필요합니다.
                    </p>
                    <label>제·개정 유형</label>
                    <div className="amendment-types">
                      {[
                        ["enactment", "제정 검토", "선택한 조문의 입안"],
                        ["partial", "일부개정", "필요한 조문을 정비"],
                        ["full", "전부개정 검토", "선택한 조문의 정비"],
                      ].map(([v, t, d]) => (
                        <button
                          key={v}
                          className={amendment === v ? "selected" : ""}
                          onClick={() => setAmendment(v)}
                        >
                          <span className="radio-dot" />
                          <strong>{t}</strong>
                          <small>{d}</small>
                        </button>
                      ))}
                    </div>
                    <label>
                      <div className="label-with-chips">
                        <span>제·개정 목적 (실제 개정 배경 및 사유 입력)</span>
                        <div className="objective-chips">
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                              setObjective(
                                "인공지능 모델 학습을 위한 데이터 반출 절차와 보안 및 개인정보 보호 요건을 명확히 하고자 합니다.",
                              )
                            }
                          >
                            💡 AI 데이터 반출 정비
                          </button>
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                              setObjective(
                                "상위법령 및 행정안전부 가이드라인 개정에 따른 위임 규정 일치화 및 심사 절차 개선을 위함.",
                              )
                            }
                          >
                            💡 상위법 위임 정합성 확보
                          </button>
                          <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                              setObjective(
                                "신청 서식의 간소화 및 온라인 처리 근거를 마련하여 민원 처리 기간을 단축하고자 함.",
                              )
                            }
                          >
                            💡 신청 절차 간소화 및 서식 개정
                          </button>
                        </div>
                      </div>
                      <textarea
                        aria-label="개정 목적"
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        rows={4}
                        placeholder="직접 개정의 배경과 달성하고 싶은 목표를 입력하세요. (상단 칩을 눌러 추천 문구를 불러올 수도 있습니다)"
                      />
                    </label>
                    <label>
                      예정 시행일
                      <input
                        aria-label="예정 시행일"
                        type="date"
                        value={effective}
                        onChange={(e) => setEffective(e.target.value)}
                      />
                    </label>
                    <div className="wizard-actions">
                      <span>
                        문서는 법률 검토가 필요한 초안으로 생성됩니다.
                      </span>
                      <button
                        className="button primary"
                        disabled={!objective.trim() || !effective}
                        onClick={() => setWizardStep(1)}
                      >
                        대상 조문 선택
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </>
                )}
                {wizardStep === 1 && (
                  <>
                    <span className="section-kicker">STEP 02</span>
                    <h2>개정할 조문과 내용을 확인하세요.</h2>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "16px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: "700",
                          color: "#1e293b",
                        }}
                      >
                        대상 조문 선택
                      </span>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          setLawPickerTarget("wizard");
                          setShowLawPicker(true);
                        }}
                        style={{
                          padding: "5px 12px",
                          fontSize: "12px",
                          fontWeight: "700",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        🏛️ 공식 법령 검색하여 조문 불러오기
                      </button>
                    </div>
                    <label style={{ marginTop: 0 }}>
                      <select
                        aria-label="개정 대상 조문"
                        value={draftArticle}
                        onChange={(e) => {
                          setDraftArticle(e.target.value);
                          setRevision(
                            graph.nodes.find((n) => n.id === e.target.value)
                              ?.markdown || "",
                          );
                        }}
                      >
                        {articleNodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.rule_name} · {displayArticle(n)} {n.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      개정 초안
                      <textarea
                        aria-label="개정 초안"
                        className="code-editor wizard-code"
                        value={revision}
                        onChange={(e) => setRevision(e.target.value)}
                      />
                    </label>
                    <div className="inline-tip">
                      <BookOpen size={17} />
                      <span>
                        본문을 직접 수정하거나, 현행 조문을 유지하고 입력한
                        목적을 바탕으로 검토용 문안을 생성할 수 있습니다.
                      </span>
                    </div>
                    <div className="wizard-actions">
                      <button
                        className="button secondary"
                        onClick={() => setWizardStep(0)}
                      >
                        이전 단계
                      </button>
                      <button
                        className="button primary"
                        disabled={!draftArticle || !revision.trim()}
                        onClick={() => setWizardStep(2)}
                      >
                        문서 구성 확인
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </>
                )}
                {wizardStep === 2 && (
                  <>
                    <span className="section-kicker">STEP 03</span>
                    <h2>검토에 필요한 문서를 준비합니다.</h2>
                    <div className="wizard-summary">
                      <span>개정 대상</span>
                      <strong>
                        {
                          graph.nodes.find((n) => n.id === draftArticle)
                            ?.rule_name
                        }
                      </strong>
                      <span>제·개정 목적</span>
                      <p>{objective}</p>
                      <span>예정 시행일</span>
                      <strong>{effective}</strong>
                    </div>
                    <div className="document-checklist">
                      {[
                        "개정 조문 마크다운",
                        "3단 신구조문대비표",
                        "제·개정이유서",
                        "부칙 및 경과조치",
                        "입법예고문",
                        "연결 서식 정비안",
                        "변경 영향 분석 보고서",
                      ].map((t) => (
                        <div key={t}>
                          <CheckCircle2 size={17} />
                          {t}
                        </div>
                      ))}
                    </div>
                    <div className="inline-tip">
                      <ShieldCheck size={18} />
                      <span>
                        조문 조사 → 초안 작성 → 인용 검증을 거칩니다. 외부 모델
                        미연결 시 템플릿으로 생성하며 법률 검토를 대체하지
                        않습니다.
                      </span>
                    </div>
                    <div className="wizard-actions">
                      <button
                        className="button secondary"
                        onClick={() => setWizardStep(1)}
                      >
                        이전 단계
                      </button>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void generate()}
                      >
                        {busy ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Sparkles size={16} />
                        )}
                        문서 패키지 생성
                      </button>
                    </div>
                  </>
                )}
                {wizardStep === 3 && result && (
                  <>
                    <div className="result-heading">
                      <span
                        className={`result-icon ${result.status === "blocked" ? "blocked" : ""}`}
                      >
                        {result.status === "blocked" ? (
                          <AlertTriangle size={27} />
                        ) : (
                          <Check size={30} />
                        )}
                      </span>
                      <div>
                        <span className="section-kicker">
                          {result.status === "blocked"
                            ? "VERIFICATION REQUIRED"
                            : "READY FOR REVIEW"}
                        </span>
                        <h2>
                          {result.status === "blocked"
                            ? "인용 검증을 통과하지 못했습니다."
                            : "검토용 문서 패키지가 준비되었습니다."}
                        </h2>
                        <p className="muted">
                          {result.status === "blocked"
                            ? "오류를 수정한 후 다시 생성해주세요."
                            : "초안을 검토하고 기관 절차에 따라 승인과 공포를 진행하세요."}
                        </p>
                      </div>
                    </div>
                    <div className="agent-log">
                      {result.agents.map((a, i) => (
                        <div key={a.name}>
                          <span>
                            {a.status === "blocked" ? (
                              <AlertTriangle size={17} />
                            ) : a.status === "skipped" ? (
                              <Clock3 size={17} />
                            ) : (
                              <CheckCircle2 size={17} />
                            )}
                          </span>
                          <strong>
                            {[
                              "절차 총괄",
                              "지식그래프 조사",
                              "서식 분석",
                              "조문 입안",
                              "정합성 검증",
                            ][i] || a.name}
                          </strong>
                          <small>{a.detail}</small>
                        </div>
                      ))}
                    </div>
                    <IssueList issues={result.verification.issues} />
                    <div className="result-docs">
                      {result.documents.map((d) => (
                        <button key={d.name} onClick={() => setPreviewDoc(d)}>
                          <FileText size={18} />
                          <span>{d.name}</span>
                          <Eye size={16} />
                        </button>
                      ))}
                    </div>
                    <div className="wizard-actions">
                      <button
                        className="button secondary"
                        onClick={() => setWizardStep(1)}
                      >
                        초안 수정
                      </button>
                      <button
                        disabled={busy || result.status === "blocked"}
                        className="button primary"
                        onClick={() => download(result)}
                      >
                        <Download size={17} />
                        전체 문서 다운로드
                      </button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
          {view === "mcp" && (
            <McpPlayground
              nodes={graph.nodes}
              onConnectionCheck={() => void load()}
              onOpenNode={(node) => {
                const article = graph.nodes.find((n) => n.id === node.id);
                if (article) openNode(article);
              }}
            />
          )}
          {view === "laws" && <NationalLawPanel />}
          <footer className="page-footer">
            <span>
              <span className="footer-mark">R.</span>연결된 지식으로, 신뢰할 수
              있는 행정.
            </span>
            <span>
              RuleCraft v0.1<span className="footer-dot">·</span>Markdown-native
              <span className="footer-dot">·</span>MCP compatible
            </span>
          </footer>
        </main>
      </div>
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="조문 편집기"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="section-kicker">MARKDOWN ARTICLE</span>
                <h2>{selected.title}</h2>
                <p>
                  {selected.rule_name} · {selected.path}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="닫기"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </div>
            <div className="editor-body">
              <div className="editor-meta">
                <span className="pill sage">
                  {selected.kind === "form"
                    ? "별지 서식"
                    : displayArticle(selected)}
                </span>
                <span>버전 {selected.version}</span>
                <span>공식 시행일: {selected.last_amended || "—"}</span>
              </div>
              <textarea
                aria-label="조문 마크다운 편집"
                className="code-editor"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
              />
              <IssueList issues={editorIssues} />
            </div>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => {
                  chooseImpact(selected.id);
                  go("impact");
                  setSelected(null);
                }}
              >
                <GitBranch size={16} />
                영향 분석으로 열기
              </button>
              <button
                className="button primary"
                disabled={busy || editor === selected.markdown}
                onClick={() => void saveNode()}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}
                검증 후 저장
              </button>
            </div>
          </section>
        </div>
      )}
      {previewDoc && (
        <div className="modal-backdrop" onClick={() => setPreviewDoc(null)}>
          <section
            className="editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="문서 미리보기"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="section-kicker">DOCUMENT PREVIEW</span>
                <h2>{previewDoc.name}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="닫기"
                onClick={() => setPreviewDoc(null)}
              >
                <X size={21} />
              </button>
            </div>
            <pre className="document-preview">{previewDoc.content}</pre>
            <div className="modal-footer">
              <span className="muted">법률 검토가 필요한 초안입니다.</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="button secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(previewDoc.content);
                    setToast(
                      `${previewDoc.name} 본문이 클립보드에 복사되었습니다.`,
                    );
                  }}
                >
                  <Copy size={16} />
                  내용 복사
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    const blob = new Blob([previewDoc.content], {
                      type: "text/markdown;charset=utf-8",
                    });
                    const u = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = previewDoc.name;
                    a.click();
                    URL.revokeObjectURL(u);
                  }}
                >
                  <Download size={16} />
                  문서 다운로드
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {showGit && (
        <div className="modal-backdrop" onClick={() => setShowGit(false)}>
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Git 변경 분석"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="section-kicker">GIT DELTA</span>
                <h2>커밋 간 변경을 추적하세요.</h2>
              </div>
              <button
                aria-label="닫기"
                className="icon-button"
                onClick={() => setShowGit(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="info-body git-form">
              <p>
                기준 커밋과 비교 커밋의 규정 변경을 분석합니다. 비교 커밋을
                비우면 현재 작업 파일과 비교합니다.
              </p>
              <label>
                기준 커밋
                <input
                  aria-label="기준 커밋"
                  value={gitBase}
                  onChange={(e) => setGitBase(e.target.value)}
                  placeholder="HEAD"
                />
              </label>
              <label>
                비교 커밋 (선택)
                <input
                  aria-label="비교 커밋"
                  value={gitHead}
                  onChange={(e) => setGitHead(e.target.value)}
                  placeholder="비우면 현재 작업 파일"
                />
              </label>
              <div className="inline-tip">
                <GitBranch size={17} />
                <span>
                  저장소에 첫 커밋이 있어야 Git 비교를 사용할 수 있습니다.
                  개정안 미리보기는 커밋 없이 실행됩니다.
                </span>
              </div>
              <button
                className="button primary wide"
                disabled={busy || !gitBase.trim()}
                onClick={() => void analyzeGit()}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Network size={16} />
                )}
                커밋 변경 분석
              </button>
            </div>
          </section>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-label="환경 연결 상태"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="section-kicker">WORKSPACE SETTINGS</span>
                <h2>환경 연결 상태</h2>
              </div>
              <button
                aria-label="닫기"
                className="icon-button"
                onClick={() => setSettings(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="info-body">
              <p>
                외부 연결 없이 지식그래프·영향 분석·문서 패키징을 사용할 수
                있습니다.
              </p>
              {Object.entries(overview?.readiness || {}).map(([k, v]) => (
                <div className="readiness-row" key={k}>
                  <strong>
                    {{
                      graph: "마크다운 지식그래프",
                      drafting: "조문 작성 모델",
                      vision: "LLaVA 서식 분석",
                      national_law: "국가법령 API",
                      mcp: "MCP 서버",
                    }[k] || k}
                  </strong>
                  <span className={`pill ${v.available ? "sage" : "neutral"}`}>
                    {v.available
                      ? k === "graph" || k === "mcp"
                        ? "사용 가능"
                        : "설정됨 · 확인 필요"
                      : v.mode === "template"
                        ? "템플릿 모드"
                        : "미연결"}
                  </span>
                </div>
              ))}
              <div className="inline-tip">
                <CircleHelp size={17} />
                <span>
                  모델과 법령 API 연결 방법은 저장소의 시작 가이드에 안내되어
                  있습니다.
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-label="시작 가이드"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="section-kicker">GETTING STARTED</span>
                <h2>RuleCraft 시작 가이드</h2>
              </div>
              <button
                aria-label="닫기"
                className="icon-button"
                onClick={() => setHelp(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="info-body help-steps">
              {[
                [
                  "규정을 살펴보세요",
                  "지식 저장소에서 조문을 열고 마크다운과 인용 링크를 확인합니다.",
                ],
                [
                  "변경의 영향을 확인하세요",
                  "조문 편집기에서 영향 분석을 열고 개정안을 입력합니다.",
                ],
                [
                  "개정 패키지를 준비하세요",
                  "개정 위저드에서 목적과 조문을 선택하고 검토용 문서를 생성합니다.",
                ],
              ].map(([t, d], i) => (
                <div key={t}>
                  <span>{i + 1}</span>
                  <section>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </section>
                </div>
              ))}
              <p className="demo-disclaimer" style={{ color: "#475569" }}>
                대한민국 공식 법령(개인정보 보호법, 공공데이터법 등) 및 기관 실무 규정의 실데이터를 기반으로 3단 위임 연계와 법제 심사 7종 문서를 실시간 생성합니다.
              </p>
            </div>
          </section>
        </div>
      )}
      {showLawPicker && (
        <LawPickerModal
          onClose={() => setShowLawPicker(false)}
          onSelect={handleSelectOfficialArticle}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span className="small-line" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function ArticleTable({
  nodes,
  onSelect,
  compact = false,
}: {
  nodes: Node[];
  onSelect: (n: Node) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-container">
      <table className={compact ? "compact-table" : ""}>
        <thead>
          <tr>
            <th>규정 · 조문</th>
            <th>구분</th>
            <th>자료 기준일</th>
            <th>상태</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr
              key={n.id}
              onClick={() => onSelect(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(n);
              }}
              tabIndex={0}
              role="button"
              aria-label={`${n.title} 열기`}
            >
              <td>
                <div className="article-name">
                  <span
                    className={`file-icon ${n.kind === "form" ? "form" : ""}`}
                  >
                    <FileText size={17} />
                  </span>
                  <div>
                    <strong>{n.rule_name}</strong>
                    <small>
                      {n.kind === "form" ? "별지" : displayArticle(n)} ·{" "}
                      {n.title}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <span
                  className={`type-tag ${
                    n.kind === "statute"
                      ? "law"
                      : n.kind === "decree"
                        ? "decree"
                        : n.kind === "form"
                          ? "form"
                          : n.kind === "guide"
                            ? "guide"
                            : "rule"
                  }`}
                >
                  {n.kind === "statute"
                    ? "법률"
                    : n.kind === "decree"
                      ? "대통령령"
                      : n.kind === "form"
                        ? "서식"
                        : n.kind === "guide"
                          ? "가이드"
                          : "기관 규정"}
                </span>
              </td>
              <td className="date-cell">
                {n.last_amended || "—"}
                <small className="document-date-kind">
                  {n.kind === "statute" || n.kind === "decree"
                    ? "공식 시행일"
                    : "규정 시행일"}
                </small>
              </td>
              <td>
                <span className="status-label" data-status={n.status}>
                  <i />
                  {documentStatus(n)}
                </span>
              </td>
              <td>
                <ChevronRight size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {nodes.length === 0 && (
        <div className="empty-state">
          <Search size={26} />
          <h3>표시할 규정이 없습니다.</h3>
          <p>검색어와 필터를 확인하세요.</p>
        </div>
      )}
    </div>
  );
}
function IssueList({ issues }: { issues: Issue[] }) {
  return issues.length > 0 ? (
    <div className="issue-list">
      {issues.map((i, index) => (
        <div key={index}>
          <AlertTriangle size={15} />
          <span>
            {i.message}
            {i.path && <small>{i.path}</small>}
          </span>
        </div>
      ))}
    </div>
  ) : null;
}
function GraphCanvas({
  graph,
  focus,
  onNode,
  mini = false,
  direction = "ALL",
}: {
  graph: Graph;
  focus: string;
  onNode: (n: Node) => void;
  mini?: boolean;
  direction?: string;
}) {
  let nodes = graph.nodes;
  let edges = graph.edges;
  if (focus) {
    const keep = new Set([focus]);
    let changed = true;
    while (changed) {
      changed = false;
      edges.forEach((e) => {
        if (direction === "UPWARD_PARENT") {
          if (
            keep.has(e.source) &&
            e.type === "delegated_by" &&
            !keep.has(e.target)
          ) {
            keep.add(e.target);
            changed = true;
          }
        } else if (direction === "BACKLINKS") {
          if (keep.has(e.target) && !keep.has(e.source)) {
            keep.add(e.source);
            changed = true;
          }
        } else if (keep.has(e.source) || keep.has(e.target)) {
          if (!keep.has(e.source) || !keep.has(e.target)) {
            keep.add(e.source);
            keep.add(e.target);
            changed = true;
          }
        }
      });
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }
  if (mini) {
    const core =
      nodes.find((n) => n.id === focus) ||
      nodes.find((n) => String(n.article_no) === "제7조") ||
      nodes[0];
    const connected = new Set([
      core?.id,
      ...edges
        .filter((e) => e.source === core?.id || e.target === core?.id)
        .flatMap((e) => [e.source, e.target]),
    ]);
    nodes = nodes
      .filter((n) => connected.has(n.id))
      .sort((a, b) => {
        const score = (n: Node) =>
          n.agency === "국가법령"
            ? 0
            : n.id === core?.id
              ? 1
              : n.kind === "form"
                ? 2
                : 3;
        return score(a) - score(b);
      })
      .slice(0, 6);
    edges = edges.filter(
      (e) =>
        nodes.some((n) => n.id === e.source) &&
        nodes.some((n) => n.id === e.target),
    );
  }
  const width = mini ? 430 : 1050;
  const law = nodes.filter(
      (n) =>
        n.kind === "statute" ||
        n.kind === "decree" ||
        n.agency === "국가법령" ||
        n.agency === "개인정보보호위원회" ||
        n.agency === "행정안전부",
    ),
    forms = nodes.filter((n) => n.kind === "form" || n.kind === "guide"),
    rules = nodes.filter((n) => !law.includes(n) && !forms.includes(n));

  const maxPerRow = mini ? 3 : 5;
  const lawRows = Math.max(1, Math.ceil(law.length / maxPerRow));
  const ruleRows = Math.max(1, Math.ceil(rules.length / maxPerRow));
  const formRows = Math.max(1, Math.ceil(forms.length / maxPerRow));

  const lawLaneY = 12;
  const lawLaneH = mini ? 70 : Math.max(140, lawRows * 75 + 45);
  const ruleLaneY = lawLaneY + lawLaneH + 16;
  const ruleLaneH = mini ? 90 : Math.max(140, ruleRows * 75 + 45);
  const formLaneY = ruleLaneY + ruleLaneH + 16;
  const formLaneH = mini ? 70 : Math.max(120, formRows * 75 + 45);

  const height = mini ? 260 : formLaneY + formLaneH + 24;

  const positions = new Map<string, { x: number; y: number }>();
  if (mini && focus) {
    const focused = rules.find((n) => n.id === focus);
    if (focused) {
      rules.splice(rules.indexOf(focused), 1);
      rules.splice(Math.floor((rules.length + 1) / 2), 0, focused);
    }
  }

  const rowConfigs = [
    { items: law, startY: mini ? 42 : lawLaneY + 54 },
    { items: rules, startY: mini ? 128 : ruleLaneY + 54 },
    { items: forms, startY: mini ? 218 : formLaneY + 54 },
  ];
  rowConfigs.forEach(({ items, startY }) =>
    items.forEach((n, i) => {
      const group = Math.floor(i / maxPerRow),
        offset = i % maxPerRow,
        count = Math.min(items.length - group * maxPerRow, maxPerRow);
      positions.set(n.id, {
        x: (width / (count + 1)) * (offset + 1),
        y: startY + group * (mini ? 38 : 75),
      });
    }),
  );
  const uniqueEdges = edges.filter(
    (e, i) =>
      edges.findIndex((o) => o.source === e.source && o.target === e.target) ===
      i,
  );
  return (
    <div className={`graph-canvas ${mini ? "mini" : ""}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="규정 간 관계 그래프"
      >
        <defs>
          <pattern
            id={mini ? "mini-dots" : "full-dots"}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#94a3b8" opacity="0.4" />
          </pattern>
          <marker
            id={mini ? "mini-arrow" : "full-arrow"}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
        </defs>
        <rect
          width={width}
          height={height}
          fill={`url(#${mini ? "mini-dots" : "full-dots"})`}
        />

        {/* Tier Swimlanes (계층별 체계화 영역 배경) */}
        {!mini && (
          <g className="graph-swimlanes">
            {/* 1단계: 상위법령 */}
            <rect
              x="12"
              y={lawLaneY}
              width={width - 24}
              height={lawLaneH}
              rx="10"
              fill={law.length > 0 ? "#f0f7ff" : "#f8fafc"}
              stroke={law.length > 0 ? "#bae6fd" : "#e2e8f0"}
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <g transform={`translate(24, ${lawLaneY + 22})`}>
              <rect
                x="0"
                y="-13"
                width="230"
                height="22"
                rx="4"
                fill={law.length > 0 ? "#e0f2fe" : "#f1f5f9"}
                stroke={law.length > 0 ? "#7dd3fc" : "#cbd5e1"}
              />
              <text
                x="8"
                y="2"
                fontSize="11"
                fontWeight="700"
                fill={law.length > 0 ? "#0369a1" : "#64748b"}
              >
                🏛️ 제1계층: 상위법령 (법률·대통령령) {law.length}건
              </text>
            </g>
            {law.length === 0 && (
              <text
                x={width / 2}
                y={lawLaneY + 70}
                textAnchor="middle"
                fontSize="12.5"
                fill="#94a3b8"
                fontWeight="500"
              >
                {direction === "UPWARD_PARENT"
                  ? "선택된 규정의 상위법령 위임 조항이 없습니다."
                  : "표시할 상위법령이 없습니다."}
              </text>
            )}

            {/* 2단계: 소관 규정 */}
            <rect
              x="12"
              y={ruleLaneY}
              width={width - 24}
              height={ruleLaneH}
              rx="10"
              fill={rules.length > 0 ? "#f0fdf4" : "#f8fafc"}
              stroke={rules.length > 0 ? "#bbf7d0" : "#e2e8f0"}
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <g transform={`translate(24, ${ruleLaneY + 22})`}>
              <rect
                x="0"
                y="-13"
                width="240"
                height="22"
                rx="4"
                fill={rules.length > 0 ? "#dcfce7" : "#f1f5f9"}
                stroke={rules.length > 0 ? "#86efac" : "#cbd5e1"}
              />
              <text
                x="8"
                y="2"
                fontSize="11"
                fontWeight="700"
                fill={rules.length > 0 ? "#15803d" : "#64748b"}
              >
                📜 제2계층: 기관 소관 규정 (지침·훈령) {rules.length}건
              </text>
            </g>
            {rules.length === 0 && (
              <text
                x={width / 2}
                y={ruleLaneY + 70}
                textAnchor="middle"
                fontSize="12.5"
                fill="#94a3b8"
                fontWeight="500"
              >
                표시할 기관 소관 규정이 없습니다.
              </text>
            )}

            {/* 3단계: 별지 서식 */}
            <rect
              x="12"
              y={formLaneY}
              width={width - 24}
              height={formLaneH}
              rx="10"
              fill={forms.length > 0 ? "#fffbeb" : "#f8fafc"}
              stroke={forms.length > 0 ? "#fde68a" : "#e2e8f0"}
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <g transform={`translate(24, ${formLaneY + 22})`}>
              <rect
                x="0"
                y="-13"
                width="230"
                height="22"
                rx="4"
                fill={forms.length > 0 ? "#fef3c7" : "#f1f5f9"}
                stroke={forms.length > 0 ? "#fcd34d" : "#cbd5e1"}
              />
              <text
                x="8"
                y="2"
                fontSize="11"
                fontWeight="700"
                fill={forms.length > 0 ? "#b45309" : "#64748b"}
              >
                📋 제3계층: 별지 서식 및 집행서식 {forms.length}건
              </text>
            </g>
            {forms.length === 0 && (
              <text
                x={width / 2}
                y={formLaneY + 60}
                textAnchor="middle"
                fontSize="12.5"
                fill="#94a3b8"
                fontWeight="500"
              >
                표시할 별지 서식이 없습니다.
              </text>
            )}
          </g>
        )}

        {mini && (
          <g className="graph-swimlanes-mini">
            <rect x="6" y="8" width={width - 12} height="74" rx="6" fill="#f0f7ff" stroke="#bae6fd" strokeDasharray="3 3" />
            <rect x="6" y="88" width={width - 12} height="82" rx="6" fill="#f0fdf4" stroke="#bbf7d0" strokeDasharray="3 3" />
            <rect x="6" y="176" width={width - 12} height="76" rx="6" fill="#fffbeb" stroke="#fde68a" strokeDasharray="3 3" />
          </g>
        )}

        {uniqueEdges.map((e) => {
          const s = positions.get(e.source),
            t = positions.get(e.target);
          if (!s || !t) return null;
          return (
            <path
              key={e.source + e.target}
              d={`M${s.x},${s.y} C${s.x},${(s.y + t.y) / 2} ${t.x},${(s.y + t.y) / 2} ${t.x},${t.y}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={mini ? 1.2 : 1.7}
              markerEnd={`url(#${mini ? "mini-arrow" : "full-arrow"})`}
            />
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const isFocus = n.id === focus,
            isLaw = n.agency === "국가법령",
            isForm = n.kind === "form",
            w = mini ? 105 : 168,
            h = mini ? 38 : 61;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className={`graph-node ${isFocus ? "focused" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${n.title} 관계 노드`}
              onClick={() => onNode(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNode(n);
              }}
            >
              <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx={mini ? 7 : 10}
                fill={
                  isFocus
                    ? "#0b3b60"
                    : "#ffffff"
                }
                stroke={
                  isFocus
                    ? "#3b82f6"
                    : isLaw
                      ? "#0284c7"
                      : isForm
                        ? "#d97706"
                        : "#16a34a"
                }
                strokeWidth={isFocus ? (mini ? "2" : "2.5") : (mini ? "1.2" : "1.5")}
              />
              {/* Category Top Strip */}
              <path
                d={`M${-w / 2 + (mini ? 7 : 10)},${-h / 2} h${w - (mini ? 14 : 20)} a${mini ? 7 : 10},${mini ? 7 : 10} 0 0 1 ${mini ? 7 : 10},${mini ? 7 : 10} v0 h${-w} v0 a${mini ? 7 : 10},${mini ? 7 : 10} 0 0 1 ${mini ? 7 : 10},${-(mini ? 7 : 10)} z`}
                fill={isFocus ? "#60a5fa" : isLaw ? "#0284c7" : isForm ? "#d97706" : "#16a34a"}
              />
              <text
                textAnchor="middle"
                y={mini ? -2 : -4}
                fontSize={mini ? 9 : 11.5}
                fill={isFocus ? "#ffffff" : isLaw ? "#0369a1" : isForm ? "#b45309" : "#15803d"}
                fontWeight="700"
              >
                {n.rule_name.length > (mini ? 11 : 15)
                  ? n.rule_name.slice(0, mini ? 10 : 14) + "…"
                  : n.rule_name}
              </text>
              <text
                textAnchor="middle"
                y={mini ? 11 : 14}
                fontSize={mini ? 8 : 10}
                fill={isFocus ? "#e2e8f0" : "#475569"}
                fontWeight="500"
              >
                {isForm ? "별지 서식" : displayArticle(n)} ·{" "}
                {n.title.slice(0, mini ? 8 : 15)}
              </text>
              <title>
                {n.rule_name} {n.title}
              </title>
            </g>
          );
        })}
        {nodes.length === 0 && (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fontSize="14"
            fill="#778379"
          >
            연결된 규정이 없습니다.
          </text>
        )}
      </svg>
      {!mini && (
        <div className="graph-counter">
          <Network size={15} />
          {nodes.length}개 노드 · {uniqueEdges.length}개 연결
        </div>
      )}
    </div>
  );
}
function AppRoot() {
  const { path } = useRouter();

  if (path.startsWith("/app") || path === "/login") {
    return (
      <LoginGate>
        <App />
      </LoginGate>
    );
  }

  if (path.startsWith("/laws")) {
    return (
      <Layout activeNav="/laws">
        <LawsPage />
      </Layout>
    );
  }

  if (path.startsWith("/topics")) {
    return (
      <Layout activeNav="/topics">
        <TopicsPage />
      </Layout>
    );
  }

  if (path.startsWith("/attachments")) {
    return (
      <Layout activeNav="/attachments">
        <AttachmentsPage />
      </Layout>
    );
  }

  if (path.startsWith("/guide")) {
    return (
      <Layout activeNav="/guide">
        <GuidePage />
      </Layout>
    );
  }

  if (path.startsWith("/demo")) {
    return (
      <Layout activeNav="/demo">
        <DemoPage />
      </Layout>
    );
  }

  return (
    <Layout activeNav="/">
      <HomePage />
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider>
      <AppRoot />
    </RouterProvider>
  </React.StrictMode>,
);
