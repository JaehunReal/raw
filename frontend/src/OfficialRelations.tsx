import {useEffect,useState} from 'react';
type Record={source:'law'|'administrative'|'ordinance';law_id:string;version_id:string;title:string;effective_date:string|null;publication_date:string|null;source_url:string|null;raw_sha256:string|null;stored_at:string|null};
type Edge={from:string;to:string;kind:string;evidence:string;source_version_id:string;source_sha256:string};
type Graph={root:string;nodes:Record[];edges:Edge[];truncated:boolean;notice:string};
export function OfficialRelations({record,onSelect}:{record:Record;onSelect:(record:Record)=>void}){
 const [data,setData]=useState<Graph|null>(null);const [error,setError]=useState(false);
 useEffect(()=>{const controller=new AbortController();setData(null);setError(false);
 const params=new URLSearchParams({source:record.source,law_id:record.law_id,version_id:record.version_id});
 fetch('/api/official/graph?'+params,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(g=>{if(!Array.isArray(g.nodes)||!Array.isArray(g.edges))throw Error();setData(g);}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();
 },[record.source,record.law_id,record.version_id]);
 if(error)return <section><h3>공식 법령 관계</h3><p role="alert">관계를 불러오지 못했습니다. 관계 색인과 서버 연결을 확인해 주세요.</p></section>;
 if(!data)return <p role="status">원문의 법령 인용 관계를 조회합니다.</p>;
 const related=data.nodes.filter(n=>n.law_id!==data.root);const height=Math.max(160,related.length*72);
 return <section className="official-relations" data-testid="official-relations"><h3>공식 법령 관계 · {data.edges.length}개 연결</h3><p>{data.notice}</p>
 {related.length>0?<><div style={{overflowX:'auto'}}><svg viewBox={`0 0 760 ${height}`} style={{minWidth:620,width:'100%'}} role="img" aria-label={`${record.title}의 실제 원문 인용 관계`}>
 <rect x="8" y={height/2-28} width="240" height="56" rx="8" fill="#e3eee9"/><text x="20" y={height/2} fontSize="13">{record.title.length>18?record.title.slice(0,18)+'…':record.title}</text>
 {related.map((n,i)=>{const edge=data.edges.find(e=>e.from===n.law_id||e.to===n.law_id)!;const y=i*72+36;return <g key={n.law_id} role="button" tabIndex={0} aria-label={`${n.title} 원문과 관계 보기`} onClick={()=>onSelect(n)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(n);}}} style={{cursor:'pointer'}}><path d={`M248 ${height/2} L450 ${y}`} stroke="#729084" fill="none"/><text x="270" y={y-7} fontSize="11">{edge.kind==='implementation_basis'?(edge.to===data.root?'하위 시행법령':'시행 근거 법령'):(edge.to===data.root?'이 법을 인용':'이 법에서 인용')}</text><rect x="450" y={y-25} width="302" height="50" rx="7" fill="#f3f5f3" stroke="#9bab9f"/><text x="461" y={y+4} fontSize="12">{n.title.length>24?n.title.slice(0,24)+'…':n.title}</text></g>;})}</svg></div>
 <details><summary>연결 근거와 버전 확인</summary>{data.edges.map((e,i)=><article key={i}><strong>{data.nodes.find(n=>n.law_id===e.from)?.title} → {data.nodes.find(n=>n.law_id===e.to)?.title}</strong><p>{e.evidence}</p><small>인용 원문 버전 {e.source_version_id} · SHA-256 {e.source_sha256}</small></article>)}</details></>:<p>색인에서 명시적인 법령명 인용을 찾지 못했습니다. 관계가 없다는 뜻은 아닙니다.</p>}
 {data.truncated&&<p>연결이 많아 일부를 표시합니다. 연결된 법령을 선택해 계속 탐색하세요.</p>}</section>;
}
