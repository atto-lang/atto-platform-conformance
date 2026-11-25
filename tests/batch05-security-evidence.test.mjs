import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const evidence=JSON.parse(readFileSync(
  new URL("../audits/batch05-untrusted-transport-security.json",import.meta.url),
  "utf8"));
const cases=[
  [41,"oreslang-common-source","issue",69],
  [42,"oreslang-source.java","issue",1265],
  [43,"oreslang-source.llvm","issue",589],
  [44,"oreslang-platform-conformance","issue",87],
  [45,"oreslang-source.llvm","issue",645],
  [46,"oreslang-source.llvm","pr",654],
  [47,"oreslang-source.java","pr",1406],
  [48,"oreslang-ml","issue",11],
  [49,"oreslang-source.java","issue",1267],
  [50,"oreslang-source.java","pr",1438]
];
test("pin exactly task indexes 41–50 and their current original GitHub identities",()=>{
  assert.equal(evidence.schema,1);
  assert.equal(evidence.batch,5);
  assert.equal(evidence.tasks.length,10);
  assert.deepEqual(evidence.tasks.map(x=>x.task),cases.map(x=>x[0]));
  const ids=new Set();
  cases.forEach(([id,repo,kind,number],index)=>{
    const t=evidence.tasks[index];
    assert.equal(t.repo,"ores-truffle-oreslang/"+repo);
    assert.equal(t.kind,kind);
    assert.equal(t.number,number);
    assert.equal(t.url,"https://github.com/"+t.repo+"/"+(kind==="pr"?"pull":"issues")+"/"+number);
    assert.equal(ids.has(t.url),false);
    ids.add(t.url);
  });
});
test("source-free oracles cannot close any real guest security gate",()=>{
  assert.match(evidence.claim,/PARTIAL_DIRECT_JAVA_SECURITY_FIX/);
  for(const t of evidence.tasks){
    assert.equal(t.status,"PENDING_PRODUCTION_GUEST_PROOF");
    assert.equal(t.sourceFreeOracle,"NON_CERTIFYING");
    assert.match(t.releaseGate,/^[A-Z_]{10,100}$/);
  }
});
test("source-local IPC patch is scoped and remains Java CI unverified",()=>{
  assert.equal(evidence.fix.pr,1503);
  assert.equal(evidence.fix.basePr,1438);
  assert.equal(evidence.fix.verifiedExactHeadJava,false);
  assert.equal(evidence.fix.scope,"PEER_LOCAL_VERDICTS_FENCED_EOF_AND_PREDISPATCH_REJECTION");
});
test("approved host CI for other tree cannot validate current patch or guest network",()=>{
  assert.equal(evidence.upstreamEvidence.run,39207273400);
  assert.equal(evidence.upstreamEvidence.jobConclusion,"success");
  assert.equal(evidence.upstreamEvidence.stepExecutionObserved,true);
  assert.equal(evidence.upstreamEvidence.appliesToCurrentBatch05JavaPatch,false);
  assert.equal(evidence.upstreamEvidence.guestNetworkIsolationProof,false);
});
test("untrusted default deny, no fake sandbox and no free cross-org mirroring",()=>{
  assert.equal(evidence.safety.directUntrustedNetwork,"DEFAULT_DENY");
  assert.equal(evidence.safety.nativeUntrustedScheduleDomainIsSandbox,false);
  assert.equal(evidence.safety.otherOrgPrivateSourceExport,
    "EXPLICIT_INDEPENDENT_SCOPE_APPROVAL_REQUIRED");
  assert.equal(evidence.safety.controlChannelGuestForging,"DENY");
  assert.equal(evidence.safety.zeroStepActions,"UNOBSERVED_NOT_PASS_OR_COMPILER_FAILURE");
});
