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
 need(retry.schema==="atto.actor-retry-undo.v1"&&retry.status==="TARGET_NOT_EXECUTED","retry schema/status");
 need(Object.values(retry.profiles).every(s=>s==="NOT_EXECUTED"),"false retry profile pass");
 const retryIds=["retry-initial-success","retry-transient-success","retry-exhaustion","retry-noneligible-throw","retry-result-explicit","retry-panic-control","retry-raise","retry-cancel-wait","retry-deadline","retry-backoff-cap","retry-serial-permit","retry-reentrant-version","tx-rollback","tx-reader-isolation","tx-commit","tx-loan-await","tx-opaque-effect","tx-own-transfer","undo-old-value","undo-redo-tail","undo-stale-version","undo-nontail","undo-duplicate-command","undo-new-branch","undo-quota","undo-ownership-retention","undo-published-effect","durable-before-commit","durable-after-commit","durable-unknown-commit","durable-stale-epoch","durable-replay","durable-retry-clock","effect-stable-key","effect-unknown-receipt","saga-lifo","saga-compensation-failure","symbol-qualified-path","symbol-cross-authority","symbol-malformed","symbol-restore"];
 need(Array.isArray(retry.cases)&&retry.cases.length===retryIds.length&&retry.cases.every((c,i)=>c.id===retryIds[i]),"retry inventory");
 for(const c of retry.cases){
  need(c.status==="TARGET_NOT_EXECUTED"&&typeof c.expectation==="string"&&c.expectation.trim()&&typeof c.group==="string"&&c.group.trim(),"retry case metadata");
 }
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
const retryMutations=[x=>x.status="PASS",x=>x.schema="bad",x=>x.profiles.java="PASS",x=>x.cases[0].status="PASS",x=>x.cases[0].id="invented",x=>x.cases.reverse(),x=>x.cases[0].expectation="",x=>x.cases[0].group="",x=>delete x.profiles.llvm,x=>x.cases.pop()];
for(const mutate of retryMutations){const x=JSON.parse(JSON.stringify(retry));mutate(x);assert.throws(()=>validate(m,x));}
console.log("registry: valid baseline + 9 state-machine and 10 retry registry rejected mutations; no guest execution");
