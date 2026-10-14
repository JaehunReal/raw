import test from 'node:test';
import assert from 'node:assert/strict';
import {lawFamilyBase, documentType, familyRecords} from '../frontend/src/lawFamily.ts';

test('ordinances and local rules never enter the national three-tier family',()=>{
 for(const title of ['대구광역시 소방공무원 보건안전 및 복지 조례','대구광역시고등학교입학전형위원회규칙']) {
  const record={source:'ordinance',title};
  assert.equal(lawFamilyBase(record),null);
  assert.match(documentType(record),/^자치법규/);
 }
 assert.equal(lawFamilyBase({source:'administrative',title:'소방공무원 보건안전 및 복지 기본법'}),null);
});
test('national family requires exact names and law source',()=>{
 const base='소방공무원 보건안전 및 복지 기본법';
 assert.equal(lawFamilyBase({source:'law',title:base+' 시행령'}),base);
 assert.equal(lawFamilyBase({source:'law',title:'관련 규정'}),null);
 const act={source:'law',title:base},decree={source:'law',title:base+' 시행령'};
 const family=familyRecords([{source:'ordinance',title:base}, {source:'law',title:base+' 시행령 일부개정 규정'},act,decree],base);
 assert.equal(family.act,act);assert.equal(family.decree,decree);assert.equal(family.rule,undefined);
});
