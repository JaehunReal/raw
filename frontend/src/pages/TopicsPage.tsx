import { Network } from "lucide-react";
import TopicRelations from "../TopicRelations";
import { useRouter } from "../router";

export function TopicsPage() {
  const { navigate } = useRouter();

  return (
    <div className="topics-page">
      <div className="gov-page-header">
        <div className="gov-header-inner">
          <Network size={26} className="gov-header-icon" />
          <div>
            <h1 className="gov-header-title">
              주제별 상·하위 위임 체계
            </h1>
            <p className="gov-header-desc">
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
