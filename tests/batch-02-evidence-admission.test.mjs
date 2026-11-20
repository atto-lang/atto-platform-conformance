import test from "node:test";
import assert from "node:assert/strict";
import {auditBenchmarkEvidence,auditAssuranceEvidence,auditReleaseEvidence} from
  "../src/batch-02-evidence-admission.mjs";

const G="a".repeat(40), H="b".repeat(64);
const benchmark=(over={})=>({
  schema:1,backend:"llvm",mode:"aot",sourceCommit:G,sourceTree:G,
  compilerSha256:H,toolchainSha256:H,fixtureSha256:H,machine:"host.cpu",
  phase:"heldout",evidence:"MEASURED",metric:"latency_ns",unit:"ns",
  samples:[5,6,7],modelValue:null,
  run:{repo:"ores-truffle-oreslang/oreslang-source.llvm",head:G,
    runId:10,attempt:1,executedSteps:3},...over
});
const assurance=(over={})=>({
  schema:1,claim:"scalar.overload",level:"L2",backend:"llvm",
  sourceCommit:G,sourceTree:G,typeSpecSha256:H,jsonSchemaSha256:H,
  witSha256:H,contractIrSha256:H,toolSha256:H,proofSha256:H,
  status:"PASS",toolSteps:2,runtimeFixtureSha256:H,...over
});
const release=(over={})=>({
  schema:1,repository:"ores-truffle-oreslang/oreslang-source.llvm",
  prNumber:101,head:G,mergeCommit:"c".repeat(40),sourceTree:G,
  authorId:1,mergerId:2,
  reviewers:[{id:3,state:"APPROVED",reviewedHead:G}],
  protection:{enforced:true,codeowners:true,adminVerified:true},
  ci:{runId:987,attempt:1,testedHead:"c".repeat(40),
    executedTestSteps:4,conclusion:"success",artifactSha256:H},...over
});

test("valid software measured schema is never real benchmark certification",()=>{
  const r=auditBenchmarkEvidence(benchmark());
  assert.equal(r.kind,"SOFTWARE_RUNTIME");
  assert.equal(r.benchmarkCertified,false);
  assert.equal(r.classification,"SOURCE_FREE_SCHEMA_CHECK_ONLY");
});
test("hardware FPGA is distinct from ASIC area and software runtime",()=>{
  const b=benchmark({backend:"hdl",mode:"fpga",metric:"fmax_hz",unit:"Hz"});
  assert.equal(auditBenchmarkEvidence(b).kind,"HARDWARE_PPA");
  assert.throws(()=>auditBenchmarkEvidence({...b,metric:"area_um2",unit:"um2"}),/hardware target/);
  assert.throws(()=>auditBenchmarkEvidence({...b,metric:"latency_ns",unit:"ns"}),/metrics must not mix/);
  assert.equal(auditBenchmarkEvidence({...b,mode:"asic",metric:"area_um2",unit:"um2"}).kind,"HARDWARE_PPA");
});
test("unsupported compilation mode and simulated mixed outputs reject",()=>{
  assert.throws(()=>auditBenchmarkEvidence(benchmark({mode:"untrusted"})),/backend\/mode/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({samples:[4,5,Infinity]})),/finite/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({samples:[4,-5,6]})),/finite/);
});
test("workload and toolchain source fingerprints cannot be omitted",()=>{
  for(const key of ["sourceCommit","sourceTree","compilerSha256","fixtureSha256","toolchainSha256"]){
    assert.throws(()=>auditBenchmarkEvidence(benchmark({[key]:"forged"})),/digest/);
  }
});
test("measurement must have exact head and actual nonzero steps",()=>{
  assert.throws(()=>auditBenchmarkEvidence(benchmark({
    run:{...benchmark().run,head:"d".repeat(40)}})),/head mismatch/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({
    run:{...benchmark().run,executedSteps:0}})),/zero-step/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({
    run:{...benchmark().run,attempt:0}})),/positive run attempt/);
});
test("short/raw/non-finite sample sets are not measured evidence",()=>{
  assert.throws(()=>auditBenchmarkEvidence(benchmark({samples:[1]})),/heldout samples/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({samples:[1,2,"3"]})),/finite/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({phase:"training"})),/heldout/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({modelValue:20})),/modeled/);
});
test("model and NOT_RUN records cannot carry fabricated CI receipts",()=>{
  const modeled=benchmark({evidence:"MODELED",samples:null,modelValue:1.5,run:null});
  assert.equal(auditBenchmarkEvidence(modeled).evidence,"MODELED");
  assert.throws(()=>auditBenchmarkEvidence({...modeled,run:benchmark().run}),/execution samples/);
  assert.throws(()=>auditBenchmarkEvidence({...modeled,modelValue:Infinity}),/finite/);
  const absent={...modeled,evidence:"NOT_RUN",modelValue:null};
  assert.equal(auditBenchmarkEvidence(absent).benchmarkCertified,false);
  assert.throws(()=>auditBenchmarkEvidence({...absent,modelValue:1}),/omit values/);
});
test("unknown benchmark fields cannot self-certify",()=>{
  assert.throws(()=>auditBenchmarkEvidence(benchmark({certified:true})),/fields/);
  assert.throws(()=>auditBenchmarkEvidence(benchmark({artifact:["private source"]})),/fields/);
});

