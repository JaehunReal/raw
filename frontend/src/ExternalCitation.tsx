import {useEffect,useRef,useState} from 'react';
import {makeUnits,type Unit} from './provisionLinks';
import {sameLawName,type Citation} from './externalCitations';
type Law={source:string;law_id:string;version_id:string;title:string;effective_date:string|null;raw_sha256:string|null};
export default function ExternalCitation({citation}:{citation:Citation}){
 const [state,setState]=useState<'idle'|'loading'|'choose'|'result'|'error'>('idle');
 const [laws,setLaws]=useState<Law[]>([]),[result,setResult]=useState<{law:Law;unit?:Unit;reason?:string}|null>(null);
 const [truncated,setTruncated]=useState(false);const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function search(){
  controller.current?.abort();const c=new AbortController();controller.current=c;setState('loading');setResult(null);
  try{
   const r=await fetch('/api/official/laws?'+new URLSearchParams({q:citation.law,limit:'50'}),{signal:c.signal});const d=await r.json();
   if(!r.ok||!Array.isArray(d.items))throw Error();if(c.signal.aborted)return;
   setLaws(d.items.filter((l:Law)=>sameLawName(l.title,citation.law)));setTruncated(d.total>d.items.length);setState('choose');
  }catch{if(!c.signal.aborted)setState('error');}
 }
 async function select(law:Law){
  controller.current?.abort();const c=new AbortController();controller.current=c;setState('loading');
  try{
   const r=await fetch('/api/official/document?'+new URLSearchParams({source:law.source,law_id:law.law_id,version_id:law.version_id}),{signal:c.signal});const d=await r.json();
   if(!r.ok||d.document?.law_id!==law.law_id||d.document?.source!==law.source||d.document?.version_id!==law.version_id||!Array.isArray(d.document.provisions))throw Error();
   const matches=makeUnits(d.document.provisions).filter(u=>u.article===citation.article&&u.paragraph===citation.paragraph&&u.item===citation.item&&u.subitem===citation.subitem);
   if(c.signal.aborted)return;
   setResult({law:d.document,...(matches.length===1&&!matches[0].deleted?{unit:matches[0]}:{reason:matches.length>1?'대상 주소가 중복되어 연결을 보류했습니다.':matches[0]?.deleted?'선택한 버전에서 삭제된 조문입니다.':'선택한 버전에서 해당 조·항·호·목을 확인하지 못했습니다.'})});setState('result');
  }catch{if(!c.signal.aborted)setState('error');}
 }
 return <div className="external-citation"><button className="text-button" onClick={search} disabled={state==='loading'}>{citation.label} · 대상 조문 확인 ↗</button>
 {state==='loading'&&<p role="status">공식 저장 원문에서 대상 주소를 확인합니다.</p>}
 {state==='error'&&<p role="alert">조회에 실패했습니다. 위 버튼으로 다시 시도하세요.</p>}
 {state==='choose'&&<div><p>열람할 버전을 선택하세요. 인용 당시 적용 버전은 자동으로 확정하지 않습니다.</p>{laws.map(l=><button className="button secondary" key={`${l.source}:${l.law_id}:${l.version_id}`} onClick={()=>select(l)}>{l.title} · 시행일 {l.effective_date||'미확인'} · 버전 {l.version_id}</button>)}{!laws.length&&<p>이름이 정확히 일치하는 법령을 조회 범위에서 찾지 못했습니다.</p>}{truncated&&<p>검색 결과 일부만 조회했습니다. 원하는 버전이 없으면 공식 법령 검색에서 확인하세요.</p>}</div>}
 {state==='result'&&result&&<section aria-live="polite"><h5>{result.law.title} · {result.unit?.label||citation.article}</h5><p>선택 버전 {result.law.version_id} · 시행일 {result.law.effective_date||'미확인'}</p>{result.unit?<pre>{result.unit.text}</pre>:<p>{result.reason}</p>}<details><summary>대상 원본 해시</summary><p>{result.law.raw_sha256||'미확인'}</p></details><button className="text-button" onClick={search}>다른 버전 선택</button></section>}
 </div>;
}
