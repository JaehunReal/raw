import {useEffect,useState} from 'react';
type Law={source:'law'|'administrative'|'ordinance';law_id:string;version_id:string;title:string;effective_date:string|null;publication_date:string|null;source_url:string|null;raw_sha256:string|null;stored_at:string|null};
type Node=Law&{article:string;text:string;response_version_verified:boolean};
type Topic={keyword:string;title:string;aliases:string[];nodes:Node[];edges:{from:number;to:number;kind:string;basis:string}[]};
type Data={checked_at:string;scope:string;topics:Topic[]};
export default function TopicRelations({onSelect}:{onSelect:(law:Law)=>void}){
 const [data,setData]=useState<Data|null>(null),[query,setQuery]=useState('파기'),[error,setError]=useState(false);
 useEffect(()=>{const c=new AbortController();fetch('/official-topics.json',{signal:c.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!c.signal.aborted)setData(d);}).catch(()=>{if(!c.signal.aborted)setError(true);});return()=>c.abort();},[]);
 return <section className="panel topic-relations"><h3>키워드로 상위법·하위 규정 연결 보기</h3><p>위임 문구와 인용 조문을 대조한 관계입니다. 키워드는 탐색에 사용하고, 관계의 근거는 각 단계에 표시합니다.</p>
 <label className="relation-search">검증된 주제 검색<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="파기, 삭제, 소각…" /></label>
 {error&&<p role="alert">주제별 연결을 불러오지 못했습니다.</p>}{!data&&!error&&<p role="status">확인된 관계를 불러옵니다.</p>}
 {data&&<><p>검증된 주제 {data.topics.length}개 · {data.checked_at.slice(0,10)} 대조</p>{data.topics.filter(t=>[t.keyword,t.title,...t.aliases].some(s=>s.includes(query.trim()))).map(t=><div key={t.keyword}><h4>{t.title}</h4>{t.nodes.map((n,i)=><div key={n.law_id}>
 {i>0&&<div className="topic-basis"><strong>↓ {t.edges[i-1].kind}</strong><p>{t.edges[i-1].basis}</p></div>}
 <article className="relation-card"><span className="pill sage">{['법률 · 기본 의무','대통령령 · 방법과 절차','행정규칙 · 세부 조치'][i]}</span><h4>{n.title} {n.article}</h4><p>시행일 {n.effective_date} · 저장 버전 {n.version_id}</p><details><summary>해당 조문과 원문 근거</summary><pre>{n.text}</pre><p>원본 SHA-256: {n.raw_sha256}</p><p>API 재조회 해시 일치 · 응답 내 버전 번호 {n.response_version_verified?'확인':'미제공 또는 미확인'}</p></details><button className="button secondary" onClick={()=>onSelect(n)}>이 버전의 원문과 조항호 열기</button></article>
 </div>)}</div>)}{!data.topics.some(t=>[t.keyword,t.title,...t.aliases].some(s=>s.includes(query.trim())))&&<p>이 키워드는 아직 검증된 주제 목록에 없습니다. 전체 법령 검색 결과가 아닙니다.</p>}<p className="relation-help">{data.scope}</p></>}
 </section>;
}
