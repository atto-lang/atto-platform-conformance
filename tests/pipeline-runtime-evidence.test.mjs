import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifyPipelineTrace,verifyNativeGuestSummary} from "../src/pipeline-runtime-evidence.mjs";

const dir=new URL("../contracts/pipeline/v1/",import.meta.url);
const example=JSON.parse(await readFile(new URL("trace-three-actor.json",dir),"utf8"));
const dup=()=>structuredClone(example);
const reject=(value,expected)=>{
 const r=verifyPipelineTrace(value);
 assert.equal(r.ok,false,JSON.stringify(r));
 if(expected)assert.match(r.errors.join(" / "),expected);
};
const ctrl=(op,epoch,rest={})=>({seq:0,op,epoch,request:null,hop:null,ticket:null,stage:null,variant:null,value:null,...rest});
const renumber=events=>events.map((e,i)=>({...e,seq:i}));
test("canonical five-hop trace is accepted only as a structural event transcript",()=>{
 const verdict=verifyPipelineTrace(example);
 assert.deepEqual(verdict,{ok:true,errors:[],forwardAdmissions:2,backwardAdmissions:2,completions:1,drops:0,restarts:0});
});
test("reject early backward or wrong hop order, even with a valid final result",()=>{
 let x=dup();
 const wrong=x.events.splice(12,4);x.events.splice(4,0,...wrong);x.events=renumber(x.events);
 reject(x,/unowned or reordered reserve/);
 x=dup();x.events[4].hop=3;x.events[4].stage="transform";x.events[4].variant="Signal.Result";
 reject(x,/unowned or reordered reserve/);
});
test("no success before physical turn finalizers and exact two-way admission",()=>{
 let x=dup();x.events=x.events.filter(e=>!(e.op==="finalize"&&e.hop===3));x.events=renumber(x.events);
 reject(x,/completion before final physical turns|duplicate or premature/);
 x=dup();x.events[20].value=20;reject(x,/unauthorized completion/);
});
test("unpublished reservation is not falsely reported as admitted DATA",()=>{
 const x=dup();
 x.events=renumber([...x.events.slice(0,4),x.events[4],ctrl("stop",1)]);
 const result=verifyPipelineTrace(x);
 assert.equal(result.ok,true,result.errors.join("; "));
 assert.equal(result.forwardAdmissions,0);
 assert.equal(result.backwardAdmissions,0);
 assert.equal(result.completions,0);
});
test("replayed publication, receipt, completion and wrong variant fail closed",()=>{
 for(const idx of [1,2,3,20]){
  const x=dup();x.events.splice(idx+1,0,{...x.events[idx]});x.events=renumber(x.events);
  reject(x,/duplicate|terminal barrier|unknown or nonmonotonic|unauthorized/);
 }
 const x=dup();x.events[10].variant="Signal.Result";reject(x,/direction\/type mismatch/);
});
test("foreign tickets, duplicate ticket reservation and bad epoch fail closed",()=>{
 let x=dup();x.events[1].ticket="foreign";reject(x,/foreign or stale ticket/);
 x=dup();x.events[4].ticket="t0";reject(x,/duplicate live ticket/);
 x=dup();x.events[6].epoch=2;reject(x,/stale incarnation/);
});
test("stop fences publication and restart fences old tickets even with identical textual IDs",()=>{
 const prefix=dup().events.slice(0,4);
 let x=dup();x.events=renumber([...prefix,ctrl("stop",1),{...example.events[4]}]);
 reject(x,/data transition after terminal barrier/);
 const suffix=dup().events.map(e=>({...e,epoch:2}));
 x=dup();x.events=renumber([...prefix,ctrl("stop",1),ctrl("restart",2),ctrl("drop-stale",1,{ticket:"t0"}),...suffix]);
 const ok=verifyPipelineTrace(x);
 assert.equal(ok.ok,true,ok.errors.join("; "));
 assert.equal(ok.restarts,1);assert.equal(ok.drops,1);
 let bad=structuredClone(x);bad.events.splice(7,1);bad.events[7]={...ctrl("complete",1,{request:"r1",value:19})};bad.events=renumber(bad.events);
 reject(bad,/stale incarnation/);
 bad=structuredClone(x);bad.events[5].epoch=1;reject(bad,/unauthorized restart/);
 bad=structuredClone(x);bad.events.find(e=>e.op==="drop-stale").ticket="unissued";reject(bad,/unproven stale ticket/);
});
test("dense own-data trace events never execute injected accessor callbacks",()=>{
 let calls=0;
 const x=dup();
 Object.defineProperty(x.events[0],"ticket",{enumerable:true,get(){calls++;return "t0"}});
 reject(x,/noncanonical event/);assert.equal(calls,0);
 const y=dup();y.events.length=130;reject(y,/bounded dense/);
 const z=dup();z.events.map=()=>[];reject(z,/bounded dense/);
});
test("schema is structurally pinned and does not claim event provenance",async()=>{
 const schema=JSON.parse(await readFile(new URL("runtime-trace.schema.json",dir),"utf8"));
 const tsp=await readFile(new URL("runtime-trace.tsp",dir),"utf8");
 assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
 assert.equal(schema.additionalProperties,false);
 assert.equal(schema.properties.kind.const,example.kind);
 assert.equal(schema.properties.events.maxItems,128);
 assert.ok(schema.$defs.event.properties.op.enum.includes("drop-stale"));
 assert.match(tsp,/model PipelineRuntimeTrace/);
 assert.match(tsp,/model PipelineTraceEvent/);
});
const summary={
 backend:"llvm-native",sourceGitBlobSha1:"46579a917516899612fcd8c65c70b24b995c2c5a",
 exitCode:43,stdout:"",
 stderr:[
  "SOURCE_PIPELINE_ROUNDTRIP_PASS actors=3 typed=1 forward=2 backward=2 result=19",
  "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=1 last=13",
  "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=2 last=14",
  "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=2 last=19",
  "SOURCE_ACTOR_GROUP_VERIFIED active=0 slots=3 peak=3 carriers=4",""
 ].join("\n")
};
test("real-native log interface requires all three physical stops and group barrier",()=>{
 assert.deepEqual(verifyNativeGuestSummary(summary),{ok:true,errors:[],actors:3,forward:2,backward:2,result:19});
});
test("guest log rejects fabricated totals, absent teardown, bad exit code, wrong binary lineage and duplicate summaries",()=>{
 const change=mutate=>{const x={...summary};mutate(x);assert.equal(verifyNativeGuestSummary(x).ok,false)};
 change(x=>x.exitCode=0);
 change(x=>x.sourceGitBlobSha1="a".repeat(40));
 change(x=>x.stderr=x.stderr.replace("result=19","result=20"));
 change(x=>x.stderr=x.stderr.replace("released=1","released=0"));
 change(x=>x.stderr=x.stderr.replace("processed=1 last=13","processed=2 last=13"));
 change(x=>x.stderr=x.stderr.replace("SOURCE_ACTOR_GROUP_VERIFIED active=0","SOURCE_ACTOR_GROUP_VERIFIED active=1"));
 change(x=>x.stderr+="\nSOURCE_PIPELINE_FAILURE code=7\n");
 change(x=>x.stderr+=summary.stderr.split("\n")[0]+"\n");
 change(x=>x.stderr=x.stderr.replace("slots=3","slots=4"));
 change(x=>x.stderr=x.stderr.replace("peak=3","peak=4"));
 change(x=>x.stderr=x.stderr.replace("carriers=4","carriers=5"));
 change(x=>x.stdout="unverified extra output");
 change(x=>x.stderr=x.stderr+"prefix: SOURCE_PIPELINE_FAILURE code=7\n");
 change(x=>{const lines=x.stderr.trimEnd().split("\n");x.stderr=[...lines.slice(1,4),lines[0],lines[4],""].join("\n")});
 change(x=>{const lines=x.stderr.trimEnd().split("\n");x.stderr=[lines[0],lines[4],...lines.slice(1,4),""].join("\n")});
});
