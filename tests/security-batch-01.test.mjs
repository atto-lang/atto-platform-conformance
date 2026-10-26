import test from "node:test";
import assert from "node:assert/strict";
import {auditSecurityBatch,classifyWorkflowJob,classifyPinnedRun,policyLines,
  SOURCE_REPOS,CARRIERS,SAMPLE_RUNS} from "../bin/audit-security-batch-01.mjs";

const encoded=text=>({type:"file",encoding:"base64",
  content:Buffer.from(text,"utf8").toString("base64")});
function makeFixture(overrides={}) {
  const requests=[];
  const identities=new Map([...SOURCE_REPOS,...CARRIERS]);
  const fetchImpl=async (url,opts)=>{
    requests.push({url,method:opts.method,redirect:opts.redirect});
    assert.equal(opts.method,"GET");
    assert.equal(opts.redirect,"error");
    const path=new URL(url).pathname.replace(/^\/repos\//,"");
    const pieces=path.split("/");
    const repo=pieces.slice(0,2).join("/");
    const resource=pieces.slice(2).join("/");
    const fixtureKey=resource?repo+"/"+resource:repo;
    if(Object.hasOwn(overrides,fixtureKey)){
      const value=overrides[fixtureKey];
      return {status:value?.httpStatus||200,json:async()=>value?.payload??value};
    }
    if(identities.has(repo)){
      if(resource===""){
        return {status:200,json:async()=>({
          id:identities.get(repo),full_name:repo,private:true,
          visibility:"private",disabled:false,archived:false
        })};
      }
      if(resource==="branches/main"){
        return {status:200,json:async()=>({
          name:"main",protected:false,commit:{sha:"a".repeat(40)}
        })};
      }
      if(resource.startsWith("contents/.github/"))
        return {status:200,json:async()=>encoded("# no approvals\n")};
      if(/^actions\/runs\/\d+$/.test(resource)){
        const id=Number(resource.split("/")[2]);
        const fixture=SAMPLE_RUNS.find(([n,i])=>n===repo&&i===id);
        return {status:200,json:async()=>({
          id,repository:{id:identities.get(repo),full_name:repo},
          head_sha:fixture?.[2],run_attempt:1,status:"completed"
        })};
      }
      if(/^actions\/runs\/\d+\/jobs$/.test(resource))
        return {status:200,json:async()=>({total_count:1,jobs:[{
          id:42,run_id:Number(resource.split("/")[2]),
          name:"test",status:"completed",conclusion:"failure",steps:null
        }]})};
    }
    if(repo==="ores-truffle-oreslang/oreslang-platform-conformance" &&
       /^issues\/(22|77)$/.test(resource)){
      return {status:200,json:async()=>({
        number:Number(resource.split("/")[1]),state:"open"
      })};
    }
    return {status:404,json:async()=>({message:"not found"})};
  };
  return {fetchImpl,requests};
}
test("classifies absent and null step arrays as UNOBSERVED, never as zero-step compiler failure",()=>{
  assert.equal(classifyWorkflowJob({status:"completed"}),"UNOBSERVED");
  assert.equal(classifyWorkflowJob({status:"completed",steps:null}),"UNOBSERVED");
  assert.equal(classifyWorkflowJob({status:"completed",steps:[]}),"NO_RECORDED_STEPS");
  assert.equal(classifyWorkflowJob({status:"queued",steps:null}),"NOT_TERMINAL");
});
test("rejects step names without actual step execution timestamps",()=>{
  const job={status:"completed",steps:[{name:"Maven verify",status:"completed",
    conclusion:"success"}]};
  assert.equal(classifyWorkflowJob(job),"NO_TIMESTAMPED_STEPS");
  job.steps[0].started_at="2026-10-19T00:00:00Z";
  job.steps[0].completed_at="2026-10-19T00:00:01Z";
  assert.equal(classifyWorkflowJob(job),"TIMESTAMPED_STEPS_REPORTED");
});
test("skipped steps do not count as execution",()=>{
  assert.equal(classifyWorkflowJob({status:"completed",steps:[{status:"completed",
    conclusion:"skipped",started_at:"T1",completed_at:"T2"}]}),"NO_TIMESTAMPED_STEPS");
});
test("empty commented policy is not authorization",()=>{
  assert.equal(policyLines(encoded("# comment\n\n")),"NO_ACTIVE_ENTRIES");
  assert.equal(policyLines(encoded("some-org/repo 123\n")),"NONEMPTY_REQUIRES_INDEPENDENT_REVIEW");
});
test("noncanonical, invalid and oversized policy metadata fail closed",()=>{
  assert.equal(policyLines({type:"file",encoding:"base64",content:"abc==="}),"UNVERIFIABLE");
  assert.equal(policyLines({type:"file",encoding:"base64",content:"!!!!"}),"UNVERIFIABLE");
  assert.equal(policyLines(encoded("x\u0000y")),"UNVERIFIABLE");
  assert.equal(policyLines({type:"file",encoding:"base64",content:"A".repeat(131073)}),"UNVERIFIABLE");
});
test("realistic unprotected baseline denies export, without writing Git data",async()=>{
  const {fetchImpl,requests}=makeFixture();
  const report=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(report.privateSourceExport,"DENIED");
  assert.equal(report.incidentClosure,"NOT_ATTESTED");
  assert.equal(report.ciCompilerTests,"NOT_ATTESTED");
  assert.equal(report.billingCause,"UNKNOWN");
  assert.equal(report.items.length,10);
  assert.equal(report.sources.length,SOURCE_REPOS.length);
  assert.equal(report.carriers.length,CARRIERS.length);
  assert.equal(report.sources[0].branch,"UNPROTECTED");
  assert.equal(report.sources[0].policies["private-ci-approved-repositories.txt"],"NO_ACTIVE_ENTRIES");
  assert.equal(report.runs[0].jobEvidence[0],"UNOBSERVED");
  assert.equal(report.incidents[0].state,"open");
  assert.ok(requests.length>15);
  assert.ok(requests.every(r=>r.method==="GET"&&r.redirect==="error"));
  assert.ok(requests.every(r=>!r.url.includes("/git/blobs")&&!r.url.includes("/git/refs") &&
    !r.url.includes("/src/")&&!r.url.includes("/secrets")));
  assert.ok(!JSON.stringify(report).includes("synthetic"));
});
test("public carrier remains identity mismatch, never authorized",async()=>{
  const key="zed-pkg-test/java-app";
  const {fetchImpl}=makeFixture({[key]:{
    id:1323575966,full_name:key,private:false,visibility:"public",
    disabled:false,archived:false
  }});
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.carriers[0].identity,"IDENTITY_OR_VISIBILITY_MISMATCH");
  assert.equal(result.privateSourceExport,"DENIED");
});
test("repository name continuity is insufficient without immutable numeric identity",async()=>{
  const name=SOURCE_REPOS[0][0],{fetchImpl}=makeFixture({[name]:{
    id:123,full_name:name,private:true,visibility:"private",
    disabled:false,archived:false
  }});
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.sources[0].identity,"IDENTITY_OR_VISIBILITY_MISMATCH");
});
test("protected flag without readable admin protection is non-certifying",async()=>{
  const name=SOURCE_REPOS[0][0],{fetchImpl}=makeFixture({
    [name+"/branches/main"]:{name:"main",protected:true,commit:{sha:"b".repeat(40)}},
    [name+"/branches/main/protection"]:{httpStatus:403}
  });
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.sources[0].branch,"PROTECTED_FLAG_ONLY");
  assert.equal(result.sources[0].protection,"UNVERIFIABLE");
  assert.equal(result.privateSourceExport,"DENIED");
});
test("even a closed issue is not independent incident completion",async()=>{
  const {fetchImpl}=makeFixture({
    "ores-truffle-oreslang/oreslang-platform-conformance/issues/22":
      {number:22,state:"closed"}
  });
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.incidents[0].state,"closed");
  assert.equal(result.incidents[0].independentlyAccepted,false);
  assert.equal(result.privateSourceExport,"DENIED");
});
test("incomplete run pages cannot be described as complete evidence",async()=>{
  const [name,id]=SAMPLE_RUNS[0],{fetchImpl}=makeFixture({
    [name+"/actions/runs/"+id+"/jobs"]:{total_count:101,jobs:[]}
  });
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.runs[0].coverage,"INCOMPLETE_OR_UNOBSERVED");
});
test("403, 404 and unavailable policy data never imply approvals",async()=>{
  const name=SOURCE_REPOS[0][0],{fetchImpl}=makeFixture({
    [name+"/contents/.github/private-ci-approved-repositories.txt"]:{httpStatus:403},
    [name+"/contents/.github/private-ci-approved-source-snapshots.txt"]:{httpStatus:404}
  });
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.match(result.sources[0].policies["private-ci-approved-repositories.txt"],/^UNVERIFIABLE_/);
  assert.match(result.sources[0].policies["private-ci-approved-source-snapshots.txt"],/^UNVERIFIABLE_/);
});
test("missing credentials are rejected without a GitHub request",async()=>{
  let hits=0;
  await assert.rejects(auditSecurityBatch({token:"",fetchImpl:async()=>{hits++;}}),
    /authenticated read-only GitHub access required/);
  assert.equal(hits,0);
});
test("invalid JSON from one repo never produces a passing identity",async()=>{
  const name=SOURCE_REPOS[0][0];
  const {fetchImpl}=makeFixture({[name]:{httpStatus:502}});
  const result=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(result.sources[0].identity,"UNVERIFIABLE");
  assert.equal(result.privateSourceExport,"DENIED");
});

