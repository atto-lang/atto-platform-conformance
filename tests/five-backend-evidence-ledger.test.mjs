import test from "node:test";
import assert from "node:assert/strict";
import {BACKENDS, EXPECTED_GIT_BLOB, RELATIVE_FIXTURE} from "../src/five-backend-scalar.mjs";
import {EVIDENCE_SCHEMA, REPOSITORY_IDS, EXECUTION_MODES,
  validateFiveBackendEvidenceManifest as check} from "../src/five-backend-evidence-ledger.mjs";

function base() {
  return {schema:EVIDENCE_SCHEMA,
    fixture:{path:RELATIVE_FIXTURE,gitBlobSha:EXPECTED_GIT_BLOB,expectedValue:42},
    records:BACKENDS.map(backend=>({backend,status:"pending",reason:"No executed native CI"}))};
}
function executed(backend) {
  return {backend,status:"executed-claimed",execution:{
    repositoryId:REPOSITORY_IDS[backend],headCommitSha:"a".repeat(40),
    headTreeSha:"b".repeat(40),workflowId:12,
    workflowPath:".github/workflows/native.yml",
    workflowRunPath:".github/workflows/native.yml@refs/heads/main",
    workflowBlobSha:"c".repeat(40),
    runId:93,runAttempt:1,runEvent:"pull_request",
    jobId:1324,runnerId:86421,runnerName:"GitHub Actions 86421",
    runnerJob:"native",testStep:"Run native guest tests",
    executionMode:EXECUTION_MODES[backend],toolchain:"pinned native toolchain",
    ciStatement:"GITHUB_RUN_EXECUTION_VERIFIED_NOT_GUEST_PARITY_CERTIFIED",
    sourceGitBlobSha:EXPECTED_GIT_BLOB,nativeGuestExecuted:true,compilerExecuted:true,
    executedFixtureIds:[RELATIVE_FIXTURE],executedTestCount:1,observedValue:42,
    testLogSha256:"d".repeat(64),artifactSha256:"e".repeat(64)
  }};
}
const reject=m=>assert.throws(()=>check(m),/INVALID_FIVE_BACKEND_EVIDENCE/);

test("five pending backends yield no false-green parity",()=>{
  const result=check(base());
  assert.equal(result.claimedExecutionCount,0);
  assert.equal(result.parityCertified,false);
  assert.equal(result.nativeExecutionAuthenticated,false);
  assert.equal(result.blocked.length,5);
});
test("no shape-only document ever certifies all claimed executions",()=>{
  const x=base();x.records=BACKENDS.map(executed);
  const result=check(x);
  assert.equal(result.claimedExecutionCount,5);
  assert.equal(result.completeUnverifiedClaimSet,true);
  assert.equal(result.independentlyAuthenticatableClaims,false);
  assert.equal(result.nativeExecutionAuthenticated,false);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.releaseReady,false);
  assert.equal(result.parityCertified,false);
  assert.equal(result.blocked.length,5);
  assert.ok(result.blocked.every(record=>
    record.reason==="SELF_REPORTED_EXECUTION_NOT_AUTHENTICATED"));
  assert.equal(result.status,"EVIDENCE_SHAPE_ONLY_NOT_AUTHENTICATED");
});
test("a mix of claimed and pending execution remains wholly blocked",()=>{
  const x=base();
  x.records[0]=executed(BACKENDS[0]);
  x.records[2]=executed(BACKENDS[2]);
  const result=check(x);
  assert.equal(result.claimedExecutionCount,2);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.completeUnverifiedClaimSet,false);
  assert.equal(result.independentlyAuthenticatableClaims,false);
  assert.equal(result.releaseReady,false);
  assert.equal(result.blocked.length,5);
  assert.equal(result.blocked.filter(r=>
    r.reason==="SELF_REPORTED_EXECUTION_NOT_AUTHENTICATED").length,2);
});

test("no declaration, even five matching digests, is a proof of native runs",()=>{
  const x=base();
  x.records=BACKENDS.map(executed);
  const result=check(x);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.nativeExecutionAuthenticated,false);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
  assert.equal(result.blocked.length,5);
});

