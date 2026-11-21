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
  ['atto',['7a732a5679ab98b723a23f5b0f2fe6a0cd58260e',2]],
  ['net',['4dd3f5daa5ed88c454ee02076722a0ab02798ecf',1075]],
  ['hdl',['271f3a99177fcd1f2d306a503e272c9d87c132da',57]],
  ['java',['4e077154967954602266aeae1294e3b0b45c4892',2882]],
  ['realtime',['20a219f24ea86b5d7e11a8164940b5e51d225c44',2]],
  ['rs',['284d3fb4ebbb4b48659384722fb7ef1900c8a205',1169]],
  ['llvm',['2e66a51ce3d8b8c4ed952c9bcdc389036eca7e9e',3063]],
  ['js',['0a249dcfde92d4b6a77bf3ac0da156a7c7ce87a3',378]],
  ['forge',['64b4f425a556f0066cd580e23f8176464c86107b',332]],
  ['wasm',['9da8bab4b3b1d71a5594a4bab65d9dd204034b8a',699]],
  ['cranelift',['7eaa77255a7187802b89209fe7e286a3d99421ca',221]],
]);
const bootstrap=new Set(['atto','realtime']);
const expectedFeatureIds=Object.freeze([
  'explicit-lambda-delimiters','try-catch-finally-dual-syntax',
  'maybe-option-result-control-flow','ownership-bang-and-borrow-checking',
  'sealed-actor-state-and-critical-projections','actor-groups-and-typed-pubsub',
  'scalar-value-blocks-ternary-ranges','ref32-memory-and-generation-fencing',
  'theater-director-ensemble-runtime','immutable-collections-and-copy-on-write',
  'checked-i64-and-bitshift-arithmetic','type-ascription-conversion-and-generic-inference',
  'source-utf8-control-admission','package-root-import-and-aot-profile',
]);

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
    assert.notEqual(r.observed_main_tree_sha,r.observed_main_commit_sha,
      'a commit SHA is not the Git root tree OID; never confuse them');
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
  assert.ok(Array.isArray(features));
  assert.deepEqual(features.map(f=>f.id),expectedFeatureIds,
    'all fourteen canonical semantics must remain represented in the matrix');
  assert.equal(new Set(features.map(f=>f.id)).size,features.length,
    'duplicate feature family');
  for(const f of features){
    assert.match(f.id,/^[a-z0-9-]+$/);
    assert.equal(f.cross_backend_parity,'NOT_VERIFIED');
    assert.equal(f.applicability,'MUST_BE_ESTABLISHED_PER_BACKEND');
    assert.deepEqual(f.certified_backends,[]);
  }
  assert.equal(x.feature_backend_count,11*expectedFeatureIds.length);
  assert.equal(x.feature_backend_cell_status_scope,
    'initial-audit-only-does-not-assert-no-historical-test-ever-ran');
  assert.equal(typeof x.feature_backend_cells,'object');
  assert.ok(x.feature_backend_cells!==null&&!Array.isArray(x.feature_backend_cells));
  assert.deepEqual(Object.keys(x.feature_backend_cells),expectedFeatureIds,
    'each required feature must have its own eleven-backend evidence row');
  for(const id of expectedFeatureIds){
    const row=x.feature_backend_cells[id];
    assert.equal(typeof row,'object');
    assert.ok(row!==null&&!Array.isArray(row));
    assert.deepEqual(Object.keys(row),expected,
      'no backend evidence slot may be missing or introduced without review');
    for(const backend of expected){
      assert.equal(row[backend],'NOT_VERIFIED',
        'inventory cannot promote a pair without independently authenticated guest evidence');
    }
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

test('a branch commit SHA used as root tree must fail closed',()=>{
  const x=structuredClone(registry);
  x.source_repositories[0].observed_main_tree_sha=x.source_repositories[0].observed_main_commit_sha;
  assert.throws(()=>inspect(x));
});

test('a missing, extra, or renamed feature family cannot silently reduce parity scope',()=>{
  const reduced=structuredClone(registry);
  reduced.feature_families.splice(8,1);
  assert.throws(()=>inspect(reduced));
  const added=structuredClone(registry);
  added.feature_families.push({...added.feature_families[0],id:'unreviewed-feature'});
  assert.throws(()=>inspect(added));
  const renamed=structuredClone(registry);
  renamed.feature_families[1].id='try-only';
  assert.throws(()=>inspect(renamed));
});

test('the explicit 154-cell matrix rejects missing or extra backend slots',()=>{
  const x=structuredClone(registry);
  delete x.feature_backend_cells['explicit-lambda-delimiters']['atto-lang/atto-source.atto'];
  assert.throws(()=>inspect(x));
  const y=structuredClone(registry);
  y.feature_backend_cells['explicit-lambda-delimiters']['not-real/atto-source.fake']='NOT_VERIFIED';
  assert.throws(()=>inspect(y));
});
test('the parity matrix refuses forged PASSED, UNSUPPORTED or added feature keys',()=>{
  for(const status of ['PASSED','UNSUPPORTED','ZERO_STEP_PASSED']){
    const x=structuredClone(registry);
    x.feature_backend_cells['checked-i64-and-bitshift-arithmetic']['atto-lang/atto-source.rs']=status;
    assert.throws(()=>inspect(x));
  }
  const y=structuredClone(registry);
  y.feature_backend_cells['invented-contract']={};
  assert.throws(()=>inspect(y));
});
test('the matrix cannot be reduced to a smaller or overstated cell count',()=>{
  const x=structuredClone(registry);
  x.feature_backend_count=153;
  assert.throws(()=>inspect(x));
  const y=structuredClone(registry);
  y.feature_backend_cell_status_scope='all-targets-passed';
  assert.throws(()=>inspect(y));
});
