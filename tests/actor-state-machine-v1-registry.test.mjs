// Registry integrity only; never guest or compiler evidence.
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
function validate(m,retry){
 const need=(x,msg)=>{if(!x)throw Error(msg)};
 const p=["java","llvm","forge","net","wasm","rs","cranelift","js","hdl","realtime","atto","embedded"];
 const sameKeys=(o,a)=>JSON.stringify(Object.keys(o).sort())===JSON.stringify([...a].sort());
 need(m.schema==="atto.actor-state-machine.v1"&&m.status==="TARGET_NOT_EXECUTED","schema/status");
 need(sameKeys(m.profiles,p)&&sameKeys(retry.profiles,p),"profile coverage");
 need(Object.values(m.profiles).every(s=>s==="NOT_EXECUTED"),"false profile pass");
 need(m.cases.length===28&&m.cases.every((c,i)=>c.id===`SM${String(i+1).padStart(2,"0")}`),"case inventory");
 need(retry.cases.length===41&&new Set(retry.cases.map(c=>c.id)).size===41,"retry inventory");
 for(const c of m.cases){
   need(c.status==="TARGET_NOT_EXECUTED"&&c.expectation.trim()&&c.group.trim(),"case metadata");
   need(["compile_accept","compile_reject","compile_accept_and_reject","guest_trace","crash_recovery","mixed"].includes(c.evidence),"evidence kind");
   if(c.source!==undefined)need(c.source_status==="CANDIDATE_UNEXECUTED"&&c.source.endsWith("\n")&&!c.source.includes("\r"),"source bytes");
   else need(c.source_status==="NEEDS_CANONICAL_FIXTURE","missing fixture status");
 }
}
const m=JSON.parse(readFileSync(new URL("../contracts/actor-state-machine-v1.json",import.meta.url),"utf8"));
const retry=JSON.parse(readFileSync(new URL("../contracts/actor-retry-undo-v1.json",import.meta.url),"utf8"));
validate(m,retry);
const mutations=[x=>x.profiles.rs="PASS",x=>delete x.profiles.js,x=>x.cases.pop(),x=>x.cases[1].id="SM01",x=>x.cases[0].status="PASS",x=>x.cases[0].source_status="PASS",x=>x.cases[0].source+="\r",x=>x.cases[5].source_status="CANDIDATE_UNEXECUTED",x=>x.cases[5].evidence="host_model"];
for(const mutate of mutations){const x=JSON.parse(JSON.stringify(m));mutate(x);assert.throws(()=>validate(x,retry));}
console.log("registry: valid baseline + 9 rejected mutations; no guest execution");
