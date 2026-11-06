import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvertedGuestReceipt as validate } from '../verification/dop-inverted-guest-receipt-v1.mjs';

const sha1 = 'a'.repeat(40), sha256 = 'b'.repeat(64);
const manifest = {contract:'atto-dop-inverted-two-i64-guest-v1', vectors:[
  {id:'swap-reuse',blobSha1:'8f5599a9e0b11ded2929110b4936441fceb2ef21'},
  {id:'removed-index-trap',blobSha1:'c3c87cfd2515707932734e183bb5768436526a96'}
]};
const steps=['checkout-head','verify-fixture','compile-guest','execute-guest'].map((name,i)=>({
  name,number:i+1,conclusion:'success',
  startedAt:'2026-11-06T10:00:0'+i+'Z',
  completedAt:'2026-11-06T10:00:0'+(i+1)+'Z'
}));
const base={contract:manifest.contract,backend:'java',caseId:'swap-reuse',status:'PASSED',
  sourceHeadSha:sha1,checkoutHeadSha:sha1,sourceTreeSha:sha1,
  fixtureGitBlobSha:manifest.vectors[0].blobSha1,fixtureSha256:sha256,compilerSha256:sha256,
  toolchain:'JDK 21',command:'mvn -Dtest=DopInvertedGuestI64V1Test test',
  discoveredTests:6,executedTests:6,guestExecuted:true,executionProfile:'restricted-interpreter',
  executionStage:'managed-guest',guestArtifactSha256:null,runtimeClassTreeSha256:sha256,
  guestResult:{kind:'return',value:42},
  ciJob:{runId:1,jobId:2,attempt:1,runnerId:3,conclusion:'success',steps}
};
const check = patch => validate({...base,...patch},manifest);
test('synthetic Java restricted interpreter receipt shape passes but does not attest real CI',()=>{
 assert.deepEqual(check(),[]);
});
test('reject zero-step, absent runner, or duplicate checkout steps',()=>{
 assert.ok(check({ciJob:{...base.ciJob,steps:[]}}).includes('nonzero-executed-steps'));
 assert.ok(check({ciJob:{...base.ciJob,runnerId:0}}).includes('runner-admission'));
 assert.ok(check({ciJob:{...base.ciJob,steps:[...steps,steps[0]]}}).includes('unique-step-name'));
});
test('reject forged source identities and disabled execution',()=>{
 assert.ok(check({checkoutHeadSha:'b'.repeat(40)}).includes('exact-head'));
 assert.ok(check({fixtureGitBlobSha:'0'.repeat(40)}).includes('canonical-fixture-blob'));
 assert.ok(check({guestExecuted:false}).includes('guest-process-executed'));
});
test('reject Java interpreter presented as native AOT or forged guest image',()=>{
 assert.ok(check({executionProfile:'aot'}).includes('java-profile'));
 assert.ok(check({guestArtifactSha256:sha256}).includes('java-must-not-claim-native-image'));
});
test('LLVM requires native image and actual signal semantics',()=>{
 const llvm={...base,backend:'llvm',executionProfile:'aot',executionStage:'native-guest',
  guestArtifactSha256:sha256,runtimeClassTreeSha256:null};
 assert.deepEqual(validate(llvm,manifest),[]);
 assert.ok(validate({...llvm,guestArtifactSha256:null},manifest).includes('llvm-native-artifact'));
 const neg={...llvm,caseId:'removed-index-trap',fixtureGitBlobSha:manifest.vectors[1].blobSha1,
  guestResult:{kind:'native-signal',signal:'SIGILL'}};
 assert.deepEqual(validate(neg,manifest),[]);
 assert.ok(validate({...neg,guestResult:{kind:'return',value:132}},manifest).includes('real-checked-bounds-failure'));
});
test('Java negative must be a checked language trap, not an arbitrary host exception',()=>{
 const neg={...base,caseId:'removed-index-trap',fixtureGitBlobSha:manifest.vectors[1].blobSha1,
  guestResult:{kind:'language-trap',trap:'DOP_INVERTED_BOUNDS_TRAP'}};
 assert.deepEqual(validate(neg,manifest),[]);
 assert.ok(validate({...neg,guestResult:{kind:'host-exception',trap:'NullPointerException'}},manifest)
   .includes('real-checked-bounds-failure'));
});
test('other backend positive claims rejected, not-executed stays not-executed',()=>{
 assert.ok(check({backend:'wasm'}).includes('unimplemented-backend-positive'));
 const not={contract:manifest.contract,backend:'net',caseId:'swap-reuse',status:'NOT_EXECUTED',guestExecuted:false};
 assert.deepEqual(validate(not,manifest),[]);
 assert.ok(validate({...not,guestResult:{kind:'return',value:42}},manifest).includes('not-executed-result'));
});
