import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {verifyActorSyncContract} from "./verify-actor-sync-v1.mjs";
const source=JSON.parse(readFileSync(new URL("../contracts/actor-sync-v1.json",import.meta.url),"utf8"));
const clone=()=>structuredClone(source);
const receipt=()=>({
  kind:"native-oreslang-guest",sourceCommitSha:"a".repeat(40),
  sourceTreeSha:"b".repeat(40),compilerSha256:"c".repeat(64),
  runtimeSha256:"d".repeat(64),pinnedFixtureSha256:"e".repeat(64),
  executedSteps:4,rawLogUrl:"https://example.invalid/gated-step-log",
  observedOracle:"full canonical native guest result"
});
function passesMutation(description,mutate,expression) {
  test(description,()=>{const s=clone();mutate(s);assert.throws(()=>verifyActorSyncContract(s),expression);});
}
test("canonical inventory validates and reports zero verified guest executions",()=>{
 const result=verifyActorSyncContract(clone());
 assert.equal(result.scenarioCount,25);
 assert.equal(result.backendCount,5);
 assert.equal(result.verifiedGuestPasses,0);
});
passesMutation("missing backend",s=>delete s.scenarios[0].backendStatus.net,/status mapping/);
passesMutation("duplicated scenario",s=>{s.scenarios[1].id=s.scenarios[0].id},/duplicate scenario/);
passesMutation("missing scenario",s=>s.scenarios.pop(),/scenario floor/);
passesMutation("cannot delete the persisted generation-fence oracle",s=>{
 s.scenarios=s.scenarios.filter(x=>x.id!=="AS25");
},/scenario floor/);
passesMutation("cannot forge a passing generation-fence receipt with zero steps",s=>{
 const item=s.scenarios.find(x=>x.id==="AS25");
 item.backendStatus.java="PASS";
 item.evidence.java={...receipt(),executedSteps:0};
},/zero-step/);
passesMutation("AS25 cannot be weakened to a restart-free oracle",s=>{
 s.scenarios.find(x=>x.id==="AS25").oracle="old source test passes without a restart or fencing";
},/AS25 maximum epoch/);
passesMutation("AS24 cannot be weakened to legacy extension-only parity",s=>{
 s.scenarios.find(x=>x.id==="AS24").oracle="the older .ores file was parsed";
},/AS24 AttoLang extension/);
passesMutation("unrecognized execution status",s=>s.scenarios[0].backendStatus.java="HOST_ONLY",/unknown/);
passesMutation("unexecuted cannot forge a receipt",s=>s.scenarios[0].evidence.llvm=receipt(),/forged execution/);
passesMutation("unsupported cannot forge pass receipt",s=>s.scenarios[0].evidence.cranelift=receipt(),/forged execution/);
passesMutation("no PASS without actual evidence object",s=>s.scenarios[0].backendStatus.java="PASS",/missing guest evidence/);
passesMutation("source-free host reference cannot prove native guest",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),kind:"host-only"};
},/native-oreslang-guest/);
passesMutation("zero-step CI cannot prove guest parity",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),executedSteps:0};
},/zero-step/);
passesMutation("receipt must pin actual source tree",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),sourceTreeSha:""};
},/regular expression/);
passesMutation("receipt must pin compiler executable",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),compilerSha256:""};
},/regular expression/);
passesMutation("no raw executed log",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),rawLogUrl:""};
},/raw step log required/);
passesMutation("no fixture SHA",s=>{
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java={...receipt(),pinnedFixtureSha256:null};
},/falsy/);
passesMutation("runtime rejection cannot satisfy positive case",s=>{
 s.scenarios[0].backendStatus.llvm="EXPECTED_REJECT";s.scenarios[0].evidence.llvm=receipt();
},/positive execution case/);
passesMutation("cross-compiler parity cannot be inferred from host-only",s=>{
 s.acceptance.hostOnlyTestsCountAsGuestParity=true;
},/true !== false/);
passesMutation("cannot promote scalar-only Cranelift to actor guest",s=>{
 s.implementationStatus.cranelift.actorGuest="PASS";
},/Cranelift scalar-only/);
test("fixture inventory validator permits structurally complete positive receipt",()=>{
 const s=clone();
 s.scenarios[0].backendStatus.java="PASS";s.scenarios[0].evidence.java=receipt();
 assert.equal(verifyActorSyncContract(s).verifiedGuestPasses,1);
 // A syntactically complete receipt is NOT cryptographic provenance verification.
});

