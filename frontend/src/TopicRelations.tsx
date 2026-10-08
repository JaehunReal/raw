import LegalText from './LegalText';
import './legal-reader.css';
import {useEffect,useRef,useState} from 'react';
import {OfficialRelations} from './OfficialRelations';
import {lawReaderUrl,sameVersion} from './topicSources';
import type {Provision} from './provisionLinks';
type Law={source:'law'|'administrative'|'ordinance';law_id:string;version_id:string;title:string;effective_date:string|null;publication_date:string|null;source_url:string|null;raw_sha256:string|null;stored_at:string|null};
type Node=Law&{article?:string;text?:string};
type Topic={keyword:string;title:string;aliases:string[];nodes:Node[];edges:{from:number;to:number;kind:string;basis:string}[]};
type Data={checked_at:string;scope:string;topics:Topic[]};
type Document=Law&{raw_text:string;provisions?:Provision[]};
export default function TopicRelations({onSelect}:{onSelect:(law:Law)=>void}){
 const [data,setData]=useState<Data|null>(null),[query,setQuery]=useState('파기'),[error,setError]=useState(false);
 const [selected,setSelected]=useState<Node|null>(null),[document,setDocument]=useState<Document|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const [search,setSearch]=useState(''),[results,setResults]=useState<Law[]|null>(null),[searchError,setSearchError]=useState(false);
 const reader=useRef<HTMLDivElement>(null);
 useEffect(()=>{const c=new AbortController();fetch('/official-topics.json',{signal:c.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!c.signal.aborted)setData(d);}).catch(()=>{if(!c.signal.aborted)setError(true);});return()=>c.abort();},[]);
 useEffect(()=>{
  if(!selected)return;const c=new AbortController();setDocument(null);setFailed(false);
  reader.current?.scrollIntoView({block:'start'});reader.current?.focus({preventScroll:true});
  const p=new URLSearchParams({source:selected.source,law_id:selected.law_id,version_id:selected.version_id});
  fetch('/api/official/document?'+p,{signal:c.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const d=(await r.json()).document;if(!d||!sameVersion(d,selected)||typeof d.raw_text!=='string')throw Error();return d;}).then(d=>{if(!c.signal.aborted)setDocument(d);}).catch(()=>{if(!c.signal.aborted)setFailed(true);});return()=>c.abort();
 },[selected,attempt]);
 useEffect(()=>{
  if(!search)return;const c=new AbortController();setResults(null);setSearchError(false);
  fetch('/api/official/laws?'+new URLSearchParams({q:search,limit:'20',offset:'0'}),{signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.items))throw Error();return d.items;}).then(d=>{if(!c.signal.aborted)setResults(d);}).catch(()=>{if(!c.signal.aborted)setSearchError(true);});return()=>c.abort();
 },[search]);
 const topics=data?.topics.filter(t=>[t.keyword,t.title,...t.aliases].some(s=>s.includes(query.trim())))||[];
 const sourceLink=document?lawReaderUrl(document.source,document.version_id):null;
 const article=document?.provisions?.find(p=>p.article_no.replace(/\s/g,'')===selected?.article?.replace(/\s/g,''));
 return <section className="panel topic-relations"><h3>키워드로 실제 법령·하위규정 확인</h3><p>법령을 선택하면 이 자리에서 저장된 공식 원문을 조회합니다. 위임 관계의 근거와 해당 조문을 함께 확인하세요.</p>
 <form onSubmit={e=>{e.preventDefault();setSearch(query.trim());}}><label className="relation-search">키워드 또는 법령명<input maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} placeholder="파기, 개인정보, 기록물…" /></label><button className="button secondary" disabled={!query.trim()}>실제 법령명 검색</button></form>
 {error&&<p role="alert">주제별 연결을 불러오지 못했습니다. 법령명 검색은 이용할 수 있습니다.</p>}
 {data&&<><p>근거를 대조한 주제 {data.topics.length}개 · {data.checked_at.slice(0,10)} 기준</p>{topics.map(t=><div key={t.keyword}><h4 className="topic-title">{t.title} <small>법률 → 시행령 → 세부기준</small></h4><div className="topic-chain">{t.nodes.map((n,i)=><div className="topic-step" key={`${n.law_id}:${n.version_id}`}>
 {t.edges.filter(e=>e.to===i).map(e=><div className="topic-basis" key={e.from}><strong>↓ {e.kind}</strong><p>{e.basis}</p></div>)}
 <article className={`relation-card topic-law ${selected&&sameVersion(n,selected)?'is-selected':''}`}><span className="topic-step-number">0{i+1}</span><span className="pill sage">{['상위법 · 법률','하위법 · 시행령','하위규정 · 고시'][i]||'연결 법령'}</span><h4><button className="text-button" onClick={()=>setSelected(n)}>{n.title} {n.article} 원문 확인 →</button></h4><p>시행일 {n.effective_date||'미확인'} · 버전 {n.version_id}</p><p>{n.text?.split('\n')[0]}</p><div className="relation-card-actions"><button className="button secondary" onClick={()=>setSelected(n)}>해당 조문 바로 읽기</button>{lawReaderUrl(n.source,n.version_id)&&<a className="text-button" href={lawReaderUrl(n.source,n.version_id)!} target="_blank" rel="noreferrer">국가법령정보센터에서 확인 ↗</a>}</div></article>
 </div>)}</div></div>)}{!topics.length&&<p>이 키워드의 위임 관계는 아직 대조되지 않았습니다. 법령명으로 검색해 실제 원문과 인용 관계를 확인할 수 있습니다.</p>}</>}
 {search&&<section aria-live="polite"><h4>‘{search}’ 실제 법령명 검색</h4><p>저장된 법령 제목에서 최대 20개 버전을 표시합니다. 본문 키워드 검색이나 상하위 관계 판정 결과는 아닙니다.</p>{searchError?<p role="alert">검색을 불러오지 못했습니다.</p>:!results?<p role="status">법령 검색 중…</p>:results.length?results.map(n=><article className="relation-card" key={`${n.law_id}:${n.version_id}`}><button className="text-button" onClick={()=>setSelected(n)}>{n.title} 원문·연결 확인 →</button><p>시행일 {n.effective_date||'미확인'} · 버전 {n.version_id}</p></article>):<p>법령명에 일치하는 저장 원문이 없습니다.</p>}</section>}
 {selected&&<div ref={reader} tabIndex={-1} className="relation-card topic-reader" data-testid="topic-source-reader" style={{scrollMarginTop:24}}><h4>{selected.title} {selected.article||''}</h4><button className="text-button" onClick={()=>setSelected(null)}>열람 닫기</button>{failed?<div role="alert">저장 원문을 불러오지 못했습니다. <button onClick={()=>setAttempt(n=>n+1)}>다시 조회</button></div>:!document||!sameVersion(document,selected)?<p role="status">실제 저장 원문 조회 중…</p>:<><p>공식 저장 원문 · 시행일 {document.effective_date||'미확인'} · 버전 {document.version_id}</p>{selected.article&&!article&&<p>이 버전의 조문 위치를 특정하지 못해 전체 원문을 표시합니다.</p>}<LegalText text={article?.text||document.raw_text}/><div className="relation-card-actions">{sourceLink&&<a href={sourceLink} target="_blank" rel="noreferrer">국가법령정보센터 원문 ↗</a>}<button className="button secondary" onClick={()=>onSelect(document)}>전체 조항호·검토 화면 열기</button></div><details><summary>원문 검증 정보</summary><p>SHA-256: {document.raw_sha256}</p></details><details className="topic-related"><summary>이 법령의 다른 인용 관계 살펴보기</summary><OfficialRelations record={document} onSelect={setSelected}/></details></>}</div>}
 {data&&<details><summary>관계 확인 범위</summary><p>{data.scope}</p></details>}
 </section>;
}
