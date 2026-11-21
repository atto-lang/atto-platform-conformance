import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync(
  new URL('../contracts/atto-source-repository-parity-audit-v1.json',import.meta.url),
  'utf8'));
const expected=Object.freeze([
  'atto','net','hdl','java','realtime','rs','llvm','js',
  'forge','wasm','cranelift'].map(x=>'atto-lang/atto-source.'+x));
const sha40=/^[0-9a-f]{40}$/;

function inspect(x){
  assert.equal(x.schema,'atto.source-repository-parity-audit.v1');
  assert.equal(x.status,'AUDIT_BASELINE_NO_GUEST_CERTIFICATION');
  assert.equal(x.canonical_organization,'atto-lang');
  assert.equal(x.repository_count,expected.length);
  assert.ok(Array.isArray(x.source_repositories));
  assert.deepEqual(x.source_repositories.map(y=>y.repo),expected,
    'the registry must include each canonical source repository exactly once');
  for(const r of x.source_repositories){
    assert.equal(r.branch,'main');
    assert.match(r.observed_main_commit_sha,sha40);
    assert.equal(r.observed_sha_role,'historical-discovery-baseline-not-automatically-current');
    assert.equal(r.capability_profile,'UNASSESSED');
    assert.equal(r.guest_receipt_status,'NOT_VERIFIED_IN_THIS_REGISTRY');
    assert.equal(r.source_required_ci_status,'NOT_VERIFIED_IN_THIS_REGISTRY');
    assert.deepEqual(r.verified_guest_receipts,[]);
  }
  const features=x.feature_families;
  assert.ok(Array.isArray(features)&&features.length>=8);
  assert.equal(new Set(features.map(f=>f.id)).size,features.length,
    'duplicate feature family');
  for(const f of features){
    assert.match(f.id,/^[a-z0-9-]+$/);
    assert.equal(f.cross_backend_parity,'NOT_VERIFIED');
    assert.equal(f.applicability,'MUST_BE_ESTABLISHED_PER_BACKEND');
    assert.deepEqual(f.certified_backends,[]);
  }
  assert.deepEqual(x.certified_feature_backend_pairs,[]);
  assert.equal(x.full_parity_certified,false);
  for(const requirement of [
    'authenticated_exact_current_atto_source_head_and_tree',
    'genuinely_executed_compiler_or_aot_and_guest_steps',
    'explicit_unsupported_profile_compile_rejection_when_relevant'
  ]) assert.ok(x.required_evidence_for_parity.includes(requirement));
}

test('all eleven canonical Atto source repos are enumerated without fabricated parity',()=>{
  inspect(registry);
});
test('a missing or duplicate source repository is rejected',()=>{
  const missing=structuredClone(registry);missing.source_repositories.pop();
  assert.throws(()=>inspect(missing));
  const dup=structuredClone(registry);dup.source_repositories[1]=dup.source_repositories[0];
  assert.throws(()=>inspect(dup));
});
test('a forged guest pass or backend certification is rejected',()=>{
  const forged=structuredClone(registry);
  forged.source_repositories[0].guest_receipt_status='PASSED';
  assert.throws(()=>inspect(forged));
  const marked=structuredClone(registry);
  marked.full_parity_certified=true;
  assert.throws(()=>inspect(marked));
  const feature=structuredClone(registry);
  feature.feature_families[0].certified_backends=['java'];
  assert.throws(()=>inspect(feature));
});
test('baseline SHA cannot be replaced by an unqualified or stale pass assertion',()=>{
  const bogus=structuredClone(registry);
  bogus.source_repositories[0].observed_main_commit_sha='main';
  assert.throws(()=>inspect(bogus));
  const changed=structuredClone(registry);
  changed.source_repositories[0].observed_sha_role='verified_current_guest';
  assert.throws(()=>inspect(changed));
});
