// Host-only expected-graph registry integrity; no compiler or guest proof.
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
function validate(contract) {
 const assert=(b,m)=>{if(!b)throw Error(m)};
 assert(contract.schema==="atto.actor-machine-inspection.v1"&&contract.status==="TARGET_NOT_EXECUTED","status");
 const ids=["flat-cycle","flat-order","wrong-scalar","effectful-initializer"];
 assert(contract.cases.length===ids.length&&contract.cases.every((c,i)=>c.id===ids[i]),"inventory");
 for(const c of contract.cases){
   assert(typeof c.source==="string"&&c.source.endsWith("\n")&&!c.source.includes("\r"),"source bytes");
   if(c.expect.reject===true){assert(Object.keys(c.expect).length===1,"rejection cannot claim a graph");continue;}
   const {initial,nodes,storage}=c.expect;
   assert(Array.isArray(storage)&&new Set(storage).size===storage.length,"storage");
   assert(Array.isArray(nodes)&&nodes.length>0&&nodes.length<=256&&Number.isInteger(initial)&&initial>=0&&initial<nodes.length,"initial");
   let count=0;let prev="";
   for(const n of nodes){
     assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(n.name)&&n.name>prev,"node order");
     prev=n.name;
     assert(typeof n.terminal==="boolean"&&Array.isArray(n.edges)&&(!n.terminal||n.edges.length===0),"terminal");
     let eventPrev="";
     for(const [event,target] of n.edges){
       assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(event)&&event>eventPrev,"event order");
       eventPrev=event;
       assert(Number.isInteger(target)&&target>=0&&target<nodes.length,"target");
       count++;
     }
   }
   assert(count<=256,"edge count");
   const seen=new Set(),pending=[initial];
   while(pending.length){const id=pending.pop();if(!seen.has(id)){seen.add(id);pending.push(...nodes[id].edges.map(e=>e[1]));}}
   assert(seen.size===nodes.length,"reachability");
 }
}
const contract = JSON.parse(readFileSync(new URL("../contracts/actor-machine-inspection-v1.json", import.meta.url), "utf8"));
validate(contract);
const mutants = [c=>c.status="PASS",
c=>c.cases.pop(),
c=>c.cases[0].expect.initial=9,
c=>c.cases[0].expect.nodes.reverse(),
c=>c.cases[1].expect.nodes[1].edges.reverse(),
c=>c.cases[1].expect.nodes[0].edges=[["Bogus",1]],
c=>c.cases[0].expect.nodes[0].edges[0][1]=99,
c=>c.cases[1].expect.nodes[1].edges.pop()&&c.cases[1].expect.nodes[1].edges.pop(),
c=>c.cases[2].expect.initial=0,
c=>c.cases[0].source+="\r"];
for (const mutate of mutants) {
  const c = JSON.parse(JSON.stringify(contract));
  mutate(c);
  assert.throws(() => validate(c));
}
console.log("inspection registry baseline and 10 mutation rejections passed; no guest execution");
