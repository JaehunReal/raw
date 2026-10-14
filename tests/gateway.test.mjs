import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialHandler} from '../api/official.mjs';

test('Mac relay sends server credential and preserves validated search parameters', async () => {
  const original=globalThis.fetch;
  let seen;
  globalThis.fetch=async (url,options)=>{seen={url,options};return new Response('{"items":[],"total":0}',{status:200});};
  try {
    const handler=createOfficialHandler({environment:()=>({RULECRAFT_OFFICIAL_GATEWAY_URL:'https://example.com',RULECRAFT_GATEWAY_TOKEN:'test-secret'})});
    let body;const res={setHeader(){},end(v){body=v;}};
    await handler({method:'GET',url:'/api/official/laws?q=fire&limit=1',query:{route:'laws'}},res);
    assert.equal(res.statusCode,200);assert.equal(JSON.parse(body).total,0);
    assert.equal(seen.url.pathname,'/api/official/laws');assert.equal(seen.url.searchParams.get('q'),'fire');
    assert.equal(seen.options.headers.Authorization,'Bearer test-secret');assert.equal(seen.options.redirect,'error');
  } finally {globalThis.fetch=original;}
});

test('Mac relay fails closed on an insecure upstream and rejects writes',async()=>{
  const handler=createOfficialHandler({environment:()=>({RULECRAFT_OFFICIAL_GATEWAY_URL:'http://example.com',RULECRAFT_GATEWAY_TOKEN:'secret'})});
  const res={setHeader(){},end(){}};
  await handler({method:'GET',url:'/api/official/status',query:{route:'status'}},res);assert.equal(res.statusCode,503);
  await handler({method:'POST',url:'/api/official/status'},res);assert.equal(res.statusCode,405);
});

test('relay corrects legacy ordinance numbers before returning the document', async () => {
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({document:{source:'ordinance',provisions:[{article_no:'제100조',text:'제1조(목적) 본문',metadata:{original_article_no:'000100'}}]}}));
 try {
  const handler=createOfficialHandler({environment:()=>({RULECRAFT_OFFICIAL_GATEWAY_URL:'https://example.com',RULECRAFT_GATEWAY_TOKEN:'test-secret'})});
  let body;const res={setHeader(){},end(v){body=v;}};
  await handler({method:'GET',url:'/api/official/document?source=ordinance&law_id=ordinance:1&version_id=1',query:{route:'document',source:'ordinance',law_id:'ordinance:1',version_id:'1'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(body).document.provisions[0].article_no,'제1조');
 } finally {globalThis.fetch=original;}
});
