import { useEffect, useState } from 'react';

type Record = {
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

type Edge = {
  from: string;
  to: string;
  kind: string;
  evidence: string;
  source_version_id: string;
  source_sha256: string;
};

type Graph = {
  root: string;
  nodes: Record[];
  edges: Edge[];
  truncated: boolean;
  notice: string;
};

function extractProvisions(text: string): string[] {
  if (!text) return [];
  const pattern = /(?:제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]목)?/g;
  const matches = text.match(pattern) || [];
  const cleaned = matches.map((m) => m.replace(/\s+/g, ' ').trim());
  return Array.from(new Set(cleaned));
}

export function OfficialRelations({
  record,
  onSelect,
  onJumpCurrent,
}: {
  record: Record;
  onSelect: (record: Record, targetArticle?: string) => void;
  onJumpCurrent?: (article: string) => void;
}) {
  const [data, setData] = useState<Graph | null>(null);
  const [error, setError] = useState(false);
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    setQuery('');
    const params = new URLSearchParams({
      source: record.source,
      law_id: record.law_id,
      version_id: record.version_id,
    });
    fetch('/api/official/graph?' + params, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((g) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw Error();
        setData(g);
        setDirection(
          g.edges.some((e: Edge) => e.from === g.root) ? 'outgoing' : 'incoming'
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [record.source, record.law_id, record.version_id, attempt]);

  if (error)
    return (
      <section>
        <h3>법령 연결 살펴보기</h3>
        <p role="alert">연결 근거를 불러오지 못했습니다.</p>
        <button onClick={() => setAttempt((n) => n + 1)}>다시 조회</button>
      </section>
    );

  if (!data) return <p role="status">원문의 법령 인용 관계를 조회합니다.</p>;

  const outgoing = data.edges.filter((e) => e.from === data.root);
  const incoming = data.edges.filter((e) => e.to === data.root);
  const selected = direction === 'outgoing' ? outgoing : incoming;
  const edges = selected.filter((e) =>
    `${e.evidence} ${
      data.nodes.find((n) => n.law_id === (direction === 'outgoing' ? e.to : e.from))
        ?.title || ''
    }`.includes(query.trim())
  );

  return (
    <section
      className="official-relations relation-workspace"
      data-testid="official-relations"
    >
      <header className="relation-heading">
        <div>
          <small>원문 근거로 연결 살펴보기</small>
          <h3>어떤 법령과, 왜 연결되나요?</h3>
        </div>
        <span className="pill neutral">법령 단위 연결 {data.edges.length}건</span>
      </header>

      <div className="relation-current">
        <span>현재 보고 있는 법령</span>
        <strong>{record.title}</strong>
        <small>
          버전 {record.version_id} · 시행일 {record.effective_date || '미확인'}
        </small>
      </div>

      <div className="relation-directions" role="group" aria-label="인용 방향">
        <button
          aria-pressed={direction === 'outgoing'}
          onClick={() => setDirection('outgoing')}
        >
          이 법에서 인용 <b>{outgoing.length}</b>
        </button>
        <button
          aria-pressed={direction === 'incoming'}
          onClick={() => setDirection('incoming')}
        >
          이 법을 인용 <b>{incoming.length}</b>
        </button>
      </div>

      <p className="relation-help">
        {direction === 'outgoing'
          ? '현재 법령이 근거 문장에서 언급한 다른 법령입니다.'
          : '현재 법령을 언급한 다른 법령입니다. 변경 시 함께 살펴볼 대상입니다.'}
      </p>

      <label className="relation-search">
        연결 안에서 찾기
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="법령명 또는 근거 문장"
        />
      </label>

      <div className="relation-cards">
        {edges.map((edge, index) => {
          const target = data.nodes.find(
            (n) => n.law_id === (direction === 'outgoing' ? edge.to : edge.from)
          );
          const from =
            data.nodes.find((n) => n.law_id === edge.from)?.title || edge.from;
          const to =
            data.nodes.find((n) => n.law_id === edge.to)?.title || edge.to;
          const provisions = extractProvisions(edge.evidence);

          return (
            <article
              className="relation-card"
              key={`${edge.from}-${edge.to}-${index}`}
            >
              <div className="relation-card-top">
                <span className="pill sage">
                  {edge.kind === 'implementation_basis'
                    ? '시행 근거 법령'
                    : '원문에서 인용'}
                </span>
                {provisions.length > 0 ? (
                  <span className="pill sage">
                    언급 조문 {provisions.length}건 확인
                  </span>
                ) : (
                  <span className="pill neutral">조문 위치 미확인</span>
                )}
              </div>

              <h4>{target?.title || '연결 법령 정보 미확인'}</h4>
              <p className="relation-path">
                <span>{from}</span>
                <span aria-label="인용 방향">→</span>
                <span>{to}</span>
              </p>

              <div className="relation-evidence">
                <strong>연결 근거 · 인용한 법령의 원문 발췌</strong>
                <blockquote>
                  {edge.evidence || '근거 문장이 제공되지 않았습니다.'}
                </blockquote>
              </div>

              {/* 조·항·호 바로 이동 기능 연결 */}
              {provisions.length > 0 ? (
                <div className="relation-provisions-jump">
                  <span className="provisions-jump-title">
                    근거 조·항·호 바로 이동:
                  </span>
                  <div className="provision-jump-btns">
                    {provisions.map((prov, i) => (
                      <button
                        key={i}
                        type="button"
                        className="provision-jump-btn"
                        onClick={() => {
                          if (direction === 'outgoing' && target) {
                            onSelect(target, prov);
                          } else if (direction === 'incoming') {
                            if (onJumpCurrent) {
                              onJumpCurrent(prov);
                            } else {
                              onSelect(record, prov);
                            }
                          } else if (target) {
                            onSelect(target, prov);
                          }
                        }}
                        title={`${prov} 조문으로 바로 이동합니다`}
                      >
                        <span>{prov} 열기 ↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="relation-help">
                  근거 문장에 특정 조·항·호 번호가 명시되지 않아 법령 전체 원문으로 연결합니다.
                </p>
              )}

              <div className="relation-card-actions">
                {target && (
                  <button
                    className="button secondary"
                    onClick={() => onSelect(target)}
                  >
                    연결 법령 전체 원문 열기 →
                  </button>
                )}
                <details>
                  <summary>출처 버전·해시</summary>
                  <p>인용한 원문 버전: {edge.source_version_id}</p>
                  <p>SHA-256: {edge.source_sha256}</p>
                  {target && (
                    <p>
                      열람할 대상 버전: {target.version_id} · 시행일{' '}
                      {target.effective_date || '미확인'}
                    </p>
                  )}
                </details>
              </div>
            </article>
          );
        })}
      </div>

      {!edges.length && (
        <p className="preview-empty">
          {selected.length
            ? '검색어와 일치하는 연결이 없습니다.'
            : '이 방향으로 확인된 연결이 없습니다. 관계가 없다는 뜻은 아닙니다.'}
        </p>
      )}

      {data.truncated && (
        <p role="status">
          연결이 많아 일부만 표시합니다. 위 건수와 검색은 불러온 연결 범위에 해당합니다.
        </p>
      )}

      <details className="relation-scope">
        <summary>연결의 확인 범위</summary>
        <p>{data.notice}</p>
      </details>
    </section>
  );
}
