import LegalText from './LegalText';
import './legal-reader.css';
import ExternalCitation from './ExternalCitation';
import {externalCitations} from './externalCitations';
import {useMemo,useState} from 'react';
import {makeUnits,references,type Provision} from './provisionLinks';
export default function OfficialProvisions({provisions}:{provisions:Provision[]}){
 const units=useMemo(()=>makeUnits(provisions),[provisions]);
 const [active,setActive]=useState('');
 function jump(id:string){setActive(id);requestAnimationFrame(()=>{const node=document.getElementById(id);node?.scrollIntoView({behavior:'smooth',block:'center'});node?.focus({preventScroll:true});});}
 if(!units.length)return <p>이 원문은 조·항·호 구조가 확인되지 않아 전체 원문으로 제공합니다.</p>;
 return <section className="official-provisions"><h3>조·항·호 원문 탐색</h3><p>공식 API에서 저장한 구조입니다. 내부 참조는 대상이 확인된 경우 이동할 수 있습니다. 다른 법령의 명시적 인용은 버전을 선택해 대상 조문을 확인할 수 있습니다. 문맥이 불명확한 참조는 연결을 보류합니다.</p>
 <label>조문 바로가기 <select value="" onChange={e=>jump(e.target.value)}><option value="">이동할 조·항·호 선택</option>{units.map((n,i)=><option key={i} value={n.id}>{n.label}{n.deleted?' · 삭제':''}</option>)}</select></label>
 <div className="provision-list">{units.map((n,i)=>{const refs=references(n,units);return <article key={i} id={n.id} tabIndex={-1} className={`provision-unit ${active===n.id?'selected':''}`} style={{marginLeft:Math.min(n.depth,2)*12}}>
 <h4><span className="provision-level">{['조','항','호','목'][n.depth]}</span>{n.label}{n.deleted?' · 삭제':''}</h4>
 {n.depth===0&&units.some(u=>u.article===n.article&&u.depth>0)?<details><summary>조 전체 원문</summary><LegalText text={n.text}/></details>:<LegalText text={n.text}/>}
 {!!refs.length&&<div className="provision-references"><span>원문 내 참조</span>{refs.map((r,k)=>r.target?<button key={k} onClick={()=>jump(r.target!)}>{r.text} 열기 ↗</button>:<span key={k} className="pill neutral">{r.text} · {r.reason}</span>)}</div>}
 {externalCitations(n.text).map(c=><ExternalCitation key={c.label} citation={c} />)}
 </article>;})}</div></section>;
}
