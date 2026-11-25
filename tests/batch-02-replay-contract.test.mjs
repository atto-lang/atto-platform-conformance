import test from "node:test";
import assert from "node:assert/strict";
import {auditReplayContract} from "../src/batch-02-replay-contract.mjs";

const SRC="a".repeat(64),RUNTIME="b".repeat(64),TREE="c".repeat(40);
const manifest=()=>({
  schema:1,entry:"src/main.ores",sourceTree:TREE,sourceClosureSha256:SRC,
  units:[{path:"src/main.ores",sha256:"d".repeat(64)},
    {path:"src/dep.ores",sha256:"e".repeat(64)}],
  edges:[{from:"src/main.ores",specifier:"dep",to:"src/dep.ores"}]
});
const dec=(index=0,over={})=>({
  index,operation:"actor.resume",alternatives:["A","B"],
  chosen:"B",logicalTime:index,...over
});
const trace=()=>({
  schema:1,sourceTree:TREE,sourceClosureSha256:SRC,runtimeSha256:RUNTIME,
  seed:8,complete:true,decisions:[dec(0),dec(1,{chosen:"A"})]
});
const check=(m=manifest(),a=trace(),b=trace())=>
  auditReplayContract({manifest:m,recorded:a,replayed:b});

test("identical bounded trace shape is never proof of guest schedule replay",()=>{
  const r=check();
  assert.equal(r.inputTraceShapeMatches,true);
  assert.equal(r.sourceUnits,2);
  assert.equal(r.guestReplayVerified,false);
  assert.equal(r.importedSourcesRehashedByCompiler,"NOT_ATTESTED");
});
test("changing only the imported closure digest invalidates replay",()=>{
  const m=manifest();m.sourceClosureSha256="f".repeat(64);
  assert.throws(()=>check(m),/record source closure mismatch/);
  const b=trace();b.sourceClosureSha256="f".repeat(64);
  assert.throws(()=>check(manifest(),trace(),b),/replay source closure mismatch/);
});
test("missing imported source or unresolved dependency fails closed",()=>{
  const m=manifest();m.units.pop();
  assert.throws(()=>check(m),/unresolved import/);
});
test("unreachable fake extra source is never accepted as reachable closure",()=>{
  const m=manifest();m.units.push({path:"src/extra.ores",sha256:"f".repeat(64)});
  assert.throws(()=>check(m),/unreachable unit/);
});
test("import alias cannot resolve twice and cannot refer to unknown unit",()=>{
  const m=manifest();m.edges.push({...m.edges[0]});
  assert.throws(()=>check(m),/duplicate import/);
  m.edges.pop();m.edges[0].to="missing.ores";
  assert.throws(()=>check(m),/unresolved import/);
});
test("illegal absolute and traversal source names denied",()=>{
  const m=manifest();m.entry="../main.ores";
  assert.throws(()=>check(m),/unsafe entry/);
  const n=manifest();n.units[0].path="/tmp/private.ores";
  assert.throws(()=>check(n),/unsafe source unit/);
});
test("incomplete replay, added decisions and missing decisions fail closed",()=>{
  const b=trace();b.complete=false;
  assert.throws(()=>check(manifest(),trace(),b),/incomplete/);
  const c=trace();c.decisions.pop();
  assert.throws(()=>check(manifest(),trace(),c),/truncated or extended/);
});
test("alternative/choice, ordering and logical-time mutations deny replay",()=>{
  const b=trace();b.decisions[0].chosen="C";
  assert.throws(()=>check(manifest(),trace(),b),/unavailable schedule choice/);
  const c=trace();c.decisions[1].logicalTime=-1;
  assert.throws(()=>check(manifest(),trace(),c),/logical time/);
  const d=trace();d.decisions[1].operation="different.op";
  assert.throws(()=>check(manifest(),trace(),d),/diverged/);
});
test("runtime identity and seed changes invalidate replay",()=>{
  const b=trace();b.seed=9;
  assert.throws(()=>check(manifest(),trace(),b),/runtime\/seed/);
  const c=trace();c.runtimeSha256="a".repeat(64);
  assert.throws(()=>check(manifest(),trace(),c),/runtime\/seed/);
});
test("raw source/secret data cannot be injected into trace or source manifest",()=>{
  const m=manifest();m.units[0].rawSource="private program";
  assert.throws(()=>check(m),/source unit fields/);
  const b=trace();b.secrets="token";
  assert.throws(()=>check(manifest(),trace(),b),/schedule trace fields/);
  const c=trace();c.decisions[0].userPayload="secret";
  assert.throws(()=>check(manifest(),trace(),c),/schedule decision fields/);
});
test("bad seed, noncanonical source closure and invalid clock denied",()=>{
  const a=trace();a.seed=-1;
  assert.throws(()=>check(manifest(),a),/seed/);
  const m=manifest();m.sourceClosureSha256="bad";
  assert.throws(()=>check(m),/digest/);
  const b=trace();b.decisions[1].logicalTime=0;b.decisions[0].logicalTime=1;
  assert.throws(()=>check(manifest(),trace(),b),/nonmonotonic logical time/);
});

test("canonical relative and package imports are admitted as source-free aliases",()=>{
  const m=manifest();m.edges[0].specifier="./dep";
  assert.equal(check(m).sourceUnits,2);
  m.edges[0].specifier="+/pkg/module";
  assert.equal(check(m).sourceUnits,2);
});
test("traversal and absolute imports are denied before replay admission",()=>{
  for(const specifier of ["../secret", "/etc/passwd", "./../../out", "pkg//bad"]){
    const m=manifest();m.edges[0].specifier=specifier;
    assert.throws(()=>check(m),/unresolved import/);
  }
});
