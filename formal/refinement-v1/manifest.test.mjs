import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertDesignManifest} from './check-manifest.mjs';
const m=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const fixture=readFileSync(new URL('./reliable-join-receive.atto',import.meta.url));
function mutate(label,change){test('rejects fabricated evidence: '+label,()=>{
 const x=structuredClone(m);change(x);
 assert.throws(()=>assertDesignManifest(x,fixture),/AssertionError|ERR_ASSERTION/);
});}
test('intact draft refinement manifest is not guest-authenticated',()=>{
 assert.deepEqual(assertDesignManifest(m,fixture),{
  classification:'DESIGN_TRACE_SHAPE_ONLY',verifiedGuestBackends:0,cases:3});
});
mutate('positive backend without real execution',x=>{x.backends.java.status='EXECUTED';});
mutate('claimed guest execution but zero steps',x=>{x.backends.llvm.guestExecuted=true;});
mutate('source fixture SHA drift',x=>{x.guestFixture.gitBlobSha1='0'.repeat(40);});
mutate('missing backend',x=>{delete x.backends.net;});
mutate('duplicate formal model head',x=>{x.relatedFormalPullRequests.pubsubGeneration.head=x.relatedFormalPullRequests.reliablePubsub.head;});
mutate('promoted evidence level',x=>{x.evidenceLevel='compiler-backed';});
mutate('fake independent verified backend list',x=>{x.verifiedCompilerGuestBackends=['java'];});
mutate('merged without review',x=>{x.mergeEligible=true;});
mutate('incomplete scenario coverage',x=>{x.scenarios.pop();});
mutate('unreviewed different model head',x=>{x.relatedFormalPullRequests.actorCriticalGeneration.head='a'.repeat(40);});
mutate('swapped model numbers with valid heads',x=>{
 const a=x.relatedFormalPullRequests.actorCriticalGeneration;
 const b=x.relatedFormalPullRequests.panicControl;
 [a.number,b.number]=[b.number,a.number];
});
mutate('extra claimed backend attestation',x=>{x.backends.java.compilerProved=true;});
mutate('extra claimed global parity field',x=>{x.fiveBackendParity=true;});
mutate('deleted required authentication condition',x=>{x.requiredAuthentication.splice(1,1);});
mutate('substituted weaker authentication condition',x=>{x.requiredAuthentication[0]='local source-only test pass accepted';});
mutate('deleted a non-proof limitation',x=>{x.notEstablishedByReplay.pop();});
mutate('forged candidate fixture origin',x=>{x.guestFixture.candidateOrigin='some-other-program';});
mutate('extra guest fixture artifact assertion',x=>{x.guestFixture.compiled=true;});
mutate('reordered backend fixture schema',x=>{x.scenarios.reverse();});
mutate('swapped actor model heads and numbers',x=>{
 const a=x.relatedFormalPullRequests.actorCriticalGeneration;
 const b=x.relatedFormalPullRequests.panicControl;
 x.relatedFormalPullRequests.actorCriticalGeneration=b;
 x.relatedFormalPullRequests.panicControl=a;
});
