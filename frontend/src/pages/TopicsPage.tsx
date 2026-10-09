import { Network } from "lucide-react";
import TopicRelations from "../TopicRelations";
import { useRouter } from "../router";

export function TopicsPage() {
  const { navigate } = useRouter();

  return (
    <div className="topics-page">
      <div className="page-header-card" style={{
        background: "#ffffff",
        border: "1px solid #e1ebe0",
        borderRadius: "14px",
        padding: "24px 28px",
        marginBottom: "24px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <Network size={26} color="#2b6348" style={{ marginTop: 2 }} />
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1a3827", margin: 0 }}>
              주제별 상·하위 위임 체계
            </h1>
            <p style={{ fontSize: "13px", color: "#688070", margin: "6px 0 0" }}>
              법률에서 시행령, 부처 고시·훈령으로 이어지는 조문 위임 체계와 근거를 확인합니다.
            </p>
          </div>
        </div>
      </div>

      <TopicRelations
        onSelect={(law) => {
          navigate(
            `/laws?source=${encodeURIComponent(law.source)}&law_id=${encodeURIComponent(
              law.law_id
            )}&version_id=${encodeURIComponent(law.version_id)}`
          );
        }}
      />
    </div>
  );
}
