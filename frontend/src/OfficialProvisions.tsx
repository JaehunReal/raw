import LegalText from './LegalText';
import './legal-reader.css';
import ExternalCitation from './ExternalCitation';
import { externalCitations } from './externalCitations';
import { useMemo, useState, useEffect } from 'react';
import { makeUnits, references, type Provision, type Unit } from './provisionLinks';
import { BookOpen, ExternalLink, ArrowRight, Layers } from 'lucide-react';

export type LawRecord = {
  source: 'law' | 'administrative' | 'ordinance';
  law_id: string;
  version_id: string;
  title: string;
  effective_date?: string | null;
  publication_date?: string | null;
  source_url?: string | null;
  raw_sha256?: string | null;
  stored_at?: string | null;
};

type ThreeTierMember = {
  record: LawRecord;
  provisions: Provision[];
};

type ThreeTierFamily = {
  baseName: string;
  act?: ThreeTierMember;
  decree?: ThreeTierMember;
  rule?: ThreeTierMember;
  loading: boolean;
};

function parseBaseLawName(title: string): string {
  if (!title) return '';
  return title
    .replace(/\s*(시행령|시행규칙|규칙|지침)$/, '')
    .replace(/^「|」$/g, '')
    .trim();
}

function extractArticleTitle(p: Provision): string {
  if (p.title) return p.title.replace(/[()]/g, '').trim();
  const m = p.text.match(/^제\s*\d+\s*조(?:의\s*\d+)?\s*\(([^)]+)\)/);
  return m ? m[1].replace(/[()]/g, '').trim() : '';
}

function findMatches(
  targetArticle: string,
  targetTitle: string,
  targetText: string,
  provisions: Provision[],
  familyType: 'decree' | 'rule' | 'act'
): Provision[] {
  if (!provisions || !provisions.length) return [];
  const cleanTargetNo = targetArticle.replace(/\s+/g, '');
  const cleanTargetTitle = targetTitle.replace(/[()]/g, '').trim();

  // 1. Direct reference in text
  const matches = provisions.filter((p) => {
    const t = p.text;
    const mentionsLawArt =
      t.includes('법 ' + targetArticle) ||
      t.includes('법' + targetArticle) ||
      t.includes('법 제' + targetArticle.replace(/^제/, '')) ||
      t.includes('법제' + targetArticle.replace(/^제/, ''));

    const mentionsDecreeArt =
      t.includes('영 ' + targetArticle) ||
      t.includes('영' + targetArticle) ||
      t.includes('영 제' + targetArticle.replace(/^제/, '')) ||
      t.includes('영제' + targetArticle.replace(/^제/, ''));

    const sameArtAndTitle =
      p.article_no.replace(/\s+/g, '') === cleanTargetNo &&
      cleanTargetTitle &&
      extractArticleTitle(p) === cleanTargetTitle;

    return mentionsLawArt || mentionsDecreeArt || sameArtAndTitle;
  });

  if (matches.length > 0) return matches;

  // 2. Fallback: match by title if meaningful
  if (cleanTargetTitle && cleanTargetTitle.length >= 2 && cleanTargetTitle !== '목적' && cleanTargetTitle !== '정의') {
    const titleMatches = provisions.filter((p) => {
      const pTitle = extractArticleTitle(p);
      return pTitle && (pTitle.includes(cleanTargetTitle) || cleanTargetTitle.includes(pTitle));
    });
    if (titleMatches.length > 0) return titleMatches;
  }

  // 3. Fallback: match by same article_no (e.g. 제1조(목적))
  const sameArt = provisions.filter((p) => p.article_no.replace(/\s+/g, '') === cleanTargetNo);
  if (sameArt.length > 0) return sameArt;

  return [];
}

