import LegalText from './LegalText';
import './legal-reader.css';
import { useEffect, useRef, useState } from 'react';
import { OfficialRelations } from './OfficialRelations';
import { lawReaderUrl, sameVersion } from './topicSources';
import type { Provision } from './provisionLinks';
import { Network, FileText, ArrowDown, ExternalLink, CheckCircle, Search, Layers, BookOpen, ChevronRight } from 'lucide-react';

type Law = {
  source: 'law' | 'administrative' | 'ordinance';
  law_id: string;
  version_id: string;
  title: string;
  effective_date: string | null;
  publication_date: string | null;
  source_url: string | null;
  raw_sha256: string | null;
  stored_at: string | null;
};

type Node = Law & { article?: string; text?: string };
type Edge = { from: number; to: number; kind: string; basis: string };
type Topic = {
  keyword: string;
  title: string;
  category?: string;
  summary?: string;
  aliases: string[];
  nodes: Node[];
  edges: Edge[];
};

type Data = { checked_at: string; scope: string; topics: Topic[] };
type Document = Law & { raw_text: string; provisions?: Provision[] };

const TOPIC_PRESETS = [
  { label: '전체 주제', keyword: '' },
  { label: '🛡️ 안전성 확보조치', keyword: '안전조치' },
  { label: '📂 공공데이터 제공', keyword: '공공데이터제공' },
  { label: '📊 품질관리', keyword: '품질관리' },
  { label: '🤖 가명정보·AI', keyword: '가명정보' },
  { label: '🗑️ 파기 및 삭제', keyword: '파기' },
  { label: '⚖️ 수집·이용 요건', keyword: '수집이용' },
  { label: '🌐 행정정보 공동이용', keyword: '전자정부' },
];