test("sampled run metadata must bind immutable repo ID, run ID, head and attempt",()=>{
  const [name,id,head]=SAMPLE_RUNS[0];
  const base={id,repository:{id:SOURCE_REPOS[0][1],full_name:name},
    head_sha:head,run_attempt:1,status:"completed"};
  assert.equal(classifyPinnedRun(base,name,id,head),"EXACT_HEAD_RUN_METADATA");
  assert.equal(classifyPinnedRun({...base,head_sha:"f".repeat(40)},name,id,head),
    "MISMATCHED_OR_UNVERIFIABLE");
  assert.equal(classifyPinnedRun({...base,id:id+1},name,id,head),
    "MISMATCHED_OR_UNVERIFIABLE");
  assert.equal(classifyPinnedRun({...base,run_attempt:undefined},name,id,head),
    "MISMATCHED_OR_UNVERIFIABLE");
  assert.equal(classifyPinnedRun({...base,repository:{...base.repository,id:999}},
    name,id,head),"MISMATCHED_OR_UNVERIFIABLE");
  assert.equal(classifyPinnedRun({...base,status:"in_progress"},name,id,head),
    "NOT_TERMINAL");
});
test("mismatched run head prevents even querying unrelated jobs",async()=>{
  const [name,id]=SAMPLE_RUNS[0],{fetchImpl,requests}=makeFixture({
    [name+"/actions/runs/"+id]:{
      id,head_sha:"f".repeat(40),run_attempt:1,status:"completed",
      repository:{id:SOURCE_REPOS[0][1],full_name:name}
    }
  });
  const report=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(report.runs[0].runEvidence,"MISMATCHED_OR_UNVERIFIABLE");
  assert.deepEqual(report.runs[0].jobEvidence,["UNOBSERVED"]);
  assert.ok(!requests.some(r=>r.url.includes("/actions/runs/"+id+"/jobs")));
  assert.equal(report.privateSourceExport,"DENIED");
});
test("foreign workflow job run IDs cannot certify a complete page",async()=>{
  const [name,id]=SAMPLE_RUNS[0],{fetchImpl}=makeFixture({
    [name+"/actions/runs/"+id+"/jobs"]:{total_count:1,jobs:[{
      id:99,run_id:id+1,status:"completed",steps:[{
        status:"completed",conclusion:"success",
        started_at:"2026-10-19T00:00:00Z",completed_at:"2026-10-19T00:01:00Z"
      }]
    }]}
  });
  const report=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(report.runs[0].runEvidence,"EXACT_HEAD_RUN_METADATA");
  assert.equal(report.runs[0].coverage,"INCOMPLETE_OR_UNOBSERVED");
  assert.deepEqual(report.runs[0].jobEvidence,["UNOBSERVED"]);
});
test("source-free run evidence never becomes publisher authorization",async()=>{
  const {fetchImpl}=makeFixture();
  const report=await auditSecurityBatch({token:"synthetic",fetchImpl});
  assert.equal(report.runs.length,SAMPLE_RUNS.length);
  assert.ok(report.runs.every(r=>r.runEvidence==="EXACT_HEAD_RUN_METADATA"));
  assert.ok(report.runs.every(r=>r.jobEvidence[0]==="UNOBSERVED"));
  assert.equal(report.privateSourceExport,"DENIED");
  assert.equal(report.ciCompilerTests,"NOT_ATTESTED");
});
