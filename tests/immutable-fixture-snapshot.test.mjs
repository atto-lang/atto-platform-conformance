import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,symlink,link,rm,open} from "node:fs/promises";
import {readFileSync,existsSync,chmodSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,basename,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readRegularFixtureBytes,snapshotRegularFixture,hashExecutableBounded,runSuite} from "../src/harness.mjs";

test("fixture execution uses immutable hashed snapshot, not checkout path",async()=>{
 const sha="012345678901234567890123456789abcdefabcd";
 const cmd=[process.execPath,fileURLToPath(new URL("./fake-checker.mjs",import.meta.url)),"{file}"];
 const seen=[];
 const runner=(bin,args)=>{
  const file=args.at(-1);
  assert.notEqual(resolve(file),resolve("fixtures",basename(file)));
  const bytes=readFileSync(file);
  seen.push({file,hash:createHash("sha256").update(bytes).digest("hex")});
  if(bytes.toString("utf8").includes("nonexistent_symbol"))
   return {status:1,signal:null,stdout:"",stderr:"error: unresolved identifier nonexistent_symbol"};
  return {status:0,signal:null,stdout:"accepted",stderr:""};
 };
 const result=await runSuite({backend:"java",argv:cmd,sourceSha:sha,spawn:runner});
 assert.equal(result.ok,true);
 assert.equal(seen.length,2);
 for(let i=0;i<seen.length;i++){
  assert.equal(seen[i].hash,result.results[i].fixtureSha256);
  assert.equal(existsSync(seen[i].file),false,"temporary snapshot not removed");
 }
});

test("descriptor-verified snapshot rejects symlinks, hardlinks and oversized sources",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-fixture-snapshot-test-"));
 try{
  const source=join(dir,"source.ores");
  const output=join(dir,"snapshot.ores");
  const text="pub fnc main():int{return 42;}\n";
  await writeFile(source,text);
  const hash=await snapshotRegularFixture(source,output);
  assert.equal(hash,createHash("sha256").update(text).digest("hex"));
  await writeFile(source,"pub fnc main():int{return 99;}\n");
  assert.equal(await readFile(output,"utf8"),text,"snapshot changed with source");

  const symlinkPath=join(dir,"symlink.ores");
  await symlink(source,symlinkPath);
  await assert.rejects(readRegularFixtureBytes(symlinkPath));
  const hardlinkPath=join(dir,"hardlink.ores");
  await link(source,hardlinkPath);
  await assert.rejects(readRegularFixtureBytes(source));
  await assert.rejects(readRegularFixtureBytes(hardlinkPath));
  const empty=join(dir,"empty.ores");
  await writeFile(empty,"");
  await assert.rejects(readRegularFixtureBytes(empty));
  const big=join(dir,"big.ores");
  await writeFile(big,Buffer.alloc(1024*1024+1,0x61));
  await assert.rejects(readRegularFixtureBytes(big));
 }finally{await rm(dir,{recursive:true,force:true})}
});


test("a compiler that alters later sealed source cannot earn a verification receipt",async()=>{
 const sha="012345678901234567890123456789abcdefabcd";
 const argv=[process.execPath,fileURLToPath(new URL("./fake-checker.mjs",import.meta.url)),"{file}"];
 let called=0;
 const tamperingRunner=(_bin,args)=>{
  called++;
  if(called===1){
   // A process running as the same UID can chmod a nominally read-only
   // snapshot. The receipt must fail closed instead of silently passing it.
   const next=join(dirname(args.at(-1)),"unresolved-identifier.ores");
   chmodSync(next,0o600);
   writeFileSync(next,"pub fnc main():int{return 3;}\n");
  }
  return {status:0,signal:null,stdout:"accepted",stderr:""};
 };
 await assert.rejects(runSuite({
  backend:"java",argv,sourceSha:sha,spawn:tamperingRunner
 }),/sealed fixture changed after snapshot/);
 assert.equal(called,1,"tampered second fixture must never be executed");
});

test("executable provenance hashes a bounded opened descriptor",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-executable-hash-test-"));
 try{
  const file=join(dir,"compiler.bin");
  const bytes=Buffer.from("executable fixture bytes");
  await writeFile(file,bytes);
  assert.equal(await hashExecutableBounded(file),
   createHash("sha256").update(bytes).digest("hex"));
  const sparse=join(dir,"sparse.bin");
  const handle=await open(sparse,"wx",0o600);
  try{await handle.truncate(512*1024*1024+1)}finally{await handle.close()}
  await assert.rejects(hashExecutableBounded(sparse),/bounded regular file/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
