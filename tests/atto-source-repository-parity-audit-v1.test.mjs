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
const snapshots=new Map([
  ['atto',['5b9a274490a4567ed9d1088fd1ff304dbe383357',2]],
  ['net',['5ed2444f3526b8b6685c7be0b038bbb8e6bc6f51',1075]],
  ['hdl',['023455e496bb9cfbdd157ccc94bb69f31eec44ea',57]],
  ['java',['12ded133d89dafb21f48391e9aa3d5a7fb7f80f6',2882]],
  ['realtime',['4f6449470ab075cdad17884c7a1aee2a6e2ab54c',2]],
  ['rs',['7f893323f761e4a71e4b2e199daf75845d8f1912',1169]],
  ['llvm',['fe4f253b5932f8f00ab4a20f9b9bc2019d17553b',3063]],
  ['js',['b8e48b19c33b61e5faa4628bf03bddf2823f403d',378]],
  ['forge',['f5dd299c277376cabe9e536edbbb4e662a267ad4',332]],
  ['wasm',['16ba74ab9f9959cc15d21dcb6e54a18e1c325fef',699]],
  ['cranelift',['e867c0a5cf8b94f98ce9b1212d2c735b76bc4120',221]],
]);
const bootstrap=new Set(['atto','realtime']);

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
    const backend=r.repo.slice('atto-lang/atto-source.'.length);
    const snapshot=snapshots.get(backend);
    assert.ok(snapshot,'all backend inventory rows must have a known historical snapshot');
    assert.match(r.observed_main_tree_sha,sha40,'root tree SHA must be exact hex SHA-1');
    assert.equal(r.observed_main_tree_sha,snapshot[0],
      'the historical root tree cannot silently change or claim a new head');
    assert.equal(r.observed_main_file_count,snapshot[1],
      'historic source count must come from the complete nontruncated source Git tree');
    assert.ok(Number.isSafeInteger(r.observed_main_file_count)&&r.observed_main_file_count>0);
    assert.equal(r.implementation_surface,bootstrap.has(backend)?
      'BOOTSTRAP_DOCUMENTATION_ONLY':'NONEMPTY_SOURCE_TREE_NOT_GUEST_VERIFIED');
    assert.equal(r.executable_guest_qualified,false,'source contents do not establish guest execution');
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
  assert.equal(x.observed_tree_role,'historical-git-tree-inventory-not-live-compiler-or-guest-evidence');
  for(const requirement of [
    'authenticated_exact_current_atto_source_head_and_tree',
    'genuinely_executed_compiler_or_aot_and_guest_steps',
    'explicit_unsupported_profile_compile_rejection_when_relevant',
    'explicit_backend_bootstrap_or_compiler_stage_and_profile_qualification',
    'verified_source_root_git_tree_and_no_truncated_tree_inventory'
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

test('bootstrap-only Atto self-host and real-time are not executable guest parity',()=>{
  for(const suffix of bootstrap){
    const row=registry.source_repositories.find(r=>r.repo.endsWith('.'+suffix));
    assert.equal(row.observed_main_file_count,2);
    assert.equal(row.executable_guest_qualified,false);
    assert.equal(row.implementation_surface,'BOOTSTRAP_DOCUMENTATION_ONLY');
  }
});
test('forged root tree SHA or blob count does not satisfy repository integrity',()=>{
  const changed=structuredClone(registry);
  changed.source_repositories[0].observed_main_tree_sha='0'.repeat(40);
  assert.throws(()=>inspect(changed));
  const count=structuredClone(registry);
  count.source_repositories[0].observed_main_file_count=100;
  assert.throws(()=>inspect(count));
});
test('adding a fake guest qualification to source-only inventory fails closed',()=>{
  const x=structuredClone(registry);
  x.source_repositories[1].executable_guest_qualified=true;
  assert.throws(()=>inspect(x));
  const y=structuredClone(registry);
  y.source_repositories[3].implementation_surface='COMPILER_TESTS_PASSED';
  assert.throws(()=>inspect(y));
});
test('removing or misclassifying an 11th backend is rejected',()=>{
  const x=structuredClone(registry);
  x.source_repositories=x.source_repositories.filter(r=>!r.repo.endsWith('.realtime'));
  assert.throws(()=>inspect(x));
  const y=structuredClone(registry);
  y.source_repositories.find(r=>r.repo.endsWith('.atto')).implementation_surface='NONEMPTY_SOURCE_TREE_NOT_GUEST_VERIFIED';
  assert.throws(()=>inspect(y));
});
