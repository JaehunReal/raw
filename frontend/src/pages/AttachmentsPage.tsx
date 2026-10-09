import { FileText } from "lucide-react";
import AttachmentLibrary from "../AttachmentLibrary";

export function AttachmentsPage() {
  return (
    <div className="attachments-page">
      <div className="gov-page-header">
        <div className="gov-header-inner">
          <FileText size={26} className="gov-header-icon" />
          <div>
            <h1 className="gov-header-title">
              별표 · 서식 라이브러리
            </h1>
            <p className="gov-header-desc">
              법령·행정규칙에 첨부된 별표 및 신청서 서식 원본(PDF/HWP)과 정제된 Markdown, JSON 변환본을 확인합니다.
            </p>
          </div>
        </div>
      </div>

      <AttachmentLibrary />
    </div>
  );
}
