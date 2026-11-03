import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateEvidence} from "./verify-evidence.mjs";
const manifest=JSON.parse(readFileSync(new URL("./manifest.json",import.meta.url),"utf8")),digest="a".repeat(64);
const hashes=Object.fromEntries(manifest.cases.filter(c=>c.fixture).map(c=>[c.fixture,digest]));
const make=()=>manifest.required_backends.map(backend=>({backend,head_sha:"b".repeat(40),tree_sha:"c".repeat(40),native_artifact_sha256:"d".repeat(64),execution_mode:"compiled-native-guest",native_guest_executed:true,ci:{run_id:1,job_id:2,steps:[{kind:"native-guest",conclusion:"success"}]},cases:manifest.cases.map(c=>({id:c.id,fixture_sha256:c.fixture?digest:undefined,fixture_git_blob_sha1:c.fixture?c.fixture_git_blob_sha1:undefined,injection:c.injection,phase:c.kind==="guest-positive"?"native-guest":c.kind==="type-negative"?"semantic-typecheck":"native-runtime-admission",result:c.kind==="guest-positive"?"pass":"reject",exit_code:c.kind==="guest-positive"?0:1,stdout:c.stdout,stderr:"",diagnostic_category:c.diagnostic_category,parser_accepted:true,parse_failure:false,diagnostic_code:c.diagnostic_category,diagnostic_text:c.diagnostic_category==="MESSAGE_DATA_REQUIRED"?"requires MessageData":c.diagnostic_category==="BORROWED_PAYLOAD"?"borrowed payload requires owned Sendable data":"cannot transport functions or callable payload",source_location:c.fixture?{file:c.fixture,line:1,column:1}:null,rejected_before_enqueue:true,receiver_observed_payload:false,harness_exit_code:0,harness_executed:true})),security_runtime_assertions:Object.fromEntries(manifest.security_runtime_assertions.map(k=>[k,true]))}));
test("synthetic control accepted (NOT a native receipt)",()=>assert.deepEqual(validateEvidence(manifest,make(),hashes),[]));
for(const [name,mutate] of [
 ["no steps",r=>r[0].ci.steps=[]],
 ["host-only",r=>r[0].native_guest_executed=false],
 ["missing backend",r=>r.pop()],
 ["wrong hash",r=>r[0].cases[0].fixture_sha256="0".repeat(64)],
 ["parse-failure laundering",r=>r[0].cases.find(c=>c.id==="N01").parse_failure=true],
 ["missing runtime reject",r=>r[0].cases.find(c=>c.id==="N08").rejected_before_enqueue=false],
 ["wrong output",r=>r[0].cases[0].stdout="41"],
 ["skipped",r=>r[0].cases[1].skipped=true],
 ["missing native artifact",r=>r[0].native_artifact_sha256=""],
 ["missing security assertion",r=>r[0].security_runtime_assertions["reject-cyclic-graph"]=false]
])test("deny "+name,()=>{const r=make();mutate(r);assert.ok(validateEvidence(manifest,r,hashes).length>0)});

for(const [name,mutate] of [
 ["backend omitted",m=>m.required_backends.pop()],
 ["all cases removed",m=>m.cases=[]],
 ["missing required diagnostic",m=>m.cases.find(c=>c.id==="N01").diagnostic_category="UNSPECIFIED"],
 ["runtime injection removed",m=>m.cases.find(c=>c.id==="N08").injection=null],
 ["supplementary assertions removed",m=>m.security_runtime_assertions=[]],
 ["positive output changed",m=>m.cases.find(c=>c.id==="P02").stdout="false"],
 ["missing guest file",m=>m.cases.find(c=>c.id==="P03").fixture="../unsafe.atto"]
])test("deny altered canonical contract: "+name,()=>{
 const m=JSON.parse(JSON.stringify(manifest));mutate(m);
 assert.ok(validateEvidence(m,make(),hashes).length>0);
});

for(const [name,mutate] of [
 ["parse admission not proven",r=>delete r[0].cases.find(c=>c.id==="N01").parser_accepted],
 ["parse result omitted",r=>delete r[0].cases.find(c=>c.id==="N02").parse_failure],
 ["semantic diagnostic text omitted",r=>delete r[0].cases.find(c=>c.id==="N05").diagnostic_text],
 ["semantic diagnostic code omitted",r=>delete r[0].cases.find(c=>c.id==="N03").diagnostic_code],
 ["semantic source location omitted",r=>delete r[0].cases.find(c=>c.id==="N04").source_location],
 ["semantic source location wrong file",r=>r[0].cases.find(c=>c.id==="N06").source_location.file="../other.atto"],
 ["runtime harness omitted",r=>delete r[0].cases.find(c=>c.id==="N07").harness_exit_code],
 ["runtime harness not executed",r=>r[0].cases.find(c=>c.id==="N08").harness_executed=false],
 ["runtime leaked payload",r=>r[0].cases.find(c=>c.id==="N07").receiver_observed_payload=true],
 ["runtime diagnostic omitted",r=>delete r[0].cases.find(c=>c.id==="N08").diagnostic_text],
 ["guest wrote stderr",r=>r[0].cases.find(c=>c.id==="P01").stderr="warning"]
])test("deny unproven diagnostic or admission: "+name,()=>{
 const r=make();mutate(r);
 assert.ok(validateEvidence(manifest,r,hashes).length>0);
});

test("deny wrong fixture Git blob",()=>{
 const r=make();r[0].cases.find(c=>c.id==="P01").fixture_git_blob_sha1="0".repeat(40);
 assert.ok(validateEvidence(manifest,r,hashes).length>0);
});
test("deny missing canonical fixture pin",()=>{
 const m=JSON.parse(JSON.stringify(manifest));delete m.cases.find(c=>c.id==="N05").fixture_git_blob_sha1;
 assert.ok(validateEvidence(m,make(),hashes).length>0);
});

for(const [name,modify] of [
 ["depth limit increased",m=>m.limits.depth=999999],
 ["node budget missing",m=>delete m.limits.nodes],
 ["select cap missing",m=>delete m.limits.select_cases],
 ["limits removed entirely",m=>delete m.limits]
])test("deny weakened contract limit: "+name,()=>{
 const m=JSON.parse(JSON.stringify(manifest));modify(m);
 assert.ok(validateEvidence(m,make(),hashes).length>0);
});
for(const [name,mutate] of [
 ["null receipt",r=>r.push(null)],
 ["cancelled setup step",r=>r[0].ci.steps.push({kind:"setup",conclusion:"cancelled"})],
 ["skipped test step",r=>r[0].ci.steps.push({kind:"test",conclusion:"skipped"})],
 ["unknown CI step",r=>r[0].ci.steps.push({kind:"other"})],
 ["null CI step",r=>r[0].ci.steps.push(null)]
])test("deny malformed or incomplete CI evidence: "+name,()=>{
 const r=make();mutate(r);
 assert.ok(validateEvidence(manifest,r,hashes).length>0);
});
