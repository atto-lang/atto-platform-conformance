import test from "node:test";
import assert from "node:assert/strict";
import {classifyAttoRun} from "../lib/atto-library-run-evidence-v1.mjs";

const head="a".repeat(40);
const workflow=".github/workflows/atto-library-profiles-v1.yml";
const baseRun=()=>({id:987,head_sha:head,path:workflow,run_attempt:3,
  status:"completed",conclusion:"success"});
const baseJob=()=>({id:654,run_id:987,run_attempt:3,head_sha:head,
  name:"compiler",status:"completed",conclusion:"success",runner_id:21,
  steps:[
    {number:1,name:"Exact checkout",status:"completed",conclusion:"success"},
    {number:2,name:"Compile actual guest",status:"completed",conclusion:"success"}
  ]});
const classify=(run,jobs)=>classifyAttoRun({run,jobs,expectedHead:head,
  expectedJob:"compiler",expectedWorkflowPath:workflow,
  requiredSteps:["Exact checkout","Compile actual guest"]});

test("only an allocated, successful, exact-step job is eligible for receipt audit",()=>{
  const out=classify(baseRun(),[baseJob()]);
  assert.deepEqual(out,{classification:"EXECUTED_STEPS_UNVERIFIED",
    reason:"REQUIRES_INDEPENDENT_RECEIPT_AUDIT",executedSteps:2});
  // Even this label is NOT proof of guest execution or merge readiness:
  // receipt/tree/compiler/artifact verification remains outside this module.
});

test("forged failed step with no allocated runner must never imply execution",()=>{
  const j=baseJob(); j.runner_id=0; j.conclusion="failure";
  j.steps[1].conclusion="failure";
  const out=classify({...baseRun(),conclusion:"failure"},[j]);
  assert.equal(out.classification,"UNTRUSTED_EVIDENCE");
  assert.equal(out.executedSteps,0);
});

test("deterministic adversarial matrix cannot upgrade bad metadata to step evidence",()=>{
  const invalidChanges=[
    j=>{j.steps[0].status="queued";},
    j=>{j.steps[0].conclusion="skipped";},
    j=>{j.steps[0].number=7;},
    j=>{j.steps[0].name="Unknown";},
    j=>{j.runner_id=0;},
    j=>{j.head_sha="b".repeat(40);},
    j=>{j.run_attempt=2;},
    j=>{j.steps[1].status="queued";},
    j=>{j.steps[1].conclusion="skipped";},
    j=>{j.steps[1].number=7;},
    j=>{j.steps[1].name="Unknown";},
    j=>{j.runner_id=null;},
    j=>{j.run_id=988;},
    j=>{j.steps[1].conclusion="neutral";}
  ];
  let checked=0;
  for(let repetition=0;repetition<40;repetition++) {
    for(let i=0;i<invalidChanges.length;i++) {
      const j=baseJob();
      invalidChanges[i](j);
      if(repetition%2===1) j.steps=[...j.steps].map(step=>({...step}));
      const out=classify(baseRun(),[j]);
      assert.notEqual(out.classification,"EXECUTED_STEPS_UNVERIFIED",
        "invalid mutation "+i+" / "+repetition+" was promoted");
      checked++;
    }
  }
  assert.equal(checked,560);
});

test("failed and cancelled zero-step jobs are not execution proof",()=>{
  const fixtures=[
    ["failure","failure",0,"RUNNER_ADMISSION_FAILURE"],
    ["cancelled","cancelled",0,"NOT_EXECUTED"],
    ["success","skipped",0,"NOT_EXECUTED"],
    ["failure","failure",null,"UNTRUSTED_EVIDENCE"],
    ["success","success",0,"UNTRUSTED_EVIDENCE"],
    ["timed_out","failure",0,"UNTRUSTED_EVIDENCE"]
  ];
  for(const [runResult,jobResult,runner,expected] of fixtures) {
    const run={...baseRun(),conclusion:runResult};
    const job={...baseJob(),conclusion:jobResult,runner_id:runner,steps:[]};
    const result=classify(run,[job]);
    assert.equal(result.classification,expected,
      runResult+" / "+jobResult+" / "+runner);
    assert.equal(result.executedSteps,0);
  }
});