test("reject missing backend",()=>{const x=base();x.records.pop();reject(x)});
test("reject duplicate backend",()=>{const x=base();x.records[4]=structuredClone(x.records[0]);reject(x)});
test("reject unknown status",()=>{const x=base();x.records[0].status="verified";reject(x)});
test("reject pending entry with fake execution",()=>{const x=base();x.records[0].execution=executed(BACKENDS[0]).execution;reject(x)});
test("reject unsupported with missing reason",()=>{const x=base();x.records[0]={backend:BACKENDS[0],status:"unsupported"};reject(x)});
test("reject source blob drift",()=>{const x=base();x.fixture.gitBlobSha="f".repeat(40);reject(x)});
test("reject unsolicited manifest fields",()=>{const x=base();x.certified=true;reject(x)});
test("reject fabricated guest result or no executable tests",()=>{
  for (const [k,v] of [["observedValue",41],["executedTestCount",0],["nativeGuestExecuted",false],["compilerExecuted",false]]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution[k]=v;reject(x);
  }
});
test("reject wrong toolchain mode for backend",()=>{const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution.executionMode=EXECUTION_MODES[BACKENDS[1]];reject(x)});
test("reject swapped repository numeric identity",()=>{const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution.repositoryId=REPOSITORY_IDS[BACKENDS[1]];reject(x)});
test("reject claimed unallocated runner and fake numeric job IDs",()=>{
  for (const key of ["jobId", "runnerId"]) {
    for (const value of [0, -1, true, false, null, "123", Number.MAX_SAFE_INTEGER+1]) {
      const x=base();x.records[0]=executed(BACKENDS[0]);
      x.records[0].execution[key]=value;
      reject(x);
    }
  }
  for (const value of ["", "   ", false, null, 32, "runner\nforged"]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);
    x.records[0].execution.runnerName=value;
    reject(x);
  }
  for (const key of ["runnerJob","testStep","toolchain"]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);
    x.records[0].execution[key]="valid\nspoofed-step";
    reject(x);
  }
});
test("reject missing, wrong, or traversal workflow-run references",()=>{
  for (const value of [
    undefined, "", ".github/workflows/other.yml@refs/heads/main",
    ".github/workflows/native.yml@refs/heads/../evil",
    ".github/workflows/native.yml@refs/heads//main",
    ".github/workflows/native.yml@",
    ".github/workflows/native.yml@refs/heads/main?x=y",
    ".github/workflows/native.yml@refs/heads/main#frag",
    ".github/workflows/native.yml@refs/heads/main\nspoofed"
  ]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);
    if (value === undefined) delete x.records[0].execution.workflowRunPath;
    else x.records[0].execution.workflowRunPath=value;
    reject(x);
  }
  for (const value of [
    ".github/workflows/native.yml",
    ".github/workflows/native.yml@main",
    ".github/workflows/native.yml@refs/pull/123/merge"
  ]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);
    x.records[0].execution.workflowRunPath=value;
    assert.equal(check(x).claimedExecutionCount,1);
  }
});
test("reject run attempt bool, zero and overflow",()=>{
  for(const v of [true,0,Number.MAX_SAFE_INTEGER+1]){
    const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution.runAttempt=v;reject(x);
  }
});
test("reject workflow traversal and unsafe event",()=>{
  for(const path of ["../other.yml",".github/workflows/../other.yml"]){
    const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution.workflowPath=path;reject(x);
  }
  const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution.runEvent="workflow_dispatch";reject(x);
});
test("reject source-identity-only proof impersonation",()=>{
  const x=base();x.records[0]=executed(BACKENDS[0]);
  x.records[0].execution.ciStatement="SOURCE_IDENTITY_ONLY_NOT_EXECUTION";reject(x);
});
test("reject wrong fixture id even if the test count is positive",()=>{
  const x=base();x.records[0]=executed(BACKENDS[0]);
  x.records[0].execution.executedFixtureIds=["other.ores"];reject(x);
});
test("reject malformed artifact or log digests",()=>{
  for(const key of ["artifactSha256","testLogSha256"]){
    const x=base();x.records[0]=executed(BACKENDS[0]);x.records[0].execution[key]="0".repeat(40);reject(x);
  }
});


test("source-free verifier receipt is never native guest parity",()=>{
  // Actual, GitHub-hosted source-free 73-test report. Its successful
  // verifier regressions cannot substitute for a backend compiler invocation.
  const x=base();
  x.records[0]=executed(BACKENDS[0]);
  Object.assign(x.records[0].execution,{
    repositoryId:1323598260,  // source-free carrier, not Java source repo
    headCommitSha:"4ed1d2cdf1a6c7a67e4a21ea22404933ba137886",
    workflowPath:".github/workflows/oreslang-source-free-73-evidence.yml",
    runId:38994382119,runAttempt:1,executedTestCount:219,
    compilerExecuted:false,nativeGuestExecuted:false,
    artifactSha256:"56c6e85cf07a4e71d415ee470958a9995a404353d773054f333ff83e1f8e7248"
  });
  reject(x);
  const extra=base();
  extra.records[0].sourceFreeRun=38994382119;
  reject(extra); // source-free receipts must not enter the native manifest
  const pending=check(base());
  assert.equal(pending.claimedExecutionCount,0);
  assert.equal(pending.parityCertified,false);
});

test("reject runner housekeeping as native guest test steps",()=>{
  for (const name of [
    "Set up job", "Complete job", "Initialize containers",
    "Start containers", "Stop containers", "Post Checkout", "Pre Checkout"
  ]) {
    const x=base();x.records[0]=executed(BACKENDS[0]);
    x.records[0].execution.testStep=name;
    reject(x);
  }
  const x=base();x.records[0]=executed(BACKENDS[0]);
  x.records[0].execution.testStep="Run actual native guest fixture";
  const result=check(x);
  assert.equal(result.claimedExecutionCount,1);
  assert.equal(result.parityCertified,false);
  assert.equal(result.authenticatedExecutionCount,0);
});
