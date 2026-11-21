import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,lstatSync} from "node:fs";
import {resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {validateManifest,verifyProfileGraph} from "../lib/atto-library-profiles-v1.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const manifest=JSON.parse(readFileSync(resolve(root,"contracts/atto-library-profiles-v1.json"),"utf8"));
const app=(...imports)=>({id:"entry",tier:"app",requires:[],imports});
const mod=(id,tier,requires=[],imports=[])=>({id,tier,requires,imports});
const check=(profile,modules)=>verifyProfileGraph(manifest,{profile,roots:["entry"],modules});

test("canonical atto namespaces, closed dependency lattice and unpromoted evidence",()=>{
 assert.equal(validateManifest(manifest),true);
 for(const fixture of manifest.fixtures){
  const path=resolve(root,fixture.file);
  assert.ok(path.startsWith(root+sep));
  const stat=lstatSync(path);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
  const bytes=readFileSync(path,"utf8");
  assert.ok(bytes.includes('"atto.'),fixture.id);
  assert.ok(!bytes.includes('"ores.'),fixture.id);
 }
});

test("core and bounded static actors need neither allocator nor OS",()=>{
 assert.equal(check("core",[app("numeric"),mod("numeric","core")]).status,"CONTRACT_GRAPH_ONLY");
 assert.equal(check("core+static-actor",[app("worker"),mod("worker","actor",["static_actor"],["numeric"]),mod("numeric","core")]).visited.length,3);
 assert.equal(check("std",[app("socket"),mod("socket","std",["executor","os_io"],["buffer"]),mod("buffer","alloc",["allocator"])]).visited.length,3);
 assert.equal(check("full",[app("worker"),mod("worker","actor",["executor","mailbox","supervision"])]).visited.length,2);
});

test("transitive capability closure and forbidden upward dependencies reject",()=>{
 const bad=[
  ["core",[app("a"),mod("a","alloc",["allocator"])]],
  ["core",[app("a"),mod("a","core",[],["b"]),mod("b","alloc")]],
  ["core",[app("a"),mod("a","core",[],["b"]),mod("b","std",["os_io"])]],
  ["alloc",[app("a"),mod("a","alloc",[],["b"]),mod("b","std",["os_io"])]],
  ["std",[app("a"),mod("a","core",[],["b"]),mod("b","actor",["mailbox"])]],
  ["std",[app("a"),mod("a","std",[],["b"]),mod("b","actor",["mailbox"])]],
  ["core+static-actor",[app("a"),mod("a","actor",["executor"])]],
  ["std",[app("a"),mod("a","std",["blocking_io"])]],
  ["std",[app("a"),mod("a","std",["gc"])]],
  ["full",[app("a"),mod("a","actor",["static_actor"])]],
  ["core",[app("a"),mod("a","core",[],["missing"])]],
  ["core",[app("a"),mod("a","core",[],["a"])]],
  ["core",[app("a","a"),mod("a","core")]],
  ["core",[app("a"),mod("a","core"),mod("a","core")]],
 ];
 for(const [profile,modules] of bad)assert.throws(()=>check(profile,modules),profile);
});

test("every atto-source compiler has a closed unverified evidence slot",()=>{
 const backends=["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","wasm"];
 assert.deepEqual(Object.keys(manifest.evidence),backends);
 assert.ok(backends.every(name=>manifest.evidence[name]==="NOT_EXECUTED"));
 for(const name of backends){
   const copy=structuredClone(manifest);
   copy.evidence[name]="PASS";
   assert.throws(()=>validateManifest(copy),"forged proof for "+name);
 }
 for(const name of backends){
   const copy=structuredClone(manifest);
   delete copy.evidence[name];
   assert.throws(()=>validateManifest(copy),"missing backend "+name);
 }
 const extra=structuredClone(manifest);
 extra.evidence.other="NOT_EXECUTED";
 assert.throws(()=>validateManifest(extra),"unexpected backend slot");
});

test("all three tiers reject illegal direct and transitive imports before IR",()=>{
 const cases=[
   ["core",[app("buffer"),mod("buffer","alloc",["allocator"])]],
   ["core",[app("base"),mod("base","core",[],["buffer"]),mod("buffer","alloc",["allocator"])]],
   ["alloc",[app("region"),mod("region","alloc",["allocator"],["fs"]),mod("fs","std",["os_io"])]],
   ["std",[app("api"),mod("api","std",[],["actor"]),mod("actor","actor",["executor","mailbox","supervision"])]],
   ["std",[app("api"),mod("api","std",[],["helper"]),mod("helper","core",[],["actor"]),mod("actor","actor",["executor","mailbox","supervision"])]]
 ];
 for(const [profile,modules] of cases)
   assert.throws(()=>check(profile,modules),"forbidden import under "+profile);
 assert.equal(check("alloc",[app("region"),mod("region","alloc",["allocator"],["bounds"]),mod("bounds","core")]).status,"CONTRACT_GRAPH_ONLY");
 assert.equal(check("std",[app("fs"),mod("fs","std",["os_io"],["region"]),mod("region","alloc",["allocator"])]).status,"CONTRACT_GRAPH_ONLY");
});

test("mutations cannot promote fabricated backend or weaken the profile split",()=>{
 const mutate=(f)=>{const copy=structuredClone(manifest);f(copy);assert.throws(()=>validateManifest(copy))};
 mutate(m=>m.evidence.llvm="PASS");
 mutate(m=>m.evidence.js="PASS");
 mutate(m=>{delete m.evidence.cranelift;});
 mutate(m=>m.status="VERIFIED");
 mutate(m=>m.tiers.core.dependencies.push("std"));
 mutate(m=>m.profiles[0].capabilities.push("os_io"));
 mutate(m=>m.profiles[1].tiers.push("alloc"));
 mutate(m=>m.optionalActor.independentOfLibraryTier=false);
 mutate(m=>m.freestanding.requiredEvidence.pop());
 mutate(m=>m.freestanding.permittedExternalHelperNames.push("malloc"));
 mutate(m=>m.freestanding.forbiddenArtifactFeatures.splice(0,1));
 mutate(m=>m.fixtures[0].file="../escape.atto");
 mutate(m=>m.sourceSuffix=".ores");
});
