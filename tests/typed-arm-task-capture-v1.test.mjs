// HOST-ONLY registry and source-identity check, not guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'contracts/typed-arm-task-capture-v1.json'),'utf8'));

function hash_blob(bytes){
  return createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
}

function evidence_ok(m){
  assert.equal(m.schema,'atto.typed-arm-task-capture.v1');
  assert.equal(m.status,'SCOPED_RUST_WASM_PASS_NOT_CROSS_BACKEND_CERTIFIED');
  assert.equal(m.backends['rust-wasm'],'PASS_SCOPED');
  assert.equal(m.abi.profile,'atto.async.v3');
  assert.match(m.compiler.exact_head_sha,/^[0-9a-f]{40}$/);
  assert.match(m.compiler.browser_harness_blob_sha,/^[0-9a-f]{40}$/);
  const rec=m.execution_receipts?.['rust-wasm'];
  assert.ok(rec,'PASS_SCOPED requires a guest execution receipt');
  assert.equal(rec.status,'PASS_SCOPED');
  assert.equal(rec.source_head,m.compiler.exact_head_sha);
  assert.match(rec.carrier_commit,/^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(rec.workflow_run_id)&&rec.workflow_run_id>0);
  assert.ok(Number.isSafeInteger(rec.workflow_job_id)&&rec.workflow_job_id>0);
  assert.equal(rec.scoped_source_blobs_verified,51);
  assert.equal(rec.full_source_repository_tree_verified,false);
  assert.deepEqual(rec.native_rust_regression_tests,{passed:40,failed:0});
  assert.equal(rec.legacy_match_switch_guest_fixtures.passed,12);
  assert.equal(rec.actual_browser_compiler_wasm,true);
  assert.equal(rec.actual_browser_guest_wasm,true);
  assert.equal(rec.chromium_jspi,'PASS');
  for(const backend of ['java-native-image','llvm-native','dotnet-nativeaot']){
    assert.equal(m.backends[backend],'NOT_EXECUTED');
    assert.equal(m.execution_receipts[backend],undefined);
  }
}

test('only scoped executed Rust/Wasm may claim PASS',()=>{
  evidence_ok(manifest);
});
test('each fixture is byte-identical with its recorded Git blob hash',()=>{
  assert.equal(manifest.cases.length,3);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,3);
  assert.equal(new Set(manifest.cases.map(x=>x.path)).size,3);
  for(const row of manifest.cases){
    assert.match(row.git_blob_sha1,/^[a-f0-9]{40}$/);
    assert.ok(row.path.startsWith('fixtures/typed-arm-task-capture-v1/'));
    const absolute=resolve(root,row.path);
    assert.ok(absolute.startsWith(root+sep));
    const bytes=readFileSync(absolute);
    assert.equal(hash_blob(bytes),row.git_blob_sha1,row.id+': fixture drift');
    const source=bytes.toString('utf8');
    assert.match(source,/\bawait task\s*\{\s*return\b/);
    assert.match(source,/(?:on|case)\s+(?:Some|Ok|Err)\([a-z]+\)/);
    if(row.expect.kind==='browser_compiled_guest'){
      assert.equal(row.expect.return_value,42);
      assert.equal(row.expect.cooperative_yields,1);
      assert.match(source,/(?:match|switch)<int>/);
      assert.match(source,/\+ 1;/);
    }else{
      assert.equal(row.expect.kind,'no_guest');
      assert.equal(row.expect.diagnostic,'E_UNSUPPORTED');
      assert.equal(row.expect.guest_instantiated,false);
      assert.match(source,/Err\(error\)/);
    }
  }
});
test('mutant receipts cannot promote native parity or host-only evidence',()=>{
  for(const change of [
    x=>{x.backends['java-native-image']='PASS_SCOPED';},
    x=>{delete x.execution_receipts['rust-wasm'];},
    x=>{x.execution_receipts['rust-wasm'].workflow_job_id=0;},
    x=>{x.execution_receipts['rust-wasm'].full_source_repository_tree_verified=true;},
    x=>{x.execution_receipts['rust-wasm'].actual_browser_guest_wasm=false;},
    x=>{x.execution_receipts['rust-wasm'].native_rust_regression_tests.passed=0;},
  ]){
    const clone=structuredClone(manifest);
    change(clone);
    assert.throws(()=>evidence_ok(clone),'mutant receipt was accepted');
  }
});
