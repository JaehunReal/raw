import test from 'node:test';
import assert from 'node:assert/strict';
import {rankWithLaya} from '../api/laya-ranking.mjs';
const payload = {items:[{title:'건축법',source:'law'},{title:'개인정보 보호법',source:'law'}],total:2};
const env = {RULECRAFT_LAYA_URL:'https://inference.example/v1/systemone',RULECRAFT_LAYA_ENABLED:'true'};
test('unconfigured and evaluation-gated ranking never makes a request',async()=>{
 const send=()=>{throw Error('must not call');};
 assert.deepEqual((await rankWithLaya(payload,'개인정보',{},send)).items,payload.items);
 assert.equal((await rankWithLaya(payload,'개인정보',{...env,RULECRAFT_LAYA_ENABLED:'false'},send)).ranking.laya,'evaluation_required');
});
test('valid relevance responses reorder existing items and preserve metadata',async()=>{
 const out=await rankWithLaya(payload,'개인정보',env,async(url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.model,'multilingual');assert.equal(body.lang,'ko');
  return Response.json({answers:{relevant:{noul:body.state.title==='건축법'?0.1:0.9}}});
 });
 assert.equal(out.items[0],payload.items[1]);assert.equal(out.total,2);assert.equal(out.ranking.engine,'laya');
});
test('errors, invalid scores and abstention preserve original order',async()=>{
 for(const answer of [{noul:2},{noul:'0.5'},{noul:0.9,abstention:true}]){
 const out=await rankWithLaya(payload,'개인정보',env,async()=>Response.json({answers:{relevant:answer}}));
 assert.deepEqual(out.items,payload.items);assert.equal(out.ranking.laya,'unavailable');
 }
 const out=await rankWithLaya(payload,'개인정보',env,async()=>{throw Error('timeout');});
 assert.equal(out.ranking.engine,'database');
});
test('reject insecure endpoint before sending',async()=>{
 let called=false;await rankWithLaya(payload,'x',{...env,RULECRAFT_LAYA_URL:'http://example.com'},async()=>{called=true;});assert.equal(called,false);
});
