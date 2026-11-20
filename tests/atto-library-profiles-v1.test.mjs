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

test("mutations cannot promote fabricated backend or weaken the profile split",()=>{
 const mutate=(f)=>{const copy=structuredClone(manifest);f(copy);assert.throws(()=>validateManifest(copy))};
 mutate(m=>m.evidence.llvm="PASS");
 mutate(m=>m.status="VERIFIED");
 mutate(m=>m.tiers.core.dependencies.push("std"));
 mutate(m=>m.profiles[0].capabilities.push("os_io"));
 mutate(m=>m.profiles[1].tiers.push("alloc"));
 mutate(m=>m.optionalActor.independentOfLibraryTier=false);
 mutate(m=>m.freestanding.requiredEvidence.pop());
 mutate(m=>m.freestanding.permittedExternalHelperNames.push("malloc"));
 mutate(m=>m.freestanding.permittedExternalHelperPrefix="__aeabi_");
 mutate(m=>m.freestanding.permittedExternalHelperNames.push("__aeabi_surprise_helper"));
 mutate(m=>m.freestanding.forbiddenArtifactFeatures.splice(0,1));
 mutate(m=>m.fixtures[0].file="../escape.atto");
 mutate(m=>m.sourceSuffix=".ores");
});