test("L2 runtime proof shape still cannot attest backend implementation",()=>{
  const a=auditAssuranceEvidence(assurance());
  assert.equal(a.assuranceCertified,false);
  assert.equal(a.implementationVerified,"NOT_ATTESTED");
  assert.equal(a.claimedLevel,"L2");
});
test("higher formal levels require WIT and Contract IR hashes",()=>{
  assert.throws(()=>auditAssuranceEvidence(assurance({witSha256:null})),/WIT/);
  assert.throws(()=>auditAssuranceEvidence(assurance({contractIrSha256:null})),/contract IR/);
  assert.throws(()=>auditAssuranceEvidence(assurance({level:"L4",runtimeFixtureSha256:null})),/runtime observation/);
});
test("L0 cannot silently claim ABI/IR verification",()=>{
  const a=assurance({level:"L0",witSha256:null,contractIrSha256:null,runtimeFixtureSha256:null});
  assert.equal(auditAssuranceEvidence(a).claimedLevel,"L0");
  assert.throws(()=>auditAssuranceEvidence({...a,witSha256:H}),/L0/);
});
test("NOT_RUN and UNSUPPORTED cannot claim proof output or tool execution",()=>{
  const a=assurance({status:"NOT_RUN",toolSteps:0,proofSha256:null,runtimeFixtureSha256:null});
  assert.equal(auditAssuranceEvidence(a).claimedStatus,"NOT_RUN");
  assert.throws(()=>auditAssuranceEvidence({...a,proofSha256:H}),/non-pass/);
  assert.throws(()=>auditAssuranceEvidence({...a,toolSteps:2}),/unexecuted/);
  assert.equal(auditAssuranceEvidence({...a,status:"UNSUPPORTED"}).assuranceCertified,false);
});
test("proof PASS needs actual claimed tool execution not just schema files",()=>{
  assert.throws(()=>auditAssuranceEvidence(assurance({toolSteps:0})),/zero-step/);
  assert.throws(()=>auditAssuranceEvidence(assurance({proofSha256:"none"})),/digest/);
  assert.throws(()=>auditAssuranceEvidence(assurance({status:"INVALID"})),/status/);
});
test("host or arbitrary untrusted fields cannot forge formal proof",()=>{
  assert.throws(()=>auditAssuranceEvidence(assurance({certificate:true})),/fields/);
  assert.throws(()=>auditAssuranceEvidence(assurance({backend:"root-shell"})),/backend/);
});

test("valid release-shaped receipt still requires live independent verification",()=>{
  const r=auditReleaseEvidence(release());
  assert.equal(r.releaseCertified,false);
  assert.match(r.required,/GITHUB/);
});
test("PR author and merger cannot self-review, including duplicate reviewers",()=>{
  assert.throws(()=>auditReleaseEvidence(release({
    reviewers:[{id:1,state:"APPROVED",reviewedHead:G}]})),/independent/);
  assert.throws(()=>auditReleaseEvidence(release({
    reviewers:[{id:2,state:"APPROVED",reviewedHead:G}]})),/independent/);
  assert.throws(()=>auditReleaseEvidence(release({
    reviewers:[{id:3,state:"APPROVED",reviewedHead:G},
      {id:3,state:"APPROVED",reviewedHead:G}]})),/independent/);
});
test("stale or unapproved reviews are not release evidence",()=>{
  assert.throws(()=>auditReleaseEvidence(release({
    reviewers:[{id:3,state:"APPROVED",reviewedHead:"d".repeat(40)}]})),/stale-head/);
  assert.throws(()=>auditReleaseEvidence(release({
    reviewers:[{id:3,state:"COMMENTED",reviewedHead:G}]})),/approved/);
});
test("unenforced codeowner rules, admin verification and force bypass are denied",()=>{
  for(const key of ["enforced","codeowners","adminVerified"]){
    assert.throws(()=>auditReleaseEvidence(release({
      protection:{...release().protection,[key]:false}})),/unverified or bypassable/);
  }
});
test("PR-head CI cannot certify a different final merge tree",()=>{
  assert.throws(()=>auditReleaseEvidence(release({
    ci:{...release().ci,testedHead:G}})),/final merge commit/);
});
test("zero-step, neutral, skipped and missing-artifact release CI are denied",()=>{
  assert.throws(()=>auditReleaseEvidence(release({
    ci:{...release().ci,executedTestSteps:0}})),/zero-step/);
  assert.throws(()=>auditReleaseEvidence(release({
    ci:{...release().ci,conclusion:"neutral"}})),/zero-step/);
  assert.throws(()=>auditReleaseEvidence(release({
    ci:{...release().ci,artifactSha256:"unavailable"}})),/digest/);
});
test("release self-reported verification cannot add hidden trusted fields",()=>{
  assert.throws(()=>auditReleaseEvidence(release({approved:true})),/fields/);
  assert.throws(()=>auditReleaseEvidence(release({adminToken:"secret"})),/fields/);
});
