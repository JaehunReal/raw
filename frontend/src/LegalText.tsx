export default function LegalText({text}:{text:string}) {
 return <div className="legal-text">{text.split('\n').map((line,i)=>{
  const marker=line.match(/^(\s*)(제\s*\d+\s*조(?:의\s*\d+)?(?:\([^)]*\))?|[①-⑳]|\d+\.|[가-힣]\.)(\s*)/);
  return <p key={i} className={marker?'legal-line numbered':'legal-line'}>{marker?<><strong className="legal-number">{marker[0]}</strong><span>{line.slice(marker[0].length)}</span></>:line||'\u00a0'}</p>;
 })}</div>;
}