test("canonical .ores module and guest fixture are Git-blob pinned",()=>{
 const manifest=JSON.parse(readFileSync(new URL("../fixtures/actor-sync-v1/manifest.json",import.meta.url),"utf8"));
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.contract,"oreslang-actor-sync-source-fixtures-v1");
 assert.equal(manifest.evidenceLevel,"source-fixtures-only");
 assert.equal(manifest.hostTestsCountAsNativeGuest,false);
 assert.equal(manifest.zeroStepCiCountsAsExecution,false);
 assert.deepEqual(manifest.backendTargets,["java","llvm","wasm","cranelift","net"]);
 const gitBlob=relative=>{
   const bytes=readFileSync(new URL("../fixtures/actor-sync-v1/"+relative,import.meta.url));
   return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0"))
     .update(bytes).digest("hex");
 };
 assert.equal(gitBlob(manifest.sourceModule.path),manifest.sourceModule.gitBlobSha1);
 assert.equal(manifest.sourceModule.notPersistenceAdapter,true);
 assert.equal(manifest.fixtures.length,3);
 const known=new Map([
   ["cursor-progression","true\ntrue\nfalse\ntrue\ntrue\nfalse\ntrue\ntrue\n3\n5\n"],
   ["cross-epoch-delta-reject","false\ntrue\n5\ntrue\ntrue\n7\n5\n"],
   ["highest-epoch-fence","false\nfalse\nfalse\ntrue\ntrue\nfalse\ntrue\n8\nfalse\ntrue\ntrue\n"]
 ]);
 for(const fixture of manifest.fixtures) {
   assert.ok(known.has(fixture.id),"unrecognized native guest fixture");
   assert.equal(gitBlob(fixture.path),fixture.gitBlobSha1);
   assert.equal(fixture.expect,"accept-and-execute");
   assert.equal(fixture.stdout,known.get(fixture.id));
   assert.deepEqual(Object.keys(fixture.backendStatus),manifest.backendTargets);
   for(const backend of manifest.backendTargets)
     assert.equal(fixture.backendStatus[backend],
       backend==="cranelift"?"UNSUPPORTED":"NOT_EXECUTED");
   known.delete(fixture.id);
 }
 assert.equal(known.size,0,"missing canonical guest fixture");
 assert.equal(manifest.attoExtensionTarget.guestExecution,"NOT_EXECUTED");
 assert.equal(manifest.attoExtensionTarget.sourceGitBlobSha1,manifest.sourceModule.gitBlobSha1);
 assert.equal(gitBlob(manifest.attoExtensionTarget.sourcePath),manifest.sourceModule.gitBlobSha1);
 assert.equal(manifest.attoExtensionTarget.fixtures.length,manifest.fixtures.length);
 for (let i=0;i<manifest.fixtures.length;i++) {
   const a=manifest.attoExtensionTarget.fixtures[i];
   const legacy=manifest.fixtures[i];
   assert.equal(a.id,legacy.id);
   assert.equal(a.path,legacy.path.replace(/\.ores$/,".atto"));
   assert.equal(a.gitBlobSha1,legacy.gitBlobSha1);
   assert.equal(gitBlob(a.path),legacy.gitBlobSha1);
   assert.equal(a.expectedStdout,legacy.stdout);
   assert.deepEqual(a.backendStatus,legacy.backendStatus);
 }
 assert.deepEqual(manifest.runtimeVerifiedBackends,[]);
});
