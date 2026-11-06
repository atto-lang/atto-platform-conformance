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
      {items:[{number:2},{number:3}],totalCount:3}:{items:[{number:1}],totalCount:3};},
    readHead:async()=>({head_sha:H,state:"open"})
  });
  assert.equal(calls.length,2);assert.equal(result.prs.length,3);
  assert.equal(result.complete,true);assert.equal(result.prs[0].headVerified,true);
});
test("overlapping GitHub search pages never certify missing PRs",async()=>{
  const r=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:2,maxPages:2,
    listRepositories:async()=>({items:["example/compiler"],complete:true}),
    searchPage:async p=>p.page===1
      ?{items:[{number:2},{number:3}],totalCount:3}
      :{items:[{number:3}],totalCount:3},
    readHead:async()=>({head_sha:H,state:"open"})});
  assert.equal(r.prs.length,2);
  assert.equal(r.partitions[0].seen,2);
  assert.equal(r.complete,false);
  assert.ok(r.gaps.some(x=>x.kind==="DUPLICATE_PR_PAGE"&&x.number===3));
  assert.ok(r.gaps.some(x=>x.kind==="PARTITION_INCOMPLETE"));
});
test("changing pagination totals are disclosed even if enough PRs were seen",async()=>{
  const r=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:2,maxPages:2,
    listRepositories:async()=>({items:["example/compiler"],complete:true}),
    searchPage:async p=>p.page===1
      ?{items:[{number:1},{number:2}],totalCount:3}
      :{items:[{number:3}],totalCount:4},
    readHead:async()=>({head_sha:H,state:"open"})});
  assert.equal(r.complete,false);
  assert.ok(r.gaps.some(x=>x.kind==="TOTAL_COUNT_CHANGED"&&x.previous===3&&x.current===4));
});
test("null, unsafe, duplicate and oversized search records fail closed without crashing",async()=>{
  const r=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:2,maxPages:1,
    listRepositories:async()=>({items:["example/compiler"],complete:true}),
    searchPage:async()=>({items:[null,{number:2},{number:2},{number:9007199254740992}],totalCount:2}),
    readHead:async()=>({head_sha:H,state:"open"})});
  assert.equal(r.complete,false);
  assert.equal(r.prs.length,1);
  for(const kind of ["PAGE_OVERSIZED","UNTRUSTED_ITEM","DUPLICATE_PR_PAGE"])
    assert.ok(r.gaps.some(x=>x.kind===kind),kind);
});
test("a genuinely empty daily inventory is complete, not an error",async()=>{
  const r=await discoverOpenPRs({start:"2026-11-05",end:"2026-11-05",perPage:100,
    listRepositories:async()=>({items:["example/compiler"],complete:true}),
    searchPage:async()=>({items:[],totalCount:0})});
  assert.equal(r.prs.length,0);
  assert.equal(r.complete,true);
  assert.equal(r.partitions[0].seen,0);
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
test("empty or missing run and job inventories fail closed even if adapter claims complete",async()=>{
  for(const items of [[],null,undefined]){
    const r=await collectExactHeadEvidence({repo:"example/compiler",head:H,
      listRuns:async()=>({items,complete:true}),
      listJobs:async()=>({items:[job],complete:true}),
      listSteps:async()=>({steps:[]})});
    assert.equal(r.complete,false);
    assert.equal(r.records.length,0);
    assert.ok(r.gaps.some(x=>x.kind===(Array.isArray(items)?"NO_RUNS_FOUND":"RUN_LIST_UNOBSERVED")));
  }
  for(const items of [[],null,undefined]){
    const r=await collectExactHeadEvidence({repo:"example/compiler",head:H,
      listRuns:async()=>({items:[run],complete:true}),
      listJobs:async()=>({items,complete:true}),
      listSteps:async()=>({steps:[]})});
    assert.equal(r.complete,false);
    assert.equal(r.records.length,0);
    assert.ok(r.gaps.some(x=>x.kind===(Array.isArray(items)?"NO_JOBS_FOUND":"JOB_LIST_UNOBSERVED")));
  }
});
test("missing steps, invalid identities and duplicates cannot satisfy evidence completeness",async()=>{
  const gather=async(runs,jobs,steps)=>collectExactHeadEvidence({repo:"example/compiler",head:H,
    listRuns:async()=>({items:runs,complete:true}),
    listJobs:async()=>({items:jobs,complete:true}),
    listSteps:async()=>({steps})});
  const missing=await gather([run],[job],null);
  assert.equal(missing.complete,false);
  assert.equal(missing.records[0].state,STATES.UNOBSERVED);
  assert.ok(missing.gaps.some(x=>x.kind==="STEPS_UNOBSERVED"));
  const observed=await gather([run],[job],[]);
  assert.equal(observed.complete,true); // Complete inventory, but NOT successful execution.
  assert.equal(observed.records[0].state,STATES.OBSERVED_NO_STEP_FAILURE);
  for(const [runs,jobs,expectedKind] of [
    [[{...run,id:0}],[job],"RUN_IDENTITY_UNVERIFIED"],
    [[{...run,run_attempt:0}],[job],"RUN_IDENTITY_UNVERIFIED"],
    [[{...run,run_attempt:9007199254740992}],[job],"RUN_IDENTITY_UNVERIFIED"],
    [[run,run],[job],"DUPLICATE_RUN_ATTEMPT"],
    [[run],[{...job,id:0}],"JOB_IDENTITY_UNVERIFIED"],
    [[run],[job,job],"DUPLICATE_JOB"]]){
    const result=await gather(runs,jobs,[]);
    assert.equal(result.complete,false,expectedKind);
    assert.ok(result.gaps.some(x=>x.kind===expectedKind),expectedKind);
  }
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
