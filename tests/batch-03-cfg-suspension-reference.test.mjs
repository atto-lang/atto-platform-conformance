import test from "node:test";
import assert from "node:assert/strict";
import {auditSuspensionCfg} from "../src/batch-03-cfg-suspension-reference.mjs";

const run=ops=>auditSuspensionCfg({schema:1,entry:"start",blocks:[
  {id:"start",ops,next:[]}
]});
const borrow={op:"borrow",loan:"a",owner:"heap",mode:"WRITE"};
const pin={op:"pin",owner:"heap",frame:"frame"};
const done=[{op:"release",loan:"a"},{op:"unpin",owner:"heap"},{op:"exit"}];

test("borrowed owner may suspend in explicitly pinned same frame",()=>{
  const out=run([pin,borrow,{op:"suspend",kind:"await",frame:"frame"},...done]);
  assert.equal(out.nativeGuestVerified,false);
  assert.equal(out.terminatingPaths,1);
});
test("suspend with borrow but no owner pin denies",()=>{
  assert.throws(()=>run([borrow,{op:"suspend",kind:"select",frame:"frame"},...done.slice(0,1),{op:"exit"}]));
});
test("pin for different frame cannot authorize readch suspension",()=>{
  assert.throws(()=>run([pin,borrow,{op:"suspend",kind:"readch",frame:"other"},...done]));
});
test("return or cancellation exit before physical release denied",()=>{
  assert.throws(()=>run([pin,borrow,{op:"exit"}]));
});
test("owner cannot move or drop while loan is still live",()=>{
  for(const op of ["move","drop"])
    assert.throws(()=>run([borrow,{op,owner:"heap"},{op:"release",loan:"a"},{op:"exit"}]));
});
test("overlapping mutable loans denied while parallel read loans allowed",()=>{
  assert.throws(()=>run([borrow,{op:"borrow",loan:"b",owner:"heap",mode:"READ"}]));
  const out=run([
    {...borrow,mode:"READ"},
    {op:"borrow",loan:"b",owner:"heap",mode:"READ"},
    {op:"release",loan:"a"},{op:"release",loan:"b"},{op:"exit"}
  ]);
  assert.equal(out.nodes,1);
});
test("cannot unpin while a loan points into the frame",()=>{
  assert.throws(()=>run([pin,borrow,{op:"unpin",owner:"heap"},...done]));
});
test("branches with incompatible live loan states fail closed at join",()=>{
  const cfg={schema:1,entry:"root",blocks:[
    {id:"root",ops:[],next:["left","right"]},
    {id:"left",ops:[borrow],next:["join"]},
    {id:"right",ops:[],next:["join"]},
    {id:"join",ops:[{op:"exit"}],next:[]}
  ]};
  assert.throws(()=>auditSuspensionCfg(cfg));
});
test("well-formed equal-state diamond joins are allowed",()=>{
  const cfg={schema:1,entry:"root",blocks:[
    {id:"root",ops:[],next:["left","right"]},
    {id:"left",ops:[],next:["join"]},
    {id:"right",ops:[],next:["join"]},
    {id:"join",ops:[{op:"exit"}],next:[]}
  ]};
  assert.equal(auditSuspensionCfg(cfg).nodes,4);
});
test("unreachable basic blocks cannot be silently omitted",()=>{
  assert.throws(()=>auditSuspensionCfg({schema:1,entry:"root",blocks:[
    {id:"root",ops:[{op:"exit"}],next:[]},
    {id:"unused",ops:[{op:"exit"}],next:[]}
  ]}));
});
