// HOST-ONLY source/receipt integrity gate. Does NOT compile Atto guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'contracts/adt-when-guard-v1.json'),'utf8'));
const sha1=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');

function validate(m){
  assert.equal(m.schema,'atto.adt-when-guard.v1');
  assert.equal(m.status,'SCOPED_RUST_WASM_PASS_NOT_CROSS_BACKEND_CERTIFIED');
  assert.equal(m.backends['rust-wasm'],'PASS_SCOPED');
  assert.match(m.compiler.head_sha,/^[a-f0-9]{40}$/);
  assert.match(m.compiler.browser_harness_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(m.semantics.binder_initialized_after_tag_before_guard,true);
  assert.equal(m.semantics.guards_are_not_exhaustive,true);
  assert.equal(m.semantics.ordered_dispatch,true);
  assert.equal(m.semantics.unguarded_default_covers_remaining,true);
  assert.equal(m.semantics.duplicate_variant_after_unguarded_rejected,true);
  assert.equal(m.semantics.error_code_field_available,false);
  assert.equal(m.semantics.inequality_operator,'!=');
  const proof=m.execution_receipts?.['rust-wasm'];
  assert.ok(proof,'scoped PASS requires an actual guest execution receipt');
  assert.equal(proof.status,'PASS_SCOPED');
  assert.equal(proof.source_head,m.compiler.head_sha);
  assert.match(proof.carrier_commit,/^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(proof.workflow_run_id)&&proof.workflow_run_id>0);
  assert.ok(Number.isSafeInteger(proof.workflow_job_id)&&proof.workflow_job_id>0);
  assert.equal(proof.scoped_source_git_blobs_verified,53);
  assert.equal(proof.full_repository_tree_verified,false);
  assert.deepEqual(proof.native_rust_tests,{passed:50,failed:0});
  assert.equal(proof.legacy_guest_fixture_checks.passed,12);
  assert.equal(proof.browser_compiler_wasm_built,true);
  assert.equal(proof.chromium_jspi_guest_execution,'PASS');
  assert.deepEqual(proof.guard_browser_cases,{positive:4,negative:1});
  for(const backend of ['java-native-image','llvm-native','dotnet-nativeaot']){
    assert.equal(m.backends[backend],'NOT_EXECUTED');
    assert.equal(m.execution_receipts[backend],undefined);
  }
}

test('PASS is precisely scoped to the executed Rust/Wasm browser guests',()=>validate(manifest));

test('all five browser source literals are byte-identical pinned Atto fixture blobs',()=>{
  assert.equal(manifest.cases.length,5);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,5);
  assert.equal(new Set(manifest.cases.map(x=>x.path)).size,5);
  let positive=0,negative=0;
  for(const row of manifest.cases){
    assert.match(row.git_blob_sha1,/^[a-f0-9]{40}$/);
    assert.ok(row.path.startsWith('fixtures/adt-when-guard-v1/'));
    const abs=resolve(root,row.path);
    assert.ok(abs.startsWith(root+sep),'fixture must reside within repository');
    const bytes=readFileSync(abs);
    assert.equal(sha1(bytes),row.git_blob_sha1,row.id+': byte identity drift');
    const src=bytes.toString('utf8');
    assert.match(src,/\bwhen\b/);
    assert.match(src,/(?:match|switch)<int>/);
    if(row.expect.kind==='browser_compiled_guest'){
      positive++;
      assert.ok(Number.isSafeInteger(row.expect.return_value));
      if(row.expect.cooperative_yields!==undefined)assert.equal(row.expect.cooperative_yields,1);
    }else{
      negative++;
      assert.equal(row.expect.kind,'negative_no_guest');
      assert.equal(row.expect.diagnostic,'E_MATCH');
      assert.equal(row.expect.guest_instantiated,false);
    }
  }
  assert.equal(positive,4);
  assert.equal(negative,1);
});

test('cannot forge native parity or promote host-only evidence to PASS',()=>{
  for(const tamper of [
    x=>{x.backends['java-native-image']='PASS_SCOPED';},
    x=>{delete x.execution_receipts['rust-wasm'];},
    x=>{x.execution_receipts['rust-wasm'].workflow_job_id=0;},
    x=>{x.execution_receipts['rust-wasm'].native_rust_tests.passed=0;},
    x=>{x.execution_receipts['rust-wasm'].chromium_jspi_guest_execution='NOT_EXECUTED';},
    x=>{x.semantics.guards_are_not_exhaustive=false;},
  ]){
    const forged=structuredClone(manifest);
    tamper(forged);
    assert.throws(()=>validate(forged));
  }
});
