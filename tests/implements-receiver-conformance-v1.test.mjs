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

test('executed actor-local Wasm guest receipt is exact-head scoped, without promoting portable parity',()=>{
  const evidence=JSON.parse(readFileSync(
    new URL('../evidence/implements-actor-local-rs-native-guest-20261119.json',import.meta.url),'utf8'));
  assert.equal(evidence.schema,'atto.implements.actor_local.rs_native_guest.v1');
  assert.equal(evidence.status,'PASS_SCOPED');
  assert.equal(evidence.source_pr,374);
  for(const sha of [evidence.source_sha,evidence.merged_base_sha,evidence.carrier_sha,evidence.guest.fixture_blob_sha])
    assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(evidence.source_blobs_verified,45);
  assert.equal(evidence.workflow_run_id,44456387901);
  assert.equal(evidence.workflow_job_id,135332315028);
  assert.equal(evidence.workflow_conclusion,'success');
  assert.equal(evidence.real_steps_executed,true);
  assert.deepEqual(evidence.tests,{
    isolated_rust:15,compiler_library:42,actor_receiver_rust:11,
    nominal_contract_rust:14,abstract_trait_rust:9,conformance_receipt_node:4,failed:0
  });
  assert.equal(evidence.guest.stdout,'42\n');
  assert.deepEqual(evidence.guest.bindings,['actor_init(0)','actor_receive(0,21n,1n)']);
  assert.equal(evidence.guest.wasm_deterministic,true);
  assert.equal(evidence.negative_cases.actor_missing_method_no_artifact,true);
  assert.equal(evidence.negative_cases.direct_external_actorref_method_call,'E_UNSUPPORTED');
  assert.ok(evidence.unsupported_or_unverified.includes('struct value receiver guest execution'));
  assert.ok(evidence.unsupported_or_unverified.includes('sealed state locks/critical sections'));
  assert.deepEqual(new Set(Object.values(registry.backend_status)),new Set(['NOT_EXECUTED']));
  assert.ok(registry.cases.every(c=>c.status==='NOT_EXECUTED'));
});

test('mainline-reconciled actor mtd native-to-Wasm proof stays scoped to one executable actor profile',()=>{
  const receipt=JSON.parse(readFileSync(
    new URL('../evidence/implements-actor-local-rs-mainline-20261119.json',import.meta.url),'utf8'));
  assert.equal(receipt.schema,'atto.implements.actor_local.rs_mainline_guest.v1');
  assert.equal(receipt.status,'PASS_SCOPED');
  assert.equal(receipt.source_pull_request,374);
  assert.equal(receipt.base_branch,'main');
  for(const sha of [receipt.source_head_sha,receipt.source_main_parent_sha,receipt.carrier_head_sha])
    assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(receipt.source_changed_files.length,5);
  assert.equal(receipt.run_id,44457107764);
  assert.equal(receipt.job_id,135334688118);
  assert.equal(receipt.conclusion,'success');
  assert.equal(receipt.executed_steps,true);
  assert.equal(receipt.exact_source_blobs,45);
  assert.deepEqual(receipt.tests,{
    isolated_rust:15,compiler_library:42,actor_receiver_rust:11,
    nominal_contract_rust:14,abstract_trait_rust:9,node_conformance_integrity:5,failures:0
  });
  assert.equal(receipt.actual_guest.stdout,'42\n');
  assert.equal(receipt.actual_guest.byte_identical_two_compiles,true);
  assert.deepEqual(receipt.actual_guest.functions,['actor_init(0)','actor_receive(0,21n,1n)']);
  assert.equal(receipt.negative.missing_actor_required_method,'E_IMPL_MISSING');
  assert.equal(receipt.negative.no_artifact_for_missing_actor,true);
  assert.equal(receipt.negative.external_ActorRef_mtd,'E_UNSUPPORTED');
  assert.ok(receipt.unsupported_or_unproven.includes('struct value mtd ABI'));
  assert.deepEqual(new Set(Object.values(registry.backend_status)),new Set(['NOT_EXECUTED']));
  assert.ok(registry.cases.every(c=>c.status==='NOT_EXECUTED'));
});
