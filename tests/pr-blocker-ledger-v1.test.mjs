import test from "node:test";
import assert from "node:assert/strict";
import {STATES,utcDays,classifyJobEvidence,discoverOpenPRs,
  collectExactHeadEvidence,alertDelta,exportCandidateGate,releaseReadiness,
  persistSnapshot} from "../lib/pr-blocker-ledger-v1.mjs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const H="a".repeat(40);
const run={head_sha:H,status:"completed",conclusion:"failure",id:42,run_attempt:2};
const job={id:8,status:"completed",conclusion:"failure",runner_id:10};

test("UTC day partitions include leap days and fail on bad bounds",()=>{
  assert.deepEqual(utcDays("2024-02-28","2024-03-01"),["2024-02-28","2024-02-29","2024-03-01"]);
  assert.throws(()=>utcDays("2026-02-30","2026-03-01"));
  assert.throws(()=>utcDays("2026-11-07","2026-11-06"));
});
test("completed failed no-step is not an executed test failure",()=>{
  assert.equal(classifyJobEvidence({expectedHead:H,run,job,steps:[]}).state,STATES.OBSERVED_NO_STEP_FAILURE);
  assert.equal(classifyJobEvidence({expectedHead:H,run,job,steps:null}).state,STATES.UNOBSERVED);
  assert.equal(classifyJobEvidence({expectedHead:H,run,job}).state,STATES.UNOBSERVED);
});
test("head mismatch defeats apparently successful step",()=>{
  const result=classifyJobEvidence({expectedHead:H,run:{...run,head_sha:"b".repeat(40),conclusion:"success"},
    job:{...job,conclusion:"success"},steps:[{name:"Run compiler",status:"completed",conclusion:"success"}],
    trustedStepNames:["Run compiler"]});
  assert.equal(result.state,STATES.UNOBSERVED);
});
test("execution proof requires trusted step and actual runner",()=>{
  const setup=[{name:"Set up job",status:"completed",conclusion:"failure"}];
  assert.equal(classifyJobEvidence({expectedHead:H,run,job,steps:setup,trustedStepNames:["Run compiler"]}).state,STATES.UNOBSERVED);
  const real=[{name:"Run compiler",status:"completed",conclusion:"failure"}];
  assert.equal(classifyJobEvidence({expectedHead:H,run,job:{...job,runner_id:0},steps:real,trustedStepNames:["Run compiler"]}).state,STATES.UNOBSERVED);
  assert.equal(classifyJobEvidence({expectedHead:H,run,job,steps:real,trustedStepNames:["Run compiler"]}).state,STATES.EXECUTED_FAIL);
});
test("skipped cancelled and pending are distinct",()=>{
  assert.equal(classifyJobEvidence({expectedHead:H,run,job:{...job,status:"queued",conclusion:null},steps:[]}).state,STATES.PENDING);
  assert.equal(classifyJobEvidence({expectedHead:H,run,job:{...job,conclusion:"skipped"},steps:[]}).state,STATES.SKIPPED);
  assert.equal(classifyJobEvidence({expectedHead:H,run,job:{...job,conclusion:"cancelled"},steps:[]}).state,STATES.CANCELLED);
});
test("host execution pass is never guest certification",()=>{
  const result=classifyJobEvidence({expectedHead:H,run:{...run,conclusion:"success"},
    job:{...job,conclusion:"success"},steps:[{name:"Run compiler",status:"completed",conclusion:"success"}],
    trustedStepNames:["Run compiler"]});
  assert.equal(result.state,STATES.EXECUTED_PASS);
  assert.equal(result.guestCertified,false);
});
test("repository/day search is paginated and deduplicated",async()=>{
  const calls=[];
  const result=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:2,
    listRepositories:async()=>({items:["example/compiler"],complete:true}),
    searchPage:async p=>{calls.push(p);return p.page===1?
      {items:[{number:2},{number:3}],totalCount:3}:{items:[{number:3}],totalCount:3};},
    readHead:async()=>({head_sha:H,state:"open"})
  });
  assert.equal(calls.length,2);assert.equal(result.prs.length,2);
  assert.equal(result.complete,true);assert.equal(result.prs[0].headVerified,true);
});
test("1000-result cap, incomplete repo listing, and unverified heads are disclosed",async()=>{
  const r=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:100,maxPages:1,
    listRepositories:async()=>({items:["example/compiler"],complete:false}),
    searchPage:async()=>({items:[{number:1}],totalCount:1000})});
  assert.equal(r.complete,false);
  assert.ok(r.gaps.some(x=>x.kind==="SEARCH_1000_CAP"));
  assert.ok(r.gaps.some(x=>x.kind==="REPO_LIST_INCOMPLETE"));
  assert.ok(r.gaps.some(x=>x.kind==="HEAD_LOOKUP_NOT_PROVIDED"));
});
test("all jobs get individually queried steps; null remains UNOBSERVED",async()=>{
  const calls=[];
  const r=await collectExactHeadEvidence({repo:"example/compiler",head:H,
    listRuns:async()=>({items:[run],complete:true}),
    listJobs:async()=>({items:[job,{...job,id:9}],complete:true}),
    listSteps:async(_repo,id)=>{calls.push(id);return{steps:id===8?[]:null};}});
  assert.deepEqual(calls,[8,9]);
  assert.deepEqual(r.records.map(x=>x.state),
    [STATES.OBSERVED_NO_STEP_FAILURE,STATES.UNOBSERVED]);
});
test("first-page-only run or job results are not exhaustive",async()=>{
  const r=await collectExactHeadEvidence({repo:"example/compiler",head:H,
    listRuns:async()=>({items:[run],complete:false}),
    listJobs:async()=>({items:[job],complete:false}),
    listSteps:async()=>({steps:[]})});
  assert.equal(r.complete,false);
  assert.ok(r.gaps.some(x=>x.kind==="RUN_PAGINATION_UNVERIFIED"));
  assert.ok(r.gaps.some(x=>x.kind==="JOB_PAGINATION_UNVERIFIED"));
});
test("alert fingerprint ignores SHA changes but detects consequence changes",()=>{
  const old={repository:"x/y",number:1,cause:"runner",scope:"CI",impact:"no tests",
    status:"open",severity:"P1",head:H,actionable:true};
  assert.equal(alertDelta([old],[{...old,head:"b".repeat(40)}]).length,0);
  assert.equal(alertDelta([old],[{...old,impact:"possible source leak"}]).length,1);
});
test("all eleven source-transfer prerequisites fail closed individually",()=>{
  const all=Object.fromEntries(exportCandidateGate().missing.map(k=>[k,true]));
  assert.equal(exportCandidateGate(all).eligibleForFurtherIndependentAuthorization,true);
  for(const key of Object.keys(all)){
    assert.equal(exportCandidateGate({...all,[key]:false}).eligibleForFurtherIndependentAuthorization,false,key);
    assert.equal(exportCandidateGate({...all,[key]:null}).eligibleForFurtherIndependentAuthorization,false,key);
  }
  assert.equal(exportCandidateGate(all).exportPerformed,false);
});
test("host-only five-backend passes are NOT_CERTIFIED for release",()=>{
  const backends=["java","llvm","wasm","net","forge"];
  const evidence=Object.fromEntries(backends.map(b=>[b,{state:STATES.EXECUTED_PASS,guestCertified:false}]));
  const r=releaseReadiness({requiredBackends:backends,evidence,securityIncidentsClear:true,
    approvalPolicyReadable:true,approvalsVerified:true});
  assert.equal(r.status,"NOT_CERTIFIED");assert.equal(r.reasons.length,5);
});
test("five-backend release identity cannot be omitted, truncated, duplicated or substituted",()=>{
  const all=["java","llvm","wasm","net","forge"];
  const evidence=Object.fromEntries(all.map(b=>[b,{state:STATES.EXECUTED_PASS,guestCertified:true}]));
  const flags={evidence,securityIncidentsClear:true,approvalPolicyReadable:true,approvalsVerified:true};
  for(const invalid of [[],["java"],["java","llvm","wasm","net"],
    ["java","llvm","wasm","net","net"],["java","llvm","wasm","net","fake"],
    null,"java",{}]){
    const result=releaseReadiness({...flags,requiredBackends:invalid});
    assert.equal(result.status,"NOT_CERTIFIED");
    assert.ok(result.reasons.includes("BACKEND_SET_INVALID"),JSON.stringify(invalid));
  }
  assert.equal(releaseReadiness(flags).status,"CANDIDATE_ONLY");
  assert.equal(releaseReadiness({...flags,requiredBackends:[...all].reverse()}).status,"CANDIDATE_ONLY");
  for(const missing of all){
    const altered={...evidence,[missing]:{state:STATES.EXECUTED_PASS,guestCertified:false}};
    const result=releaseReadiness({...flags,evidence:altered});
    assert.equal(result.status,"NOT_CERTIFIED");
    assert.ok(result.reasons.includes("BACKEND_NOT_CERTIFIED:"+missing));
  }
});

test("opt-in local persistence writes a schema versioned JSON snapshot",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"atto-ledger-"));
  try{const file=join(dir,"ledger.json");
    await persistSnapshot(file,{prs:[{repository:"x/y",number:1}]});
    const saved=JSON.parse(await readFile(file,"utf8"));
    assert.equal(saved.schema,1);assert.equal(saved.prs.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