export default function TopicRelations({
  onSelect,
}: {
  onSelect: (law: Law) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<'graph' | 'cards'>('graph');

  const [selected, setSelected] = useState<Node | null>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Law[] | null>(null);
  const [searchError, setSearchError] = useState(false);

  const [hoveredEdge, setHoveredEdge] = useState<{ topicKey: string; edgeIdx: number } | null>(null);

  const reader = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = new AbortController();
    fetch('/official-topics.json', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    setDocument(null);
    setFailed(false);
    reader.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const p = new URLSearchParams({
      source: selected.source,
      law_id: selected.law_id,
      version_id: selected.version_id,
    });
    fetch('/api/official/document?' + p, { signal: c.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = (await r.json()).document;
        if (!d || !sameVersion(d, selected) || typeof d.raw_text !== 'string')
          throw Error();
        return d;
      })
      .then((d) => {
        if (!c.signal.aborted) setDocument(d);
      })
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [selected, attempt]);

  useEffect(() => {
    if (!search) return;
    const c = new AbortController();
    setResults(null);
    setSearchError(false);
    fetch(
      '/api/official/laws?' +
        new URLSearchParams({ q: search, limit: '20', offset: '0' }),
      { signal: c.signal }
    )
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (!Array.isArray(d.items)) throw Error();
        return d.items;
      })
      .then((d) => {
        if (!c.signal.aborted) setResults(d);
      })
      .catch(() => {
        if (!c.signal.aborted) setSearchError(true);
      });
    return () => c.abort();
  }, [search]);

  const topics =
    data?.topics.filter((t) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [t.keyword, t.title, ...(t.aliases || [])].some((s) =>
        s.toLowerCase().includes(q)
      );
    }) || [];

  const sourceLink = document
    ? lawReaderUrl(document.source, document.version_id)
    : null;
  const article = document?.provisions?.find(
    (p) =>
      p.article_no.replace(/\s/g, '') === selected?.article?.replace(/\s/g, '')
  );

  return (
    <section className="panel topic-relations" style={{ padding: '24px 28px' }}>
      {/* 헤더 & 설명 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Network size={22} color="#0284c7" />
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              실제 공식 법령 상·하위 위임 연관 체계
            </h3>
            <span className="pill sage" style={{ fontSize: '11px', fontWeight: '600' }}>
              🏛️ 국가법령 실데이터 연계
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
            대한민국 법률에서 대통령령(시행령), 소관 부처 고시·훈령으로 이어지는 실제 법적 위임 근거와 조문을 연관 그래프로 탐색합니다.
          </p>
        </div>

        {/* 뷰 모드 토글 버튼 */}
        <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              background: viewMode === 'graph' ? '#ffffff' : 'transparent',
              color: viewMode === 'graph' ? '#0284c7' : '#64748b',
              boxShadow: viewMode === 'graph' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            <Network size={14} />
            <span>연관 그래프 보기</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              background: viewMode === 'cards' ? '#ffffff' : 'transparent',
              color: viewMode === 'cards' ? '#0284c7' : '#64748b',
              boxShadow: viewMode === 'cards' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            <Layers size={14} />
            <span>단계별 카드 보기</span>
          </button>
        </div>
      </div>

      {/* 주제 프리셋 칩 버튼 목록 */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>추천 핵심 주제:</span>
          {TOPIC_PRESETS.map((p) => {
            const isSelected = query === p.keyword;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setQuery(p.keyword);
                  setSearch('');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  fontSize: '12px',
                  fontWeight: isSelected ? '700' : '500',
                  border: isSelected ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: isSelected ? '#f0f9ff' : '#ffffff',
                  color: isSelected ? '#0369a1' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 검색 바 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
        style={{ marginBottom: '20px' }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '12px' }} />
            <input
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색할 주제 키워드 또는 법령명을 입력하세요 (예: 안전조치, 파기, 공공데이터, 가명정보, 전자정부…)"
              style={{
                width: '100%',
                padding: '9px 12px 9px 36px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="submit"
            className="button secondary"
            disabled={!query.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Search size={14} />
            <span>실제 법령 원문 검색</span>
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '13px', padding: '12px', background: '#fef2f2', borderRadius: '6px' }}>
          주제별 공식 연결 데이터를 불러오지 못했습니다. 아래 법령명 검색을 통해 원문을 확인하실 수 있습니다.
        </p>
      )}

      {/* 주제별 연관 체계 렌더링 영역 */}
      {data && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>
              공식 위임 근거가 대조된 핵심 주제 <strong>{topics.length}개</strong> (전체 {data.topics.length}개 분야)
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              출처: 대한민국 법제처 국가법령정보센터 ({data.checked_at?.slice(0, 10)})
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {topics.map((t) => (
              <div
                key={t.keyword}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  background: '#ffffff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                  overflow: 'hidden',
                }}
              >
                {/* 카드 상단 바 */}
                <div
                  style={{
                    padding: '14px 20px',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="pill sage" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        {t.category || '공식 법령 체계'}
                      </span>
                      <h4 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                        {t.title}
                      </h4>
                    </div>
                    {t.summary && (
                      <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>
                        {t.summary}
                      </p>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '600', background: '#f0f9ff', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bae6fd' }}>
                    상위법률 ──(위임)──&gt; 대통령령 ──(세부기준)──&gt; 행정규칙
                  </span>
                </div>

                {/* 뷰 모드 1: 인터랙티브 연관 관계 그래프 (SVG Canvas) */}
                {viewMode === 'graph' ? (
                  <div style={{ padding: '20px', background: '#fafbfc' }}>
                    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
                      <svg
                        viewBox="0 0 920 220"
                        style={{ minWidth: '780px', width: '100%', height: 'auto', display: 'block' }}
                      >
                        <defs>
                          <marker
                            id="topic-arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 1 L 9 5 L 0 9 z" fill="#0284c7" />
                          </marker>
                          <filter id="node-shadow" x="-5%" y="-5%" width="110%" height="115%">
                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.06" />
                          </filter>
                        </defs>

                        {/* 계층 레이블 배경 영역 */}
                        <g opacity="0.6">
                          <rect x="20" y="10" width="260" height="200" rx="8" fill="#f0f9ff" stroke="#bae6fd" strokeDasharray="3 3" />
                          <text x="32" y="32" fontSize="11" fontWeight="700" fill="#0369a1">🏛️ 1단계: 상위법률 (국가법령)</text>

                          <rect x="330" y="10" width="260" height="200" rx="8" fill="#f0fdf4" stroke="#bbf7d0" strokeDasharray="3 3" />
                          <text x="342" y="32" fontSize="11" fontWeight="700" fill="#15803d">📘 2단계: 대통령령 (시행령)</text>

                          <rect x="640" y="10" width="260" height="200" rx="8" fill="#fffbeb" stroke="#fde68a" strokeDasharray="3 3" />
                          <text x="652" y="32" fontSize="11" fontWeight="700" fill="#b45309">📜 3단계: 행정규칙 (고시·훈령)</text>
                        </g>

                        {/* 엣지 연결선 및 위임 근거 라벨 */}
                        {t.edges.map((e, idx) => {
                          const fromX = e.from === 0 ? 280 : 590;
                          const toX = e.to === 1 ? 330 : 640;
                          const y = 110;
                          const isHovered = hoveredEdge?.topicKey === t.keyword && hoveredEdge?.edgeIdx === idx;
                          return (
                            <g
                              key={idx}
                              onMouseEnter={() => setHoveredEdge({ topicKey: t.keyword, edgeIdx: idx })}
                              onMouseLeave={() => setHoveredEdge(null)}
                              style={{ cursor: 'pointer' }}
                            >
                              <line
                                x1={fromX}
                                y1={y}
                                x2={toX - 8}
                                y2={y}
                                stroke={isHovered ? "#0284c7" : "#38bdf8"}
                                strokeWidth={isHovered ? "2.8" : "2"}
                                strokeDasharray={isHovered ? "none" : "4 2"}
                                markerEnd="url(#topic-arrow)"
                              />
                              <g transform={`translate(${(fromX + toX) / 2}, ${y - 12})`}>
                                <rect
                                  x="-42"
                                  y="-10"
                                  width="84"
                                  height="18"
                                  rx="9"
                                  fill={isHovered ? "#0284c7" : "#ffffff"}
                                  stroke="#0284c7"
                                  strokeWidth="1"
                                />
                                <text
                                  x="0"
                                  y="3"
                                  textAnchor="middle"
                                  fontSize="9.5"
                                  fontWeight="700"
                                  fill={isHovered ? "#ffffff" : "#0284c7"}
                                >
                                  {e.kind}
                                </text>
                              </g>
                            </g>
                          );
                        })}

                        {/* 노드 카드들 */}
                        {t.nodes.map((n, i) => {
                          const x = i === 0 ? 35 : i === 1 ? 345 : 655;
                          const y = 50;
                          const w = 230;
                          const h = 145;
                          const isSel = selected && sameVersion(n, selected);

                          return (
                            <g
                              key={`${n.law_id}:${n.version_id}`}
                              transform={`translate(${x}, ${y})`}
                              onClick={() => setSelected(n)}
                              style={{ cursor: 'pointer' }}
                            >
                              <rect
                                x="0"
                                y="0"
                                width={w}
                                height={h}
                                rx="8"
                                fill={isSel ? "#eff6ff" : "#ffffff"}
                                stroke={isSel ? "#0284c7" : "#cbd5e1"}
                                strokeWidth={isSel ? "2.5" : "1.2"}
                                filter="url(#node-shadow)"
                              />
                              {/* 상단 태그 */}
                              <rect
                                x="12"
                                y="12"
                                width="68"
                                height="20"
                                rx="4"
                                fill={i === 0 ? "#e0f2fe" : i === 1 ? "#dcfce7" : "#fef3c7"}
                              />
                              <text
                                x="18"
                                y="26"
                                fontSize="10"
                                fontWeight="700"
                                fill={i === 0 ? "#0369a1" : i === 1 ? "#15803d" : "#b45309"}
                              >
                                {['법률 원문', '대통령령', '고시·지침'][i]}
                              </text>
                              <text
                                x={w - 12}
                                y="26"
                                textAnchor="end"
                                fontSize="10"
                                fill="#94a3b8"
                              >
                                {n.article}
                              </text>

                              {/* 법령명 */}
                              <text
                                x="12"
                                y="54"
                                fontSize="12.5"
                                fontWeight="700"
                                fill="#0f172a"
                              >
                                {n.title.length > 15 ? `${n.title.slice(0, 14)}…` : n.title}
                              </text>

                              {/* 조문 제목/번호 */}
                              <text
                                x="12"
                                y="74"
                                fontSize="11"
                                fontWeight="600"
                                fill="#0284c7"
                              >
                                {n.article} 원문 보기 →
                              </text>

                              {/* 요약 내용 본문 미리보기 */}
                              <text
                                x="12"
                                y="96"
                                fontSize="10.5"
                                fill="#475569"
                              >
                                {n.text ? `${n.text.slice(0, 22)}…` : '조문 내용 확인'}
                              </text>
                              <text
                                x="12"
                                y="112"
                                fontSize="10"
                                fill="#64748b"
                              >
                                {n.text && n.text.length > 22 ? `${n.text.slice(22, 44)}…` : ''}
                              </text>

                              {/* 하단 시행일 */}
                              <line x1="12" y1="122" x2={w - 12} y2="122" stroke="#f1f5f9" />
                              <text
                                x="12"
                                y="136"
                                fontSize="9.5"
                                fill="#94a3b8"
                              >
                                시행: {n.effective_date || '현행'} · 버전 {n.version_id}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>

                    {/* 엣지 호버 시 표시되는 위임 근거 안내 바 */}
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        background: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <CheckCircle size={16} color="#0284c7" />
                      <div style={{ fontSize: '12px', color: '#0369a1' }}>
                        <strong>법적 위임 체계 근거: </strong>
                        {t.edges.map((e, idx) => (
                          <span key={idx} style={{ marginRight: '12px' }}>
                            [{e.kind}] {e.basis}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 뷰 모드 2: 단계별 카드 체인 */
                  <div style={{ padding: '20px' }}>
                    <div className="topic-chain" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                      {t.nodes.map((n, i) => (
                        <div key={`${n.law_id}:${n.version_id}`} style={{ position: 'relative' }}>
                          {t.edges.filter((e) => e.to === i).map((e) => (
                            <div key={e.from} className="topic-basis" style={{ marginBottom: '8px', padding: '6px 10px', background: '#f0f9ff', borderRadius: '6px', border: '1px solid #bae6fd' }}>
                              <strong style={{ fontSize: '11px', color: '#0284c7' }}>↓ {e.kind}</strong>
                              <p style={{ fontSize: '11px', color: '#334155', margin: '2px 0 0' }}>{e.basis}</p>
                            </div>
                          ))}
                          <article
                            className={`relation-card topic-law ${selected && sameVersion(n, selected) ? 'is-selected' : ''}`}
                            style={{
                              border: selected && sameVersion(n, selected) ? '2px solid #0284c7' : '1px solid #e2e8f0',
                              borderRadius: '8px',
                              padding: '14px',
                              background: selected && sameVersion(n, selected) ? '#eff6ff' : '#ffffff',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span className="topic-step-number" style={{ fontWeight: '700', fontSize: '13px', color: '#0284c7' }}>0{i + 1}단계</span>
                              <span className="pill sage" style={{ fontSize: '10px' }}>
                                {['상위법 · 법률', '하위법 · 시행령', '하위규정 · 고시'][i] || '연결 법령'}
                              </span>
                            </div>
                            <h4 style={{ fontSize: '14px', fontWeight: '700', margin: '0 0 6px' }}>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setSelected(n)}
                                style={{ textAlign: 'left', fontWeight: '700' }}
                              >
                                {n.title} {n.article} 원문 확인 →
                              </button>
                            </h4>
                            <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 8px' }}>
                              시행일: {n.effective_date || '미확인'} · 식별자: {n.version_id}
                            </p>
                            <p style={{ fontSize: '12px', color: '#334155', margin: '0 0 12px', maxHeight: '4.2em', overflow: 'hidden' }}>
                              {n.text?.split('\n')[0]}
                            </p>
                            <div className="relation-card-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button className="button secondary" onClick={() => setSelected(n)} style={{ fontSize: '12px', padding: '5px 10px' }}>
                                해당 조문 바로 읽기
                              </button>
                              {lawReaderUrl(n.source, n.version_id) && (
                                <a
                                  className="text-button"
                                  href={lawReaderUrl(n.source, n.version_id)!}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                >
                                  국가법령센터 ↗
                                </a>
                              )}
                            </div>
                          </article>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {!topics.length && (
              <div style={{ padding: '32px', textAlign: 'center', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
                <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 8px' }}>
                  입력하신 키워드 ‘<strong>{query}</strong>’에 해당하는 사전 정의 위임 주제가 없습니다.
                </p>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  상단의 추천 핵심 주제 칩을 클릭하시거나, 우측의 '실제 법령명 검색' 버튼으로 저장된 공식 법령 전문을 직접 검색하실 수 있습니다.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 실시간 법령명 검색 결과 */}
      {search && (
        <section aria-live="polite" style={{ marginTop: '24px', padding: '16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>
            ‘{search}’ 실제 법령 원문 검색 결과
          </h4>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 14px' }}>
            국가법령정보센터 공식 데이터베이스에서 저장된 법령 버전을 실시간 조회합니다.
          </p>
          {searchError ? (
            <p role="alert" style={{ color: '#dc2626', fontSize: '13px' }}>검색 결과를 불러오지 못했습니다.</p>
          ) : !results ? (
            <p role="status" style={{ fontSize: '13px', color: '#64748b' }}>법령 검색 중…</p>
          ) : results.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
              {results.map((n) => (
                <article
                  className="relation-card"
                  key={`${n.law_id}:${n.version_id}`}
                  style={{ padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#ffffff' }}
                >
                  <button
                    className="text-button"
                    onClick={() => setSelected(n)}
                    style={{ fontWeight: '700', fontSize: '13px', textAlign: 'left', display: 'block', marginBottom: '4px' }}
                  >
                    {n.title} 원문·연결 확인 →
                  </button>
                  <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                    시행일: {n.effective_date || '미확인'} · 버전: {n.version_id}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '13px', color: '#94a3b8' }}>일치하는 공식 법령이 없습니다.</p>
          )}
        </section>
      )}

      {/* 선택된 조문 상세 원문 열람기 (Legal Reader) */}
      {selected && (
        <div
          ref={reader}
          tabIndex={-1}
          className="relation-card topic-reader"
          data-testid="topic-source-reader"
          style={{
            scrollMarginTop: 24,
            marginTop: '28px',
            border: '2px solid #0284c7',
            borderRadius: '12px',
            background: '#ffffff',
            boxShadow: '0 4px 16px rgba(2, 132, 199, 0.08)',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
            <div>
              <span className="pill sage" style={{ fontSize: '11px', marginBottom: '6px', display: 'inline-block' }}>
                {selected.source === 'law' ? '공식 법률/대통령령' : '행정규칙/고시'}
              </span>
              <h4 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                {selected.title} {selected.article || ''}
              </h4>
            </div>
            <button
              className="text-button"
              onClick={() => setSelected(null)}
              style={{ fontSize: '13px', color: '#64748b' }}
            >
              열람 닫기 ✕
            </button>
          </div>

          {failed ? (
            <div role="alert" style={{ padding: '16px', background: '#fef2f2', color: '#dc2626', borderRadius: '6px' }}>
              저장 원문을 불러오지 못했습니다.{' '}
              <button className="button secondary" onClick={() => setAttempt((n) => n + 1)} style={{ marginLeft: '8px' }}>
                다시 조회
              </button>
            </div>
          ) : !document || !sameVersion(document, selected) ? (
            <p role="status" style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
              공식 저장 원문을 조회 중입니다…
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
                <span>공식 저장 원문 · 시행일 {document.effective_date || '현행'} · 버전 {document.version_id}</span>
                {sourceLink && (
                  <a href={sourceLink} target="_blank" rel="noreferrer" style={{ color: '#0284c7', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    국가법령정보센터 원문 ↗
                  </a>
                )}
              </div>

              {selected.article && !article && (
                <p style={{ fontSize: '12px', color: '#d97706', background: '#fffbeb', padding: '6px 10px', borderRadius: '4px', margin: '0 0 10px' }}>
                  해당 조문의 특정 위치를 정확히 구분하기 위해 전체 법령 전문을 표시합니다.
                </p>
              )}

              {/* 법조문 본문 렌더링 */}
              <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', background: '#f8fafc', marginBottom: '16px' }}>
                <LegalText text={article?.text || document.raw_text} />
              </div>

              <div className="relation-card-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="button primary"
                  onClick={() => onSelect(document)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <BookOpen size={15} />
                  <span>전체 조항호 3단 비교 및 실무 검토 화면 열기</span>
                </button>
                {sourceLink && (
                  <a
                    className="button secondary"
                    href={sourceLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <ExternalLink size={14} />
                    <span>국가법령정보센터 원문 보기</span>
                  </a>
                )}
              </div>

              <details style={{ marginTop: '16px', fontSize: '12px', color: '#64748b' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600' }}>원문 무결성 검증 정보 (SHA-256)</summary>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', background: '#f1f5f9', padding: '8px', borderRadius: '4px', margin: '6px 0 0' }}>
                  SHA-256: {document.raw_sha256}
                </p>
              </details>

              <details className="topic-related" style={{ marginTop: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>
                  이 법령의 다른 상·하위 인용 및 위임 관계 자세히 살펴보기
                </summary>
                <div style={{ marginTop: '12px' }}>
                  <OfficialRelations record={document} onSelect={setSelected} />
                </div>
              </details>
            </>
          )}
        </div>
      )}

      {/* 하단 범위 안내 */}
      {data && (
        <div style={{ marginTop: '24px', padding: '12px 16px', borderRadius: '6px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: 0 }}>
            🏛️ <strong>실제 법령 데이터 연동 안내:</strong> {data.scope}
          </p>
        </div>
      )}
    </section>
  );
}
