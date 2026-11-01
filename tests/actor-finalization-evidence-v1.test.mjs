import test from "node:test";
import assert from "node:assert/strict";
import {ACTOR_FINALIZATION_BACKENDS, validateActorFinalizationReceipt as check,
  validateActorFinalizationLedger as ledger,
  actorFinalizationReleaseGate as release} from "../src/actor-finalization-evidence-v1.mjs";

const HEAD="a".repeat(40);
function receipt(){return {
  sourceHead:HEAD, sourceTree:"b".repeat(40),
  workflowStatus:"completed", workflowConclusion:"success",
  jobs:[{id:17,runnerId:12,conclusion:"success",requiredTestStep:"Test guest",
    steps:[{name:"Setup",status:"completed",conclusion:"success"},
      {name:"Test guest",status:"completed",conclusion:"success"}]}],
  compilerSha256:"c".repeat(64),artifactSha256:"d".repeat(64),
  compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:["AF01","AF02"]
};}
function reject(change,expected){
  const value=receipt();change(value);
  const result=check(HEAD,value);
  assert.equal(result.shapeReady,false,expected);
  assert.equal(result.parityCertified,false);
  assert.ok(result.errors.includes(expected),
    `${expected}: ${result.errors.join(",")}`);
}
test("AF20: shape-valid self report is not authenticated execution",()=>{
  const result=check(HEAD,receipt());
  assert.equal(result.shapeReady,true);
  assert.equal(result.independentlyAuthenticated,false);
  assert.equal(result.parityCertified,false);
});
test("AF20: no runner is non-evidence",()=>reject(r=>r.jobs[0].runnerId=0,"RUNNER_NOT_ASSIGNED"));
test("AF20: zero-step and setup-only jobs are non-evidence",()=>{
  reject(r=>r.jobs[0].steps=[],"ZERO_EXECUTED_STEPS");
  reject(r=>r.jobs[0].steps.pop(),"REQUIRED_TEST_STEP_NOT_EXECUTED");
});
test("AF20: wrong source head is non-evidence",()=>
  reject(r=>r.sourceHead="e".repeat(40),"EXACT_HEAD_MISMATCH"));
test("AF20: bogus compiler and artifact digests are rejected",()=>{
  reject(r=>r.compilerSha256="not-a-digest","COMPILER_DIGEST_MISSING");
  reject(r=>r.artifactSha256="x".repeat(64),"ARTIFACT_DIGEST_MISSING");
});
test("AF20: duplicate job IDs cannot inflate receipts",()=>
  reject(r=>r.jobs.push({...r.jobs[0]}),"MISSING_OR_DUPLICATE_JOB_ID"));
test("AF20: compiler and guest execution must be explicit",()=>{
  reject(r=>r.compilerExecuted=false,"GUEST_EXECUTION_NOT_SHOWN");
  reject(r=>r.nativeGuestExecuted=false,"GUEST_EXECUTION_NOT_SHOWN");
});
test("AF20: models and unsupported-source rejection never count as parity",()=>{
  reject(r=>r.hostModelOnly=true,"SAFETY_OR_MODEL_NOT_GUEST_PARITY");
  reject(r=>r.rejectionOnly=true,"SAFETY_OR_MODEL_NOT_GUEST_PARITY");
});
test("AF20: AF scenario numbers must be unique and within AF01..AF20",()=>{
  reject(r=>r.scenarioIds=["AF03","AF03"],"SCENARIOS_INVALID");
  reject(r=>r.scenarioIds=["AF21"],"SCENARIOS_INVALID");
  reject(r=>r.scenarioIds=[],"SCENARIOS_INVALID");
});
test("all five backends remain separate and unverified",()=>{
  assert.deepEqual(ACTOR_FINALIZATION_BACKENDS,["java","llvm","wasm","cranelift","net"]);
  const backends=ACTOR_FINALIZATION_BACKENDS.map(backend=>({backend,status:"unverified"}));
  assert.deepEqual(ledger({backends}),{valid:true,parityCertified:false,errors:[]});
  assert.ok(ledger({backends:backends.slice(1)}).errors.includes(
    "MISSING_DUPLICATE_OR_UNKNOWN_BACKEND"));
  assert.ok(ledger({backends:[...backends.slice(0,4),backends[0]]).errors.includes(
    "MISSING_DUPLICATE_OR_UNKNOWN_BACKEND"));
  backends[0].status="guest-claimed";
  assert.ok(ledger({backends}).errors.includes("GUEST_CLAIM_WITHOUT_RECEIPT"));
});
test(".NET must be strict Native AOT; LLVM/Cranelift/Forge sanitized",()=>{
  assert.ok(release({backend:"net",shapeReady:true,independentlyAuthenticated:true})
    .errors.includes("NET_NATIVE_AOT_REQUIRED"));
  for(const backend of ["llvm","cranelift","forge"])
    assert.ok(release({backend,shapeReady:true,independentlyAuthenticated:true})
      .errors.includes("NATIVE_SANITIZERS_REQUIRED"));
  const locallyClaimed = release({backend:"net",strictAot:true,shapeReady:true,
    independentlyAuthenticated:true});
  assert.equal(locallyClaimed.shapeRequirementsMet,true);
  assert.equal(locallyClaimed.ready,false,
    "offline flags must never authorize release");
  assert.equal(locallyClaimed.independentProviderVerificationRequired,true);
});
test("local receipt shape alone cannot authorize merger or parity",()=>{
  assert.equal(release({backend:"java",shapeReady:true}).ready,false);
  assert.equal(check(HEAD,receipt()).parityCertified,false);
});

test("AF20: missing named test step never counts as executed",()=>{
  reject(r=>{delete r.jobs[0].requiredTestStep;
    r.jobs[0].steps.push({status:"completed",conclusion:"success"});},
    "REQUIRED_TEST_STEP_NOT_EXECUTED");
  reject(r=>r.jobs[0].requiredTestStep="   ","REQUIRED_TEST_STEP_NOT_EXECUTED");
});
test("AF20: coerced objects cannot masquerade as Git commit digests",()=>{
  reject(r=>r.sourceTree={toString:()=> "b".repeat(40)},"TREE_SHA_MISSING");
  reject(r=>r.compilerSha256={toString:()=> "c".repeat(64)},"COMPILER_DIGEST_MISSING");
});
test("AF20: forged scenario objects cannot count as canonical IDs",()=>{
  reject(r=>r.scenarioIds=[{toString:()=> "AF01"}],"SCENARIOS_INVALID");
});

test("AF20: bounded receipts reject oversized jobs and steps",()=>{
  reject(r=>{r.jobs=Array.from({length:65},(_,id)=>({...r.jobs[0],id:id+1}));},
    "JOB_OR_STEP_BUDGET_EXCEEDED");
  reject(r=>{r.jobs[0].steps=Array.from({length:129},()=>({
    name:"Test guest",status:"completed",conclusion:"success"}));},
    "JOB_OR_STEP_BUDGET_EXCEEDED");
  reject(r=>{r.jobs[0].requiredTestStep="x".repeat(129);},
    "REQUIRED_TEST_STEP_NOT_EXECUTED");
});
test("AF20: scenario budget cannot be enlarged beyond canonical twenty",()=>{
  reject(r=>{r.scenarioIds=Array.from({length:21},(_,i)=>"AF"+
    String((i%20)+1).padStart(2,"0"));}, "SCENARIOS_INVALID");
});
