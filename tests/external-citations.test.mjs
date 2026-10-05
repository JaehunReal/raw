import {test} from 'node:test';import assert from 'node:assert/strict';
import {externalCitations,sameLawName} from '../frontend/src/externalCitations.ts';
test('extracts quoted law and exact unit address',()=>{const [c]=externalCitations('「공공기관의 운영에 관한 법률」 제 4 조 제 1 항 제 2 호 가목에 따른다.');assert.equal(c.article,'제4조');assert.equal(c.paragraph,'1');assert.equal(c.item,'2');assert.equal(c.subitem,'가');});
test('recognizes decree outside quotes without linking its parent law',()=>{assert.equal(externalCitations('「민법」 시행령 제2조')[0].law,'민법 시행령');});
test('does not guess unquoted or anaphoric names or partial branched items',()=>{for(const s of ['같은 법 제1조','민법 제1조','「법령명」 제1조제1호의2'])assert.equal(externalCitations(s).length,0);});
test('matches complete law names only',()=>{assert.ok(sameLawName('공공 기관 법','공공기관법'));assert.ok(!sameLawName('공공기관법','공공기관법 시행령'));});
