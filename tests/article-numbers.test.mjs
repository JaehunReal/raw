import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDocumentNumbers} from '../api/article-numbers.mjs';

test('packed ordinance identifiers: article, branch, genuine article 100; original evidence retained', () => {
  const document = {source:'ordinance', raw_sha256:'original', provisions:[
    ['000100','제100조','제1조'], ['000102','제102조','제1조의2'],
    ['010000','제10000조','제100조'], ['000000',null,null], ['100','제100조','제100조']
  ].map(([raw, number])=>({article_no:number, text:'unchanged', metadata:{original_article_no:raw}}))};
  const before=JSON.stringify(document);
  const result=normalizeDocumentNumbers(document);
  assert.deepEqual(result.provisions.map(p=>p.article_no),['제1조','제1조의2','제100조',null,'제100조']);
  assert.equal(JSON.stringify(document),before);
  assert.equal(result.provisions[0].metadata.stored_article_no,'제100조');
  assert.deepEqual(normalizeDocumentNumbers(result), result);
  assert.equal(normalizeDocumentNumbers({...document,source:'law'}).provisions,document.provisions);
});
