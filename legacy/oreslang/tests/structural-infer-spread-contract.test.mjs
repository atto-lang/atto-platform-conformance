import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contract=JSON.parse(await readFile(new URL("../contracts/structural-infer-spread/v1/manifest.json",import.meta.url),"utf8"));
const TARGETS=["java","llvm","net","wasm"];
const allowedDiagnostics=new Set([
"invalid-infer-target","contextual-keyword-confusion","unresolved-spread-source","nonaggregate-spread",
"duplicate-explicit-field","explicit-struct-type-mismatch","explicit-struct-extra-field",
"explicit-struct-missing-field","readonly-structural-loan","borrow-escape",
"dynamic-row-not-static","borrowed-mutable-capability","nominal-object-not-aggregate"
]);
function rowOf(writes) {
 const m=new Map();
 for(const w of writes){assert.match(w.key,/^[A-Za-z_][A-Za-z0-9_]*$/);assert.match(w.type,/^[A-Za-z][A-Za-z0-9_]*$/);m.set(w.key,w.type)}
 return Object.fromEntries([...m.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0));
}
function checkManifest(m) {
 assert.equal(m.schema,"attolang.structural-infer-spread.v1");
 assert.equal(m.status,"proposed-no-four-backend-parity");
 assert.deepEqual(Object.keys(m.backendEvidence).sort(),TARGETS);
 assert.equal(m.sourceSyntax.invalidComposition,"infer structural");
 assert.equal(m.cases.length,26);
 const ids=new Set(),positive=new Set(),negative=new Set();
 for(const c of m.cases){
  assert.match(c.id,/^[a-z][a-z0-9-]+$/);
  assert.ok(!ids.has(c.id),"duplicate ID "+c.id);ids.add(c.id);
  assert.ok(c.source.startsWith("fnc ")||c.source.startsWith("define class "),"fixture must be guest source");
  assert.ok(c.source.length<8192);
  if(c.expect==="accept"){
   assert.deepEqual(Object.keys(c).sort(),["expect","expectedRow","id","source","stage","writes"]);
   assert.equal(c.stage,"source-contract-only");
   // These callable-local type-inference examples have no executable main.
   // Compiled guest acceptance lives in the separately pinned .atto corpus.
   assert.doesNotMatch(c.source,/\b(?:pub\s+)?fnc\s+main\s*\(/);
   assert.deepEqual(rowOf(c.writes),rowOf(Object.entries(c.expectedRow).map(([key,type])=>({key,type}))),"wrong inferred row: "+c.id);
   positive.add(c.id);
  } else {
   assert.deepEqual(Object.keys(c).sort(),["diagnosticClass","expect","id","releaseArtifactAllowed","source","stage"]);
   assert.equal(c.expect,"reject");
   assert.equal(c.stage,"frontend-before-artifact");
   assert.equal(c.releaseArtifactAllowed,false);
   assert.ok(allowedDiagnostics.has(c.diagnosticClass));
   negative.add(c.id);
  }
 }
 assert.equal(positive.size,13);
 assert.equal(negative.size,13);
 for(const backend of TARGETS){
  const e=m.backendEvidence[backend];
  assert.deepEqual(Object.keys(e).sort(),["exactCompilerCommit","exactSourceCommit","negativeFrontendExecution","positiveGuestExecution","toolchainArtifact"].sort());
  assert.equal(e.positiveGuestExecution,false,"no invented guest parity");
  assert.equal(e.negativeFrontendExecution,false,"no invented diagnostic parity");
  assert.equal(e.exactSourceCommit,null);
  assert.equal(e.exactCompilerCommit,null);
  assert.equal(e.toolchainArtifact,null);
 }
 return true;
}
test("four-backend contract has 13 positive and 13 negative sources without forged verification",()=>assert.equal(checkManifest(contract),true));
test("row algebra is rightmost-wins, type-changing, order-independent for row identity",()=>{
 assert.deepEqual(rowOf([{key:"x",type:"int"},{key:"y",type:"int"},{key:"y",type:"bool"},{key:"x",type:"String"}]),{x:"String",y:"bool"});
 assert.deepEqual(rowOf([{key:"b",type:"bool"},{key:"a",type:"int"}]),rowOf([{key:"a",type:"int"},{key:"b",type:"bool"}]));
});
test("contract fixtures include inference, cross-kind spread, structural width and ownership negatives",()=>{
 const cases=new Map(contract.cases.map(c=>[c.id,c]));
 for(const id of ["infer-record-inline","infer-struct-inline","extend-record","extend-struct","struct-to-record","record-to-struct","spread-retypes-field","rightmost-multiple-spreads","structural-record-width","structural-struct-width","explicit-exact-struct"])assert.equal(cases.get(id)?.expect,"accept",id);
 for(const id of ["reject-infer-structural","reject-duplicate-explicit","reject-explicit-shape-extra","reject-structural-write","reject-structural-escape","reject-dynamic-map-spread","reject-mutable-borrow-field","reject-nominal-erasure"])assert.equal(cases.get(id)?.expect,"reject",id);
 assert.ok(cases.get("spread-retypes-field").source.includes("infer record{...b, a:"));
 assert.ok(cases.get("rightmost-multiple-spreads").source.includes("...b, ...c, x:"));
});
test("tampered evidence, source classification and row metadata fail closed",()=>{
 const mutateFns=[
 m=>{m.backendEvidence.llvm.positiveGuestExecution=true},
 m=>{m.backendEvidence.wasm.exactCompilerCommit="abc"},
 m=>{m.cases[0].expect="reject"},
 m=>{m.cases[0].expectedRow.a="String"},
 m=>{m.cases[0].id=m.cases[1].id},
 m=>{m.cases[13].releaseArtifactAllowed=true},
 m=>{m.cases[13].diagnosticClass="unsupported-success"},
 m=>{m.backendEvidence.net.unreviewed="passed"},
 m=>{m.cases.pop()},
 ];
 for(const mut of mutateFns){const m=structuredClone(contract);mut(m);assert.throws(()=>checkManifest(m))}
});
test("contract admits no completed parity without exact four-backend guest and rejection evidence",()=>{
 for(const backend of TARGETS){
  const e=contract.backendEvidence[backend];
  assert.equal(Boolean(e.positiveGuestExecution&&e.negativeFrontendExecution&&e.exactSourceCommit&&e.exactCompilerCommit&&e.toolchainArtifact),false);
 }
});
