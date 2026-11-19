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
  assert.equal(cases.length,29);
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
  for(const owner of ['class','actor','struct'])assert.equal(byId[owner+'-required-trait-missing'].error,'E_IMPL_MISSING');
  for(const id of ['class-out-of-line','actor-required-trait-mtd','struct-required-trait-mtd'])assert.equal(byId[id].expect,'accept');
  assert.equal(byId['trait-conflict-explicit-mtd'].expect,'accept');
});

// HOST-ONLY source/metadata assertions. Never claim these have compiled or executed .atto.

test('focused Rust-native compiled guest receipt is scoped and cannot silently promote portable parity',()=>{
  const receipt = JSON.parse(readFileSync(
    new URL('../evidence/implements-rs-native-guest-20261119.json',import.meta.url),'utf8'));
  assert.equal(receipt.schema,'atto.implements.focused.rs-native-guest.v1');
  assert.equal(receipt.status,'PASS_SCOPED');
  assert.equal(receipt.source_repo,'atto-lang/atto-source.rs');
  assert.equal(receipt.source_pr,369);
  for(const sha of [receipt.source_head_sha,receipt.carrier_head_sha])
    assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(receipt.source_blobs_count,42);
  assert.equal(receipt.source_blobs_verified,true);
  assert.equal(receipt.github_actions_conclusion,'success');
  assert.equal(receipt.job_steps_executed,true);
  assert.equal(receipt.workflow_run_id,44453297940);
  assert.equal(receipt.workflow_job_id,135322214752);
  assert.deepEqual(receipt.tests,{
    isolated_module:{passed:15,failed:0},
    compiler_lib:{passed:40,failed:0},
    actor_struct_contract:{passed:14,failed:0},
    abstract_trait_contract:{passed:9,failed:0}
  });
  assert.equal(receipt.guest.return_value,'42n');
  assert.equal(receipt.guest.two_compilation_outputs_byte_identical,true);
  assert.equal(receipt.negative_guests.length,3);
  assert.ok(receipt.negative_guests.every(x=>x.no_artifact));
  assert.ok(receipt.unproven.includes('general actor mtd guest ABI'));
  assert.ok(receipt.unproven.includes('struct value mtd guest ABI'));
  assert.deepEqual(new Set(Object.values(registry.backend_status)),new Set(['NOT_EXECUTED']));
  assert.ok(registry.cases.every(c=>c.status==='NOT_EXECUTED'));
});
