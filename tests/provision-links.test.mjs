import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeUnits,references} from '../frontend/src/provisionLinks.ts';
const units=makeUnits([{article_no:'제7조',text:'',paragraphs:[1,2].map(n=>({paragraph_no:String(n),text:'신청은 제1호에 따른다.',items:[{item_no:'1',text:'신청서'}]}))}]);
test('same item number resolves within its own paragraph',()=>{
 const a=references(units.find(n=>n.paragraph==='1'&&!n.item),units)[0];
 const b=references(units.find(n=>n.paragraph==='2'&&!n.item),units)[0];
 assert.ok(a.target);assert.ok(b.target);assert.notEqual(a.target,b.target);
});
test('external and contextual references remain unresolved',()=>{
 for(const text of ['「다른 법」 제7조제1항제1호','민법 제7조제1항제1호','같은 항 제1호','제1호부터 제2호까지']){
  assert.ok(references({...units[0],text},units).every(r=>!r.target));
 }
});
test('unknown and duplicate destinations never link',()=>{
 const u=units.find(n=>n.paragraph==='1'&&!n.item);
 assert.equal(references({...u,text:'제9호 적용'},units)[0].target,undefined);
 assert.equal(references(u,[...units,...units])[0].reason,'대상 중복');
});
test('full address resolves, deleted destination does not',()=>{
 const u={...units[0],text:'적용은 제7조제2항제1호에 따른다.'};
 assert.ok(references(u,units)[0].target);
 assert.equal(references(u,units.map(n=>({...n,deleted:true})))[0].reason,'삭제된 조문');
});
