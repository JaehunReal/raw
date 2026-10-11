import { useState } from 'react';
import './work-history.css';
export function WorkHistory() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>작업 이력</button>
    {open && <div className="work-history-backdrop" onClick={() => setOpen(false)}>
      <section className="work-history" role="dialog" aria-modal="true" aria-label="도구별 작업 이력" onClick={e => e.stopPropagation()} onKeyDown={e => { if(e.key === 'Escape') setOpen(false); }}>
        <button autoFocus onClick={() => setOpen(false)}>닫기</button>
        <h2>도구별 작업 이력</h2>
        <p>작성 도구를 확인한 근거와 적용 상태를 함께 기록합니다.</p>
        <h3>안티그래비티</h3>
        <p>포털·실무 화면 분리, 관계 그래프, 조문 상세 패널. 사용자가 업데이트 도구를 확인했고, Git 변경 범위와 배포 화면을 대조했습니다. 개별 커밋의 자동 작성자 표시는 없습니다.</p>
        <a href="https://github.com/JaehunReal/raw/commit/8a7b1d9b97225aa62874c8bd15fab95835415705" target="_blank" rel="noreferrer">2026-10-10 최신 변경 근거 보기</a>
        <h3>Claude Code</h3>
        <p>현재 확인한 Git 기록만으로 작업 범위를 구분할 수 없습니다. 작성자 근거가 있는 작업 기록이 추가되면 표시합니다.</p>
        <h3>Codex · 2026-10-11</h3>
        <p>예제 그래프의 미검증 표시, 요약문을 조문으로 생성하던 경로 제거, 독립 서비스 안내, Laya 선택적 연결과 실패 시 기본 정렬 복귀, 공동 작업 기록 규칙을 추가했습니다.</p>
        <h3>Laya 적용 범위</h3>
        <p>검색된 법령 제목의 관련성 정렬용 연결을 구현했습니다. 추론 서버 설정과 한국어 평가를 마쳐 활성화하기 전에는 기본 검색을 사용합니다. 조문 정확도나 법적 위임을 판정하지 않습니다.</p>
      </section>
    </div>}
  </>;
}
