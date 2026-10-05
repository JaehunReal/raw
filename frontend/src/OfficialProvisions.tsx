import {useMemo,useState} from 'react';
import {makeUnits,references,type Provision} from './provisionLinks';
export default function OfficialProvisions({provisions}:{provisions:Provision[]}){
 const units=useMemo(()=>makeUnits(provisions),[provisions]);
 const [active,setActive]=useState('');
 function jump(id:string){setActive(id);requestAnimationFrame(()=>{const node=document.getElementById(id);node?.scrollIntoView({behavior:'smooth',block:'center'});node?.focus({preventScroll:true});});}
 if(!units.length)return <p>이 원문은 조·항·호 구조가 확인되지 않아 전체 원문으로 제공합니다.</p>;
 return <section className="official-provisions"><h3>조·항·호 원문 탐색</h3><p>공식 API에서 저장한 구조입니다. 내부 참조는 대상이 확인된 경우 이동할 수 있습니다. 다른 법령·문맥 확인이 필요한 참조는 연결을 보류합니다.</p>
 <label>조문 바로가기 <select value="" onChange={e=>jump(e.target.value)}><option value="">이동할 조·항·호 선택</option>{units.map((n,i)=><option key={i} value={n.id}>{n.label}{n.deleted?' · 삭제':''}</option>)}</select></label>
 <div className="provision-list">{units.map((n,i)=>{const refs=references(n,units);return <article key={i} id={n.id} tabIndex={-1} className={`provision-unit ${active===n.id?'selected':''}`} style={{marginLeft:Math.min(n.depth,2)*12}}>
 <h4>{n.label}{n.deleted?' · 삭제':''}</h4>
 {n.depth===0&&units.some(u=>u.article===n.article&&u.depth>0)?<details><summary>조 전체 원문</summary><pre>{n.text}</pre></details>:<pre>{n.text}</pre>}
 {!!refs.length&&<div className="provision-references"><span>원문 내 참조</span>{refs.map((r,k)=>r.target?<button key={k} onClick={()=>jump(r.target!)}>{r.text}로 이동 ↗</button>:<span key={k} className="pill neutral">{r.text} · {r.reason}</span>)}</div>}
 </article>;})}</div></section>;
}
