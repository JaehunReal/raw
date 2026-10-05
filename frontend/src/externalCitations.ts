export type Citation={law:string;article:string;paragraph:string|null;item:string|null;subitem:string|null;label:string};
export function externalCitations(text:string):Citation[]{
 const result:Citation[]=[];
 const regex=/[「『]([^」』\n]{2,180})[」』]\s*(시행령|시행규칙)?\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?(?:\s*([가-힣])목)?/g;
 for(const m of text.matchAll(regex)){
  if(/^\s*의\s*\d/.test(text.slice(m.index!+m[0].length)))continue;
  const c={law:m[1].trim()+(m[2]?' '+m[2]:''),article:m[3].replace(/\s/g,''),paragraph:m[4]||null,item:m[5]||null,subitem:m[6]||null,label:m[0]};
  if(!result.some(r=>r.label===c.label))result.push(c);
 }
 return result;
}
export const sameLawName=(a:string,b:string)=>a.replace(/\s/g,'')===b.replace(/\s/g,'');
