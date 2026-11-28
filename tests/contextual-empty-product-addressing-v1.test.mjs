import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Candidate reference shape-resolution model, not an Atto parser or compiler.
// No public Product representation, lexical identifier implementation, or runtime proof.
function resolve(node,expected=null){
  if(node.tag==="empty") {
    if(expected && !["Tuple","Record","Product"].includes(expected.kind))throw Error("type-mismatch");
    if(expected?.slots?.length)throw Error("shape-mismatch");
    return {kind:expected?.kind==="Record"?"Record":"Tuple",slots:[]};
  }
  if(node.tag==="value"){
    if(expected&&expected.kind!=="Product"&&expected.kind!==node.kind)throw Error("type-mismatch");
    return {kind:node.kind,slots:node.slots};
  }
  if(node.tag==="tuple"){
    if(expected&&expected.kind!=="Tuple"&&expected.kind!=="Product")throw Error("type-mismatch");
    if(expected?.slots&&expected.slots.length!==node.items.length)throw Error("shape-mismatch");
    return {kind:"Tuple",slots:node.items.map((x,i)=>resolve(x,expected?.slots?.[i]))};
  }
  throw Error("unsupported-model-node");
}
function exercise(assert){
  const E={tag:"empty"},T={kind:"Tuple"},R={kind:"Record"},P={kind:"Product"};
  const cases=[null,T,R,P,{kind:"Record",slots:[]},{kind:"Tuple",slots:[]}];
  let n=0;
  for(const a of cases)for(const b of cases)for(const c of cases){
    const result=resolve({tag:"tuple",items:[E,{tag:"tuple",items:[E,E]}]}, {kind:"Tuple",slots:[a,{kind:"Tuple",slots:[b,c]}]});
    const want=x=>x?.kind==="Record"?"Record":"Tuple";
    assert.equal(result.slots[0].kind,want(a));assert.equal(result.slots[1].slots[0].kind,want(b));assert.equal(result.slots[1].slots[1].kind,want(c));n++;
  }
  for(const kind of ["Tuple","Record"]){
    const concrete=resolve(E,{kind});
    const materialized={tag:"value",kind,slots:concrete.slots};
    assert.equal(resolve(materialized,P).kind,kind);
    assert.throws(()=>resolve(materialized,{kind:kind==="Tuple"?"Record":"Tuple"}),/^type-mismatch$/);
    assert.throws(()=>resolve(E,{kind,slots:[T]}),/^shape-mismatch$/);
  }
  // Overload candidate admissibility is separate from no-context defaulting.
  const candidates=[T,R].filter(shape=>{try{resolve(E,shape);return true}catch{return false}});
  assert.equal(candidates.length,2);
  assert.equal(resolve(E).kind,"Tuple");
  assert.throws(()=>resolve(E,{kind:"UserDefinedRecord"}),/^type-mismatch$/);
  return n;
}
test('216 nested context combinations and distinct materialized types',()=>assert.equal(exercise(assert),216));
test('fixture inventory is unexecuted, decisions are not assertions',()=>{
const m=JSON.parse(readFileSync(new URL('../conformance/contextual-empty-product-addressing-v1.json',import.meta.url),'utf8'));
assert.equal(m.status,'TARGET_NOT_EXECUTED');assert.equal(m.cases.length,64);assert.equal(m.decisionProbes.length,23);
assert.equal(new Set([...m.cases,...m.decisionProbes].map(x=>x.id)).size,87);
assert.equal(Object.keys(m.backendRoles).length,11);assert.ok(Object.values(m.backendRoles).every(x=>x==='NOT_EXECUTED'));
for(const p of m.decisionProbes)assert.equal(p.status,'DECISION_REQUIRED');
for(const c of m.cases){assert.ok(c.source.includes('pub fnc main'));if(c.expected.kind==='semantic-rejection')assert.equal(c.expected.artifact,false);else assert.equal(c.expected.kind,'return-i64');}
});
