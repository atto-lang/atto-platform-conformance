import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {validateIsolationManifest, validateIsolationClaim,
  ISOLATION_CASES, ISOLATION_FIXTURE, ISOLATION_BLOB, ISOLATION_SCHEMA,
  ISOLATION_BACKENDS} from "../src/actor-isolation-evidence-v1.mjs";

const fixture = fileURLToPath(new URL("../" + ISOLATION_FIXTURE, import.meta.url));
const manifestPath = fileURLToPath(new URL(
  "../contracts/v1/actor-isolation/evidence.pending.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const run = () => structuredClone(manifest);
const BAD = /INVALID_ACTOR_ISOLATION_EVIDENCE/;
function evidence() {
  return {
    schema: ISOLATION_SCHEMA, backend: "wasm",
    source:{commit:"1234567890abcdef1234567890abcdef12345678",
      tree:"fedcba9876543210fedcba9876543210fedcba98",fixtureBlob:ISOLATION_BLOB},
    compiler:{sourceCommit:"1234567890abcdef1234567890abcdef12345678",
      sourceTree:"fedcba9876543210fedcba9876543210fedcba98",
      binarySha256:"0123456789abcdef".repeat(4),builtFromPinnedCheckout:true},
    ci:{workflowPath:".github/workflows/actor-isolation.yml",runId:1234,
      attempt:1,jobId:4321,runnerId:6789,compilerStep:"Build pinned compiler",
      guestStep:"Run compiled Oreslang isolation contract",
      executedSteps:[
        {name:"Build pinned compiler",number:4,conclusion:"success",
         startedAt:"2026-10-28T00:00:00Z",completedAt:"2026-10-28T00:00:01Z"},
        {name:"Run compiled Oreslang isolation contract",number:5,
         conclusion:"success",startedAt:"2026-10-28T00:00:02Z",
         completedAt:"2026-10-28T00:00:03Z"}],
      conclusion:"success"},
    registration: ISOLATION_CASES.map(c=>c[0]),
    caseResults: ISOLATION_CASES.map(([id,type])=>({
      id,outcome:"pass",compiler:type==="compiler-negative"?"rejected-no-ir":"executed",
      guest:type==="compiler-negative"?"not-applicable":"executed",
      guestAssertions:type==="compiler-negative"?0:1,actors:["A","B"],
      violationRejected:["foreign_actor_access_denied",
        "read_loan_blocks_A_mutation_B_progresses",
        "stale_handle_after_reclamation_denied"].includes(id),
      hostBeforeFree:type==="guest-and-host"||type==="host-before-free"
    }))
  };
}
test("fixture is the exact reviewed Git blob rather than a filename label",()=>{
  const bytes = readFileSync(fixture);
  const actual = createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
  assert.equal(actual,ISOLATION_BLOB);
});
test("six cases across exactly six pending backends cannot certify parity",()=>{
  const m=run();
  const result=validateIsolationManifest(m);
  assert.equal(result.status,"PENDING");
  assert.equal(result.guest_runtime_pass,false);
  assert.equal(result.authenticatedGuestExecutions,0);
  assert.deepEqual(m.backends.map(b=>b.backend),ISOLATION_BACKENDS);
});
test("even a structurally complete synthetic claim is NOT guest execution proof",()=>{
  const r=validateIsolationClaim(run(),evidence());
  assert.equal(r.guest_runtime_pass,false);
  assert.equal(r.authenticatedGuestExecutions,0);
  assert.equal(r.parityCertified,false);
});
test("reject missing, malformed and counterfeit source/compiler provenance",()=>{
  for (const mutate of [
    x=>delete x.source.fixtureBlob,
    x=>x.source.fixtureBlob="0".repeat(40),
    x=>x.source.commit="wrong",
    x=>x.compiler.sourceTree="0".repeat(40),
    x=>x.compiler.binarySha256="0".repeat(64),
    x=>x.compiler.builtFromPinnedCheckout=false
  ]) {const e=evidence();mutate(e);assert.throws(()=>validateIsolationClaim(run(),e),BAD);}
});
test("reject missing test registration and duplicate case names",()=>{
  for (const mutate of [
    x=>x.registration.pop(),
    x=>x.registration[0]=x.registration[1],
    x=>x.caseResults.pop(),
    x=>x.caseResults[1]=structuredClone(x.caseResults[0])
  ]){const e=evidence();mutate(e);assert.throws(()=>validateIsolationClaim(run(),e),BAD);}
});
test("reject zero-step, skipped guest, and no compiler step",()=>{
  for (const mutate of [
    x=>x.ci.executedSteps=[],
    x=>x.ci.executedSteps=[x.ci.executedSteps[0]],
    x=>x.ci.guestStep="Set up job",
    x=>x.ci.compilerStep=x.ci.guestStep,
    x=>x.ci.conclusion="skipped",
    x=>x.ci.jobId=0,
    x=>x.caseResults[0].guest="skipped",
    x=>x.caseResults[0].guestAssertions=0
  ]){const e=evidence();mutate(e);assert.throws(()=>validateIsolationClaim(run(),e),BAD);}
});
test("reject fake step successes, mutated job order and clock provenance",()=>{
  for (const mutate of [
    x=>x.ci.executedSteps[0].conclusion="skipped",
    x=>x.ci.executedSteps[1].conclusion="failure",
    x=>x.ci.executedSteps[1].number=x.ci.executedSteps[0].number,
    x=>x.ci.executedSteps.reverse(),
    x=>x.ci.executedSteps[0].completedAt="2026-10-27T23:59:59Z",
    x=>x.ci.executedSteps[1].startedAt="yesterday",
    x=>x.ci.executedSteps[1].name=x.ci.executedSteps[0].name,
    x=>x.ci.executedSteps[1].name="Pre Download actor",
    x=>x.ci.executedSteps[1].extraPassed=true,
    x=>x.ci.executedSteps[0]="Build pinned compiler",
    x=>x.ci.executedSteps[1].startedAt="2026-10-27T23:59:57Z"
  ]){const e=evidence();mutate(e);assert.throws(()=>validateIsolationClaim(run(),e),BAD);}
});
test("deliberate foreign access, outstanding loan and stale handle violations fail",()=>{
  for (const id of ["foreign_actor_access_denied",
                    "read_loan_blocks_A_mutation_B_progresses",
                    "stale_handle_after_reclamation_denied"]){
    const e=evidence();e.caseResults.find(x=>x.id===id).violationRejected=false;
    assert.throws(()=>validateIsolationClaim(run(),e),BAD);
  }
});
test("host-only tests cannot earn guest runtime pass",()=>{
  for(const id of ["independent_private_state","destroy_A_preserves_B"]){
    const e=evidence();e.caseResults.find(x=>x.id===id).guest="not-executed";
    assert.throws(()=>validateIsolationClaim(run(),e),BAD);
  }
});
test("physical scrub requires instrumented pre-free evidence",()=>{
  const e=evidence();
  e.caseResults.at(-1).hostBeforeFree=false;
  assert.throws(()=>validateIsolationClaim(run(),e),BAD);
});
test("destroying A must preserve B with guest and host evidence",()=>{
  const e=evidence();e.caseResults[3].hostBeforeFree=false;
  assert.throws(()=>validateIsolationClaim(run(),e),BAD);
});
test("pending baseline cannot be silently promoted",()=>{
  for (const mutate of [
    m=>m.backends[0].status="pass",
    m=>m.backends.pop(),
    m=>m.cases[2].evidence="host-only",
    m=>m.fixture.gitBlobSha="0".repeat(40)
  ]) {const m=run();mutate(m);assert.throws(()=>validateIsolationManifest(m),BAD);}
});
