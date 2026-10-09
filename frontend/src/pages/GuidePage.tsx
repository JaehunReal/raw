import { useState } from "react";
import { BookOpen, PlugZap, HelpCircle } from "lucide-react";
import { ServiceOverview, McpGuide } from "../ServiceGuide";
import { useRouter } from "../router";

export function GuidePage() {
  const { navigate } = useRouter();
  const [tab, setTab] = useState<"overview" | "mcp">("mcp");

  return (
    <div className="guide-page">
      <div className="gov-page-header">
        <div className="gov-header-inner">
          <HelpCircle size={26} className="gov-header-icon" />
          <div>
            <h1 className="gov-header-title">
              이용 안내 및 AI 도구 (MCP) 연동
            </h1>
            <p className="gov-header-desc">
              RuleCraft의 업무 흐름과 AI 클라이언트(Claude, ChatGPT 등)에서 법령 도구를 사용하는 방법을 확인합니다.
            </p>
          </div>
        </div>

        <div className="gov-tabs-row">
          <button
            type="button"
            onClick={() => setTab("mcp")}
            className={`gov-tab-btn ${tab === "mcp" ? "active" : ""}`}
          >
            <PlugZap size={16} />
            <span>AI 도구 (MCP) 연동 안내</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`gov-tab-btn ${tab === "overview" ? "active" : ""}`}
          >
            <BookOpen size={16} />
            <span>규정 검토 업무 흐름 안내</span>
          </button>
        </div>
      </div>

      {tab === "overview" && (
        <ServiceOverview
          onNavigate={(target) => {
            if (target === "laws") navigate("/laws");
            else if (target === "mcp") setTab("mcp");
            else navigate("/demo");
          }}
        />
      )}

      {tab === "mcp" && <McpGuide />}
    </div>
  );
}
