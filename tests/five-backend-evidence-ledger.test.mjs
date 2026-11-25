import test from "node:test";
import assert from "node:assert/strict";
import {BACKENDS, EXPECTED_GIT_BLOB, RELATIVE_FIXTURE} from "../src/five-backend-scalar.mjs";
import {EVIDENCE_SCHEMA, REPOSITORY_IDS, EXECUTION_MODES,
  validateFiveBackendEvidenceManifest as check,
  validateSourceFreeVerifierReceipt as checkSourceFree} from "../src/five-backend-evidence-ledger.mjs";

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
  for (const key of ["runnerName","runnerJob","testStep","toolchain"]) {
    for (const separator of ["\u0085", "\u2028", "\u2029"]) {
      const x=base();x.records[0]=executed(BACKENDS[0]);
      x.records[0].execution[key]="valid" + separator + "forged-step";
      reject(x);
    }
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


function sourceFree82(){
  return {
    schema:"oreslang.source_free_ci_verifier_82.v1",
    repository:"scintilla-run-test/gleam-runner-conformance",
    carrier_head_sha:"36204819e5439de6964b8d3b297ba4c75420b9d2",
    carrier_tree_sha:"07f7164cd1f802ee6c46b0102649819592504d29",
    run_id:38997728835,run_attempt:1,source_free_only:true,
    private_runtime_or_compiler_source_transferred:false,
    guest_runtime_certified:false,source_repository_native_ci_certified:false,
    tests_per_round:82,rounds:3,expected_total:246,
    git_blobs:{
      "scripts/verify_ci_run.py":"1d7b03db64a8576b5c4271b6f7571df503dffd81",
      "scripts/test_verify_ci_run.py":"45ada59ac6001254897edf9f8cd3b75ef4f58acc",
      ".github/workflows/ci-run-evidence-contract.yml":
        "c62d13b3c3e9d666d90f752bcf96cbe07588a648"
    }
  };
}
test("validated 82x3 source-free receipt remains non-native evidence",()=>{
  const result=checkSourceFree(sourceFree82());
  assert.equal(result.regressionExecutionsClaimed,246);
  assert.equal(result.status,"SOURCE_FREE_RECEIPT_SHAPE_ONLY_NOT_AUTHENTICATED");
  assert.equal(result.nativeExecutionAuthenticated,false);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
  assert.equal(result.externalVerificationRequired,true);
  assert.equal(check(base()).blocked.length,5);
});
test("85-case exact carrier receipt is shape-valid but never native certification",()=>{
  const receipt=sourceFree82();
  receipt.schema="oreslang.source_free_ci_verifier_85.v1";
  receipt.tests_per_round=85;
  receipt.expected_total=255;
  receipt.run_id=38998088804;
  receipt.carrier_head_sha="ba78a09a767a43acf9f248d1999fa41456c1c5a4";
  receipt.carrier_tree_sha="eca4be6b8e286955733bdc31d8d8570535632ba1";
  receipt.git_blobs["scripts/verify_ci_run.py"]=
    "b59a7880f060582694ed4a9862caede5e5f3e8b9";
  receipt.git_blobs["scripts/test_verify_ci_run.py"]=
    "84eedb6beec2e8fbe81b7539095ef4550a09b0cf";
  receipt.git_blobs[".github/workflows/ci-run-evidence-contract.yml"]=
    "78bd3f8e95f2097d244468d80833f696fed46141";
  const r=checkSourceFree(receipt);
  assert.equal(r.regressionExecutionsClaimed,255);
  assert.equal(r.parityCertified,false);
  assert.equal(r.releaseReady,false);
  receipt.expected_total=246;
  assert.throws(()=>checkSourceFree(receipt),/stale or inconsistent/);
});

test("reject older 82-case GitHub artifact with stale expected_total 231",()=>{
  // Carrier run 38997306268 reported 82 tests per round in 3 rounds, but
  // wrote old total 231. It is NOT acceptable evidence for 246 cases.
  const stale=sourceFree82();
  stale.carrier_head_sha="1e5da5ef0398cdddcbbc13ea1881334d825775b4";
  stale.run_id=38997306268;
  stale.expected_total=231;
  assert.throws(()=>checkSourceFree(stale),/stale or inconsistent/);
  // A valid older 77-case shape may still report 231; never native.
  stale.schema="oreslang.source_free_ci_verifier_77.v1";
  stale.tests_per_round=77;
  const old=checkSourceFree(stale);
  assert.equal(old.regressionExecutionsClaimed,231);
  assert.equal(old.parityCertified,false);
});
test("fail closed on incomplete, native-promoting and malformed source-free receipts",()=>{
  const cases=[
    ["missing blob",r=>delete r.git_blobs["scripts/test_verify_ci_run.py"]],
    ["unexpected blob",r=>r.git_blobs["secrets/token.txt"]="a".repeat(40)],
    ["wrong verifier SHA",r=>r.git_blobs["scripts/verify_ci_run.py"]="BAD"],
    ["native guest claim",r=>r.guest_runtime_certified=true],
    ["native CI claim",r=>r.source_repository_native_ci_certified=true],
    ["copied private source claim",r=>r.private_runtime_or_compiler_source_transferred=true],
    ["source-free classification removed",r=>r.source_free_only=false],
    ["unsupported schema",r=>r.schema="oreslang.source_free_ci_verifier_99999.v1"],
    ["schema round-count disagreement",r=>r.tests_per_round=81],
    ["zero rounds",r=>r.rounds=0],
    ["implausible rounds",r=>r.rounds=13],
    ["missing total",r=>delete r.expected_total],
    ["run ID boolean",r=>r.run_id=true],
    ["run attempt zero",r=>r.run_attempt=0],
    ["forged extra field",r=>r.parityCertified=true],
    ["bad carrier SHA",r=>r.carrier_head_sha="0".repeat(39)],
  ];
  for(const [label,mutate] of cases){
    const receipt=sourceFree82();
    mutate(receipt);
    assert.throws(()=>checkSourceFree(receipt),/INVALID_FIVE_BACKEND_EVIDENCE/,label);
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

test("77-case source-free carrier evidence never authenticates any native backend",()=>{
  // Independent, digest-pinned, real GitHub-hosted run with three rounds of
  // 77 verifier tests. No backend-native compiler or guest ran in this job.
  const report={
    repository:"scintilla-run-test/gleam-runner-conformance",
    runId:38996750516,runAttempt:1,
    carrierHeadSha:"cb37064568d13cd2b051940d01f148a5a13d1b07",
    carrierTreeSha:"b73b0af44ef5c1ba60d5186901f213bfaa7bd5ad",
    jobId:117290889613,jobName:"source-free-77",
    rounds:3,testsPerRound:77,totalExecuted:231,
    verifierBlob:"de7b3921a66c32f50115ee9933ef4e391ec34f8f",
    verifierTestsBlob:"b73b3c06da3170294b5dfb589ba2131af217d268",
    artifactZipSha256:"f6f2f42fbb614ca5f7b9b5defa5e6eace150ffeeb29be268059b9a93efcea901",
    sourceFreeOnly:true,guestRuntimeCertified:false,
    sourceRepositoryNativeCiCertified:false
  };
  assert.equal(report.rounds*report.testsPerRound,report.totalExecuted);
  assert.equal(check(base()).claimedExecutionCount,0);

  // Native evidence must be bound to the exact source repository ID,
  // source Git blob, actual native execution and an authenticated CI record.
  const fake=base();
  fake.records[0]=executed(BACKENDS[0]);
  Object.assign(fake.records[0].execution,{
    repositoryId:1323598260, // the carrier, not any compiler repository
    headCommitSha:report.carrierHeadSha,headTreeSha:report.carrierTreeSha,
    runId:report.runId,runAttempt:report.runAttempt,jobId:report.jobId,
    runnerJob:report.jobName,testStep:"Run source-free regression suite",
    executedTestCount:report.totalExecuted,
    compilerExecuted:false,nativeGuestExecuted:false,
    artifactSha256:report.artifactZipSha256,
    sourceGitBlobSha:report.verifierBlob
  });
  reject(fake);

  for(const backend of BACKENDS){
    const x=base();
    x.records=BACKENDS.map(executed);
    const record=x.records.find(r=>r.backend===backend);
    record.execution.compilerExecuted=false;
    record.execution.nativeGuestExecuted=false;
    record.execution.artifactSha256=report.artifactZipSha256;
    reject(x);
  }
  const claiming=base();
  claiming.records=BACKENDS.map(executed);
  // Five structurally plausible *native* declarations are still
  // unauthenticated even if the same source-free artifact digest is copied.
  for(const r of claiming.records)
    r.execution.artifactSha256=report.artifactZipSha256;
  const result=check(claiming);
  assert.equal(result.claimedExecutionCount,5);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
  assert.equal(result.blocked.length,5);
});

test("reject Unicode bidi and zero-width CI identity spoofing",()=>{
  // The exact-run Python verifier rejects Cc/Cf/Cs/Zl/Zp categories.
  // Shape-only JS evidence must not be more permissive about displayed
  // runner, job, step or toolchain identities.
  for (const key of ["runnerName","runnerJob","testStep","toolchain"]) {
    for (const invisible of [
      "\u202e",  // right-to-left override
      "\u2066",  // left-to-right isolate
      "\u200b",  // zero-width space
      "\u200d",  // zero-width joiner
      "\ufeff",  // byte order mark / invisible formatter
      "\u0085",  // next-line separator
      "\u2028",  // Unicode line separator
      "\u2029",  // Unicode paragraph separator
      "\ud800"   // lone surrogate code point
    ]) {
      const x=base();
      x.records[0]=executed(BACKENDS[0]);
      x.records[0].execution[key]="approved" + invisible + "native";
      reject(x);
    }
  }
  // Legible Unicode characters may be allowed, but shape validation
  // must NEVER transform the claim into execution authentication.
  const legible=base();
  legible.records[0]=executed(BACKENDS[0]);
  legible.records[0].execution.runnerName="Exécuteur natif";
  const result=check(legible);
  assert.equal(result.claimedExecutionCount,1);
  assert.equal(result.nativeExecutionAuthenticated,false);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
});

test("deny whitespace and case disguised runner-housekeeping proof steps",()=>{
  for (const spoof of [
    " set UP JOB ", " COMPLETE JOB ", " initialize CONTAINERS ",
    " STOP Containers ", " pOsT Checkout ", " PRE Cleanup ",
    "pre checkout", "post checkout", "SET   UP    JOB",
    "SET\u00a0UP\u00a0JOB", "Ｓｅｔ ｕｐ ｊｏｂ",
    "Ｐｏｓｔ Checkout", "Complete　job"
  ]) {
    const x=base();
    x.records[0]=executed(BACKENDS[0]);
    x.records[0].execution.testStep=spoof;
    reject(x);
  }
  const x=base();
  x.records[0]=executed(BACKENDS[0]);
  x.records[0].execution.testStep="Run native guest fixtures";
  const result=check(x);
  assert.equal(result.authenticatedExecutionCount,0);
  assert.equal(result.blocked.length,5);
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
