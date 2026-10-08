export function lawReaderUrl(source:string, version:string):string|null {
 if(!/^\d+$/.test(version))return null;
 if(source==='law')return `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${version}`;
 if(source==='administrative')return `https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=${version}`;
 return null;
}
export function sameVersion(a:{source:string;law_id:string;version_id:string},b:{source:string;law_id:string;version_id:string}){
 return a.source===b.source&&a.law_id===b.law_id&&a.version_id===b.version_id;
}
