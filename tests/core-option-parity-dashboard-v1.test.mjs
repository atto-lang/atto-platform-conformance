import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCoreOptionDashboard,validateCoreOptionDashboard,
  renderCoreOptionDashboard,CORE_OPTION_GATES} from '../lib/core-option-parity-dashboard-v1.mjs';
const snapshot=loadCoreOptionDashboard();
const copy=()=>structuredClone(snapshot);
const denied=(title,edit)=>test(title,()=>{
  const data=copy();
  edit(data);
  assert.throws(()=>validateCoreOptionDashboard(data),/CORE_OPTION_DASHBOARD_DENIED/);
});

test('all eleven backend identities and explicit nonpromoting execution gates are present',()=>{
  assert.deepEqual(validateCoreOptionDashboard(snapshot),{
    backends:11,candidates:9,unidentified:2,guest_passes:0,
    test_targets:17,unexecuted_gates:66
  });
  assert.deepEqual(new Set(snapshot.backends.map(x=>x.id)),
    new Set(['java','llvm','rs','net','wasm','forge','cranelift','js','hdl','atto','realtime']));
  for(const b of snapshot.backends)
    assert.deepEqual(Object.keys(b.checks).sort(),[...CORE_OPTION_GATES].sort());
});
test('Java source tree and the two imported guest programs are individually SHA-pinned',()=>{
  const j=snapshot.java_reference;
  assert.equal(j.root_tree_sha,'03981bf0f0540f913a45cbc951934783b61794b5');
  assert.equal(j.head_sha,snapshot.backends.find(x=>x.id==='java').candidate.head_sha);
  assert.equal(j.test_blobs.filter(x=>x.path.endsWith('.atto')).length,3);
  assert.equal(j.authored_junit_tests.filter(x=>x.kind==='compiled_positive_guest').length,3);
  assert.ok(j.test_blobs.some(x=>x.path==='src/main/java/dev/oreslang/types/OwnershipChecker.java' && x.sha==='6be88b5f3717f70759440be6a3012a0411f2315b'));
  assert.ok(j.test_blobs.some(x=>x.path==='src/main/java/dev/oreslang/types/TypeChecker.java' && x.sha==='3c1061d47c087d701f578e39a71ff34ce3197341'));
  assert.ok(j.test_blobs.some(x=>x.path==='.github/workflows/core-option-result-jvm-borrow-exact-head.yml' && x.sha==='9d74a1ea63898534fb3c991dfd805b031b74a860'));
  assert.ok(j.test_blobs.some(x=>x.path==='src/main/java/dev/oreslang/types/CoreTypeRegistry.java' && x.sha==='bc9c3574f0e653218ea8a68f85d4effbd6722eeb'));
  assert.ok(j.test_blobs.some(x=>x.path==='src/main/java/dev/oreslang/compiler/OresCompiler.java' && x.sha==='c60883bf73abf36b89343a2b18feb11565c11c03'));
  assert.ok(j.test_blobs.some(x=>x.path==='src/test/java/dev/oreslang/AutomaticPreludeTest.java' && x.sha==='0e354f5478a0651127f746e63e86bb5a591bca74'));
  assert.ok(j.authored_junit_tests.every(x=>x.state==='not_executed'));
});
test('dashboard is the exact deterministic projection of the audited registry',()=>{
  const path=fileURLToPath(new URL('../docs/CORE_OPTION_PARITY_DASHBOARD_V1.md',import.meta.url));
  assert.equal(readFileSync(path,'utf8'),renderCoreOptionDashboard(snapshot));
});
denied('missing compiler cannot be hidden', x=>x.backends.pop());
denied('duplicate compiler identity is rejected', x=>x.backends[1].id='java');
denied('backend immutable repository ID cannot be swapped', x=>x.backends[0].repository_id='123');
denied('baseline must be an exact Git commit SHA', x=>x.backends[0].observed_main_sha='main');
denied('candidate must be its own backend PR', x=>x.backends[0].candidate.pr_url='https://github.com/atto-lang/atto-source.llvm/pull/870');
denied('Java source head is independently pinned', x=>x.backends[0].candidate.head_sha='a'.repeat(40));
denied('missing self-hosted candidate cannot be invented', x=>x.backends.find(b=>b.id==='atto').candidate={pr_url:'fake',head_sha:'a'.repeat(40)});
denied('compiled guest PASS cannot come from editable manifest', x=>x.backends[0].checks.linked_positive_guest.state='passed');
denied('AOT PASS cannot be laundered through source-only metadata', x=>x.backends[0].checks.native_aot.state='passed');
denied('sanitizer PASS cannot be self-reported', x=>x.backends[1].checks.sanitizers_or_memory_safety.state='passed');
denied('empty or synthetic receipt cannot promote a guest', x=>x.backends[0].checks.linked_positive_guest.receipt={run_id:1});
denied('unsupported must have independently authenticated evidence', x=>x.backends.find(b=>b.id==='hdl').capability_assessment[0].state='unsupported');
denied('unverified capability cannot carry a self-declared receipt', x=>x.backends[0].capability_assessment[0].evidence={reason:'host only'});
denied('wrong Java guest fixture SHA must fail closed', x=>x.java_reference.test_blobs[0].sha='b'.repeat(40));
denied('missing Java compiled guest test cannot be considered complete', x=>x.java_reference.authored_junit_tests.pop());
denied('Java expected stdout cannot be changed to manufacture success', x=>x.java_reference.authored_junit_tests[2].expected_stdout='43');
denied('release qualification cannot be self-promoted', x=>x.release_qualified=true);
test('noncanonical/duplicate-key JSON input is rejected', t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-option-parity-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'index.json');
  writeFileSync(file,JSON.stringify(snapshot,null,2).replace(
    '  "schema": "atto.core-option-11-backend-dashboard.v1",',
    '  "schema": "malicious",\n  "schema": "atto.core-option-11-backend-dashboard.v1",')+'\n');
  assert.throws(()=>loadCoreOptionDashboard(file),/CORE_OPTION_DASHBOARD_DENIED/);
});
