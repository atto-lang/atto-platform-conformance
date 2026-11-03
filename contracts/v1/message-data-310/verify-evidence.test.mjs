import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateEvidence} from "./verify-evidence.mjs";
const manifest=JSON.parse(readFileSync(new URL("./manifest.json",import.meta.url),"utf8")),digest="a".repeat(64);
const hashes=Object.fromEntries(manifest.cases.filter(c=>c.fixture).map(c=>[c.fixture,digest]));
const make=()=>manifest.required_backends.map(backend=>({backend,head_sha:"b".repeat(40),tree_sha:"c".repeat(40),native_artifact_sha256:"d".repeat(64),execution_mode:"compiled-native-guest",native_guest_executed:true,ci:{run_id:1,job_id:2,steps:[{kind:"native-guest",conclusion:"success"}]},cases:manifest.cases.map(c=>({id:c.id,fixture_sha256:c.fixture?digest:undefined,injection:c.injection,phase:c.kind==="guest-positive"?"native-guest":c.kind==="type-negative"?"semantic-typecheck":"native-runtime-admission",result:c.kind==="guest-positive"?"pass":"reject",exit_code:c.kind==="guest-positive"?0:1,stdout:c.stdout,diagnostic_category:c.diagnostic_category,rejected_before_enqueue:true})),security_runtime_assertions:Object.fromEntries(manifest.security_runtime_assertions.map(k=>[k,true]))}));
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
