import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync(new URL('../contracts/implements-receiver-conformance-v1.json',import.meta.url),'utf8'));

test('unified implements target is explicitly not guest-certified',()=>{
  assert.equal(registry.schema,'atto.implements.receiver.conformance.v1');
  assert.equal(registry.status,'TARGET_NOT_EXECUTED');
  assert.equal(registry.canonical_implements,'implements');
  assert.deepEqual(registry.owner_kinds,['actor','class','struct']);
  assert.deepEqual(registry.contract_kinds,['interface','trait']);
  assert.deepEqual(new Set(Object.values(registry.backend_status)),new Set(['NOT_EXECUTED']));
  assert.deepEqual(registry.required_gates,['parse','semantic','link','emit','guest_execute']);
});

test('case matrix covers success and fail-closed regression families for all three receiver kinds',()=>{
  const cases=registry.cases;
  assert.equal(cases.length,20);
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
  for(const owner of registry.owner_kinds){
    assert.ok(cases.some(c=>c.owner===owner && c.expect==='accept'));
    assert.ok(cases.some(c=>c.owner===owner && c.expect==='reject'));
  }
  for(const c of cases){
    assert.ok(c.source.includes('pub fnc main():'),c.id);
    assert.equal(c.status,'NOT_EXECUTED',c.id);
    assert.ok(['accept','reject'].includes(c.expect),c.id);
    if(c.expect==='reject')assert.match(c.error,/^E_[A-Z_]+$/,c.id);
    else assert.equal(c.error,undefined,c.id);
  }
});

test('out-of-line method linkage, trait defaults and declaration mismatches are explicitly covered',()=>{
  const byId=Object.fromEntries(registry.cases.map(c=>[c.id,c]));
  assert.match(byId['actor-out-of-line'].source,/pub mtd \(A self\) ping\(\): int/);
  assert.match(byId['struct-out-of-line'].source,/pub mtd \(S self\) ping\(\): int/);
  assert.match(byId['class-default'].source,/implements IPing, DefaultPing/);
  assert.match(byId['trait-ambiguous'].source,/implements DefaultPing, OtherPing/);
  assert.equal(byId['trait-ambiguous'].error,'E_IMPL_CONFLICT');
  assert.equal(byId['declare-define-mismatch'].error,'E_IMPL_SIGNATURE');
  assert.equal(byId['wrong-owner-mtd'].error,'E_IMPL_MISSING');
  assert.equal(byId['nominal-name-collision'].error,'E_DUPLICATE');
});

// HOST-ONLY source/metadata assertions. Never claim these have compiled or executed .atto.