export default function OfficialProvisions({
  provisions,
  initialArticle,
  currentLaw,
  onSelectLaw,
}: {
  provisions: Provision[];
  initialArticle?: string | null;
  currentLaw?: LawRecord | null;
  onSelectLaw?: (law: LawRecord, targetArticle?: string) => void;
}) {
  const units = useMemo(() => makeUnits(provisions), [provisions]);
  const [active, setActive] = useState('');
  const [family, setFamily] = useState<ThreeTierFamily | null>(null);

  function jump(id: string) {
    setActive(id);
    requestAnimationFrame(() => {
      const node = document.getElementById(id);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.focus({ preventScroll: true });
    });
  }

  // initialArticle이 전달되면 해당 조문으로 자동 스크롤 및 하이라이트
  useEffect(() => {
    if (!initialArticle || !units.length) return;
    const cleanTarget = initialArticle.replace(/\s+/g, '');
    const exact = units.find((u) => u.label.replace(/\s+/g, '') === cleanTarget);
    const byArticle = units.find((u) => cleanTarget.startsWith(u.article.replace(/\s+/g, '')));
    const match = exact || byArticle;
    if (match) {
      const timer = setTimeout(() => jump(match.id), 120);
      return () => clearTimeout(timer);
    }
  }, [initialArticle, units]);

  // Load 3-Tier Law Family (법·시행령·시행규칙)
  useEffect(() => {
    if (!currentLaw) {
      setFamily(null);
      return;
    }
    const baseName = parseBaseLawName(currentLaw.title);
    if (!baseName) return;

    const controller = new AbortController();

    async function loadThreeTier() {
      try {
        const listRes = await fetch(
          `/api/official/laws?q=${encodeURIComponent(baseName)}&limit=10`,
          { signal: controller.signal }
        );
        if (!listRes.ok) return;
        const listData = await listRes.json();
        const items: LawRecord[] = listData.items || [];

        // Match Act, Decree, Rule
        const actMeta = items.find(
          (x) =>
            x.title === baseName ||
            (x.title.startsWith(baseName) &&
              !x.title.includes('시행령') &&
              !x.title.includes('시행규칙'))
        );
        const decreeMeta = items.find(
          (x) => x.title.includes('시행령') && x.title.includes(baseName)
        );
        const ruleMeta = items.find(
          (x) => x.title.includes('시행규칙') && x.title.includes(baseName)
        );

        const currentId = `${currentLaw?.source}:${currentLaw?.law_id}:${currentLaw?.version_id}`;

        // Fetch documents in parallel if not current
        const fetchDoc = async (meta?: LawRecord): Promise<ThreeTierMember | undefined> => {
          if (!meta) return undefined;
          const metaId = `${meta.source}:${meta.law_id}:${meta.version_id}`;
          if (metaId === currentId) {
            return { record: meta, provisions };
          }
          try {
            const res = await fetch(
              `/api/official/document?source=${meta.source}&law_id=${meta.law_id}&version_id=${meta.version_id}`,
              { signal: controller.signal }
            );
            if (!res.ok) return undefined;
            const docData = await res.json();
            return {
              record: meta,
              provisions: docData.document?.provisions || [],
            };
          } catch {
            return undefined;
          }
        };

        const [actMember, decreeMember, ruleMember] = await Promise.all([
          fetchDoc(actMeta),
          fetchDoc(decreeMeta),
          fetchDoc(ruleMeta),
        ]);

        if (!controller.signal.aborted) {
          setFamily({
            baseName,
            act: actMember,
            decree: decreeMember,
            rule: ruleMember,
            loading: false,
          });
        }
      } catch {
        // Ignore aborts or errors
      }
    }

    loadThreeTier();
    return () => controller.abort();
  }, [currentLaw?.law_id, currentLaw?.version_id, provisions]);

  if (!units.length)
    return <p>이 원문은 조·항·호 구조가 확인되지 않아 전체 원문으로 제공합니다.</p>;

  const isCurrentAct =
    family?.act &&
    `${currentLaw?.source}:${currentLaw?.law_id}` ===
      `${family.act.record.source}:${family.act.record.law_id}`;

  const isCurrentDecree =
    family?.decree &&
    `${currentLaw?.source}:${currentLaw?.law_id}` ===
      `${family.decree.record.source}:${family.decree.record.law_id}`;

  const isCurrentRule =
    family?.rule &&
    `${currentLaw?.source}:${currentLaw?.law_id}` ===
      `${family.rule.record.source}:${family.rule.record.law_id}`;

  return (
    <section className="official-provisions">
      <h3>조·항·호 원문 탐색</h3>
      <p>
        공식 API에서 저장한 구조입니다. 내부 참조는 대상이 확인된 경우 이동할 수 있습니다.
        다른 법령의 명시적 인용은 버전을 선택해 대상 조문을 확인할 수 있습니다.
      </p>

      {/* 3단 체계 퀵 네비게이션 바 */}
      {family && (family.act || family.decree || family.rule) && (
        <div className="three-tier-quickbar">
          <div className="quickbar-label">
            <span>⚖️</span>
            <strong>법령 3단 체계:</strong>
          </div>
          <div className="quickbar-items">
            {family.act && (
              <button
                type="button"
                className={`quickbar-btn ${isCurrentAct ? 'active' : ''}`}
                onClick={() =>
                  onSelectLaw?.(family.act!.record, initialArticle || '제1조')
                }
              >
                🏛️ 법률 ({family.act.record.title})
                {isCurrentAct && <span className="btn-tag">열람 중</span>}
              </button>
            )}
            {family.decree ? (
              <button
                type="button"
                className={`quickbar-btn ${isCurrentDecree ? 'active' : ''}`}
                onClick={() => onSelectLaw?.(family.decree!.record, '제1조')}
              >
                📜 시행령 ({family.decree.record.title})
                {isCurrentDecree && <span className="btn-tag">열람 중</span>}
              </button>
            ) : (
              <span className="quickbar-disabled">📜 시행령 (없음)</span>
            )}
            {family.rule ? (
              <button
                type="button"
                className={`quickbar-btn ${isCurrentRule ? 'active' : ''}`}
                onClick={() => onSelectLaw?.(family.rule!.record, '제1조')}
              >
                📋 시행규칙 ({family.rule.record.title})
                {isCurrentRule && <span className="btn-tag">열람 중</span>}
              </button>
            ) : (
              <span className="quickbar-disabled">📋 시행규칙 (없음)</span>
            )}
          </div>
        </div>
      )}

      {/* 조·항·호 점프 드롭다운: () 안에 주제까지 표기 */}
      <label>
        조문 바로가기{' '}
        <select value="" onChange={(e) => jump(e.target.value)}>
          <option value="">이동할 조·항·호 선택</option>
          {units.map((n, i) => (
            <option key={i} value={n.id}>
              {n.fullLabel}
              {n.deleted ? ' · 삭제' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="provision-list">
        {units.map((n, i) => {
          const refs = references(n, units);
          return (
            <article
              key={i}
              id={n.id}
              tabIndex={-1}
              className={`provision-unit ${active === n.id ? 'selected' : ''}`}
              style={{ marginLeft: Math.min(n.depth, 2) * 12 }}
            >
              {/* 조문 헤더: () 안에 주제 포함 표기 */}
              <h4>
                <span className="provision-level">
                  {['조', '항', '호', '목'][n.depth]}
                </span>
                {n.fullLabel}
                {n.deleted ? ' · 삭제' : ''}
              </h4>

              {n.depth === 0 &&
              units.some((u) => u.article === n.article && u.depth > 0) ? (
                <details>
                  <summary>조 전체 원문</summary>
                  <LegalText text={n.text} />
                </details>
              ) : (
                <LegalText text={n.text} />
              )}

              {/* 내부 참조 */}
              {!!refs.length && (
                <div className="provision-references">
                  <span>원문 내 참조</span>
                  {refs.map((r, k) =>
                    r.target ? (
                      <button key={k} onClick={() => jump(r.target!)}>
                        {r.text} 열기 ↗
                      </button>
                    ) : (
                      <span key={k} className="pill neutral">
                        {r.text} · {r.reason}
                      </span>
                    )
                  )}
                </div>
              )}

              {/* 외부 법령 인용 */}
              {externalCitations(n.text).map((c) => (
                <ExternalCitation key={c.label} citation={c} />
              ))}

              {/* 그 조항 아랫단에 3단으로 보여주는 3단 비교 카드 (조문 단위 n.depth === 0) */}
              {n.depth === 0 && family && (
                <ThreeTierArticleCard
                  articleUnit={n}
                  family={family}
                  isCurrentAct={!!isCurrentAct}
                  isCurrentDecree={!!isCurrentDecree}
                  isCurrentRule={!!isCurrentRule}
                  onSelectLaw={onSelectLaw}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 각 조항 하단에 렌더링되는 3단 비교 카드 컴포넌트
 * [법률] - [시행령] - [시행규칙]
 */
function ThreeTierArticleCard({
  articleUnit,
  family,
  isCurrentAct,
  isCurrentDecree,
  isCurrentRule,
  onSelectLaw,
}: {
  articleUnit: Unit;
  family: ThreeTierFamily;
  isCurrentAct: boolean;
  isCurrentDecree: boolean;
  isCurrentRule: boolean;
  onSelectLaw?: (law: LawRecord, targetArticle?: string) => void;
}) {
  const [selectedDecreeIdx, setSelectedDecreeIdx] = useState(0);
  const [selectedRuleIdx, setSelectedRuleIdx] = useState(0);

  // Match decree and rule provisions
  const decreeMatches = useMemo(() => {
    if (!family.decree?.provisions.length) return [];
    return findMatches(
      articleUnit.article,
      articleUnit.articleTitle,
      articleUnit.text,
      family.decree.provisions,
      'decree'
    );
  }, [family.decree, articleUnit]);

  const ruleMatches = useMemo(() => {
    if (!family.rule?.provisions.length) return [];
    return findMatches(
      articleUnit.article,
      articleUnit.articleTitle,
      articleUnit.text,
      family.rule.provisions,
      'rule'
    );
  }, [family.rule, articleUnit]);

  // Active matched provision
  const activeDecree = decreeMatches[selectedDecreeIdx] || decreeMatches[0];
  const activeRule = ruleMatches[selectedRuleIdx] || ruleMatches[0];

  return (
    <div className="three-tier-card">
      <div className="three-tier-header">
        <div className="three-tier-header-left">
          <span className="three-tier-icon">⚖️</span>
          <strong className="three-tier-title">법·시행령·시행규칙 3단 연계</strong>
          <span className="three-tier-sub">
            {articleUnit.article}{articleUnit.articleTitle ? `(${articleUnit.articleTitle})` : ''} 기준 3단비교
          </span>
        </div>
        <span className="pill neutral" style={{ fontSize: '11px', fontWeight: 600 }}>
          3단 비교 체계
        </span>
      </div>

      <div className="three-tier-grid">
        {/* 1단: 법률 */}
        <div className={`three-tier-col ${isCurrentAct ? 'current' : ''}`}>
          <div className="three-tier-col-header">
            <span className="col-level-badge act">🏛️ 법률</span>
            <span className="col-law-title">{family.act?.record.title || `${family.baseName}`}</span>
            {isCurrentAct && <span className="col-current-tag">현재 열람</span>}
          </div>
          <div className="three-tier-col-content">
            <div className="three-tier-article-label">
              {articleUnit.article}{articleUnit.articleTitle ? `(${articleUnit.articleTitle})` : ''}
            </div>
            <div className="three-tier-snippet">
              {articleUnit.text ? articleUnit.text.slice(0, 140) + '...' : '(원문 본문)'}
            </div>
          </div>
          {family.act && !isCurrentAct && (
            <button
              type="button"
              className="three-tier-jump-btn"
              onClick={() => onSelectLaw?.(family.act!.record, articleUnit.article)}
            >
              법률 해당 조문으로 이동 ↗
            </button>
          )}
        </div>

        {/* 2단: 시행령 */}
        <div className={`three-tier-col ${isCurrentDecree ? 'current' : ''}`}>
          <div className="three-tier-col-header">
            <span className="col-level-badge decree">📜 시행령</span>
            <span className="col-law-title">
              {family.decree?.record.title || `${family.baseName} 시행령`}
            </span>
            {isCurrentDecree && <span className="col-current-tag">현재 열람</span>}
          </div>
          <div className="three-tier-col-content">
            {decreeMatches.length > 0 ? (
              <>
                {decreeMatches.length > 1 && (
                  <div className="three-tier-pills">
                    {decreeMatches.map((dm, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`three-tier-pill ${selectedDecreeIdx === idx ? 'selected' : ''}`}
                        onClick={() => setSelectedDecreeIdx(idx)}
                      >
                        {dm.article_no}{dm.title ? `(${dm.title})` : ''}
                      </button>
                    ))}
                  </div>
                )}
                <div className="three-tier-article-label">
                  {activeDecree?.article_no}
                  {activeDecree?.title ? `(${activeDecree.title})` : ''}
                </div>
                <div className="three-tier-snippet">
                  {activeDecree?.text ? activeDecree.text.slice(0, 140) + '...' : '(시행령 본문)'}
                </div>
              </>
            ) : family.decree ? (
              <div className="three-tier-empty">(직접 위임 조항 없음)</div>
            ) : (
              <div className="three-tier-empty">(시행령 규정 없음)</div>
            )}
          </div>
          {family.decree && (
            <button
              type="button"
              className={`three-tier-jump-btn ${isCurrentDecree ? 'secondary' : ''}`}
              onClick={() =>
                onSelectLaw?.(
                  family.decree!.record,
                  activeDecree ? activeDecree.article_no : '제1조'
                )
              }
            >
              {activeDecree
                ? `시행령 ${activeDecree.article_no} 바로가기 ↗`
                : '시행령 전체 열람 ↗'}
            </button>
          )}
        </div>

        {/* 3단: 시행규칙 */}
        <div className={`three-tier-col ${isCurrentRule ? 'current' : ''}`}>
          <div className="three-tier-col-header">
            <span className="col-level-badge rule">📋 시행규칙</span>
            <span className="col-law-title">
              {family.rule?.record.title || `${family.baseName} 시행규칙`}
            </span>
            {isCurrentRule && <span className="col-current-tag">현재 열람</span>}
          </div>
          <div className="three-tier-col-content">
            {ruleMatches.length > 0 ? (
              <>
                {ruleMatches.length > 1 && (
                  <div className="three-tier-pills">
                    {ruleMatches.map((rm, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`three-tier-pill ${selectedRuleIdx === idx ? 'selected' : ''}`}
                        onClick={() => setSelectedRuleIdx(idx)}
                      >
                        {rm.article_no}{rm.title ? `(${rm.title})` : ''}
                      </button>
                    ))}
                  </div>
                )}
                <div className="three-tier-article-label">
                  {activeRule?.article_no}
                  {activeRule?.title ? `(${activeRule.title})` : ''}
                </div>
                <div className="three-tier-snippet">
                  {activeRule?.text ? activeRule.text.slice(0, 140) + '...' : '(시행규칙 본문)'}
                </div>
              </>
            ) : family.rule ? (
              <div className="three-tier-empty">(직접 위임 조항 없음)</div>
            ) : (
              <div className="three-tier-empty">(시행규칙 규정 없음)</div>
            )}
          </div>
          {family.rule && (
            <button
              type="button"
              className={`three-tier-jump-btn ${isCurrentRule ? 'secondary' : ''}`}
              onClick={() =>
                onSelectLaw?.(
                  family.rule!.record,
                  activeRule ? activeRule.article_no : '제1조'
                )
              }
            >
              {activeRule
                ? `시행규칙 ${activeRule.article_no} 바로가기 ↗`
                : '시행규칙 전체 열람 ↗'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
