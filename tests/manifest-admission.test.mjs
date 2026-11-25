import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadManifest,validateManifestSchema,assertRegularFixture} from "../src/harness.mjs";

const fixture=()=>({
 schemaVersion:1,cases:[
  {id:"int-arithmetic",file:"int-arithmetic.ores",expect:"accept",backends:["java","llvm","net","wasm","forge","js"]},
  {id:"unresolved-identifier",file:"unresolved-identifier.ores",expect:"reject",
   diagnostic:"nonexistent_symbol",backends:["java","llvm","net","wasm","forge","js"]}
 ]
});
const mutate=(change)=>{const m=fixture();change(m);return m};

test("current real fixture manifest has positive and negative coverage for all six compiler backends",async()=>{
 const actual=await loadManifest();
 assert.deepEqual(validateManifestSchema(actual),actual);
});

test("missing positive or negative coverage cannot be admitted",()=>{
 const edits=[
  m=>m.cases[0].backends=m.cases[0].backends.filter(x=>x!=="llvm"),
  m=>m.cases[1].backends=m.cases[1].backends.filter(x=>x!=="java"),
  m=>m.cases[0].backends=m.cases[0].backends.filter(x=>x!=="forge"),
  m=>m.cases[1].backends=m.cases[1].backends.filter(x=>x!=="net"),
  m=>m.cases[0].backends=m.cases[0].backends.filter(x=>x!=="js"),
  m=>m.cases[1].backends=m.cases[1].backends.filter(x=>x!=="js"),
  m=>m.cases[0].backends.push("browser"),
  m=>m.cases[1].backends.push("browser")
 ];
 for(const edit of edits)assert.throws(()=>validateManifestSchema(mutate(edit)),/coverage/,edit.toString());
});

test("malformed and duplicate manifest data fails closed",()=>{
 const edits=[
  m=>m.cases=[],
  m=>m.cases=new Array(1001).fill(null),
  m=>m.cases[0].backends.push("java"),
  m=>m.cases[0].backends=[],
  m=>m.cases[0].backends.push("phantom"),
  m=>m.cases[1].id=m.cases[0].id,
  m=>m.cases[1].file=m.cases[0].file,
  m=>m.cases[0].file="int-arithmeticXores",
  m=>m.cases[0].file="../secret.ores",
  m=>m.cases[0].file="other.ores/../../secret.ores",
  m=>m.cases[0].id="x".repeat(129),
  m=>m.cases[0].diagnostic="unexpected",
  m=>m.cases[1].diagnostic="(.*)",
  m=>m.cases[1].diagnostic=null,
  m=>m.cases[1].expect="maybe",
  m=>m.schemaVersion=7
 ];
 for(const edit of edits)assert.throws(()=>validateManifestSchema(mutate(edit)),
  /manifest schema|test id|fixture path|expectation|coverage|diagnostic/,edit.toString());
});

test("regular fixture admission rejects symlinked sources and directories",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"oreslang-manifest-admission-"));
 try{
  const regular=join(dir,"regular.ores");
  const link=join(dir,"link.ores");
  const directory=join(dir,"directory.ores");
  writeFileSync(regular,"pub fnc main(): int { return 42; }");
  mkdirSync(directory);
  await assert.doesNotReject(assertRegularFixture(regular));
  await assert.rejects(assertRegularFixture(directory),/regular non-symlink/);
  try {symlinkSync(regular,link);}
  catch(e){if(["EPERM","EACCES","ENOSYS"].includes(e.code))return;throw e;}
  await assert.rejects(assertRegularFixture(link),/regular non-symlink/);
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});
