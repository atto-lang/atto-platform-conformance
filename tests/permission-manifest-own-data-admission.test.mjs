import test from "node:test";
import assert from "node:assert/strict";
import {denyAllPolicy,validatePolicy,evaluatePermission,serializeManifest} from "../src/permission-manifest.mjs";

test("permission scope array getters are not executed or admitted as wildcards",()=>{
 let reads=0;
 for(const field of ["allow","deny"]){
  const policy=denyAllPolicy();
  const list=policy.net[field];
  list.push("placeholder");
  Object.defineProperty(list,0,{enumerable:true,get(){reads++;return "*";}});
  assert.throws(()=>validatePolicy(policy),/own data slots/);
 }
 assert.equal(reads,0);
 const custom=denyAllPolicy();
 Object.defineProperty(custom,"net",{enumerable:true,get(){reads++;return {allow:["*"],deny:[]};}});
 assert.throws(()=>validatePolicy(custom),/own data fields/);
 assert.equal(reads,0);
});

test("permission matching snapshots plain records, denies inherited and iterator authority",()=>{
 const policy=denyAllPolicy();
 policy.net.allow.push("https://api.example");
 const normal=validatePolicy(policy);
 assert.deepEqual(normal.net.allow,["https://api.example"]);
 const layers={actor:normal,artifact:normal,delegated:normal,host:normal,runtime:normal};
 assert.equal(evaluatePermission(layers,"net","https://api.example",(_,resource,scope)=>resource===scope),true);
 const wrapped=Object.create({net:{allow:["*"],deny:[]}});
 Object.assign(wrapped,policy);
 assert.throws(()=>validatePolicy(wrapped),/plain data/);
 let invoked=0;
 const bad=denyAllPolicy();const list=bad.net.allow;
 Object.defineProperty(list,Symbol.iterator,{get(){invoked++;throw Error("iterator");}});
 assert.throws(()=>validatePolicy(bad),/own data slots/);
 assert.equal(invoked,0);
 const extra=denyAllPolicy();extra[Symbol("grant")]=true;
 assert.throws(()=>validatePolicy(extra));
 const digest="a".repeat(64);
 assert.match(serializeManifest({format:"oreslang.permissions",version:1,artifact_sha256:digest,policy}),
   /"version":1/);
});
