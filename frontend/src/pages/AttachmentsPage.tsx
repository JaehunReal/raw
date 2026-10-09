import { FileText } from "lucide-react";
import AttachmentLibrary from "../AttachmentLibrary";

export function AttachmentsPage() {
  return (
    <div className="attachments-page">
      <div className="page-header-card" style={{
        background: "#ffffff",
        border: "1px solid #e1ebe0",
        borderRadius: "14px",
        padding: "24px 28px",
        marginBottom: "24px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <FileText size={26} color="#8c6016" style={{ marginTop: 2 }} />
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1a3827", margin: 0 }}>
              별표 · 서식 라이브러리
            </h1>
            <p style={{ fontSize: "13px", color: "#688070", margin: "6px 0 0" }}>
              법령·행정규칙에 첨부된 별표 및 신청서 서식 원본(PDF/HWP)과 정제된 Markdown, JSON 변환본을 확인합니다.
            </p>
          </div>
        </div>
      </div>

      <AttachmentLibrary />
    </div>
  );
}
