import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifyNativeTranscript} from "../bin/verify-native-pipeline-execution.mjs";

const fixture=JSON.parse(await readFile(new URL("../contracts/pipeline/v1/trace-three-actor.json",import.meta.url),"utf8"));
fixture.events.push({seq:fixture.events.length,op:"stop",epoch:1,request:null,hop:null,ticket:null,stage:null,variant:null,value:null});
const success=[
 "SOURCE_PIPELINE_ROUNDTRIP_PASS actors=3 typed=1 forward=2 backward=2 result=19",
 "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=1 last=13",
 "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=2 last=14",
 "SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=2 last=19",
 "SOURCE_ACTOR_GROUP_VERIFIED active=0 slots=3 peak=3 carriers=4"
];
function transcript(t=fixture){
 return [...success,"SOURCE_PIPELINE_TRACE_JSON "+JSON.stringify(t),""].join("\n");
}
test("synthetic fixture exercises adapter, not actual guest execution proof",()=>{
 assert.deepEqual(verifyNativeTranscript(transcript(),43),{
  ok:true,backend:"llvm-native",events:22,forward:2,backward:2,
  completed:1,physicalStops:3,groupClosed:true
 });
});
test("runtime transcript fails closed on duplicate or absent trace",()=>{
 assert.throws(()=>verifyNativeTranscript(success.join("\n"),43),/exactly one/);
 assert.throws(()=>verifyNativeTranscript(transcript()+transcript(),43),/exactly one/);
});
test("runtime transcript rejects forged stop placement, epoch, source and finalization",()=>{
 const source=structuredClone(fixture);
 source.events[15].ticket="foreign";
 assert.throws(()=>verifyNativeTranscript(transcript(source),43),/invalid runtime transitions/);
 const foreign=structuredClone(fixture);
 foreign.sourceGitBlobSha1="a".repeat(40);
 assert.throws(()=>verifyNativeTranscript(transcript(foreign),43),/source fixture/);
 const reorder=[...success.slice(0,4),"SOURCE_PIPELINE_TRACE_JSON "+JSON.stringify(fixture),success.at(-1)].join("\n");
 assert.throws(()=>verifyNativeTranscript(reorder,43),/trace dumped before/);
});
test("runtime trace cannot substitute for successful physical teardown or process status",()=>{
 assert.throws(()=>verifyNativeTranscript(transcript(),0),/process status/);
 assert.throws(()=>verifyNativeTranscript(transcript(),43,"extraneous stdout"),/process status/);
 assert.throws(()=>verifyNativeTranscript(transcript().replace("active=0","active=1"),43),/physical receipts/);
 assert.throws(()=>verifyNativeTranscript(transcript()+"\nSOURCE_PIPELINE_FAILURE code=2\n",43),/physical receipts/);
});
test("malformed, oversized and truncated native trace evidence is rejected",()=>{
 const bad=transcript().replace("SOURCE_PIPELINE_TRACE_JSON {","SOURCE_PIPELINE_TRACE_JSON {broken");
 assert.throws(()=>verifyNativeTranscript(bad,43),/malformed native trace/);
 assert.throws(()=>verifyNativeTranscript(transcript().repeat(100),43),/invalid native transcript/);
 const missing=structuredClone(fixture);missing.events.pop();
 assert.throws(()=>verifyNativeTranscript(transcript(missing),43),/transitions|noncanonical/);
});
