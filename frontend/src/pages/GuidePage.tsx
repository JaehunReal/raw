import { useState } from "react";
import { BookOpen, PlugZap, HelpCircle } from "lucide-react";
import { ServiceOverview, McpGuide } from "../ServiceGuide";
import { useRouter } from "../router";

export function GuidePage() {
  const { navigate } = useRouter();
  const [tab, setTab] = useState<"overview" | "mcp">("mcp");

  return (
    <div className="guide-page">
      <div className="page-header-card" style={{
        background: "#ffffff",
        border: "1px solid #e1ebe0",
        borderRadius: "14px",
        padding: "24px 28px",
        marginBottom: "24px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
          <HelpCircle size={26} color="#2b6348" style={{ marginTop: 2 }} />
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1a3827", margin: 0 }}>
              이용 안내 및 AI 도구 (MCP) 연동
            </h1>
            <p style={{ fontSize: "13px", color: "#688070", margin: "6px 0 0" }}>
              RuleCraft의 업무 흐름과 AI 클라이언트(Claude, ChatGPT 등)에서 법령 도구를 사용하는 방법을 확인합니다.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setTab("mcp")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 18px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "mcp" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "mcp" ? "#285b41" : "#ffffff",
              color: tab === "mcp" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
          >
            <PlugZap size={16} />
            <span>AI 도구 (MCP) 연동 안내</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("overview")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 18px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              border: tab === "overview" ? "1px solid #285b41" : "1px solid #d4dfd2",
              background: tab === "overview" ? "#285b41" : "#ffffff",
              color: tab === "overview" ? "#ffffff" : "#3b5846",
              cursor: "pointer",
            }}
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
