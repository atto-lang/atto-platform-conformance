import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,symlink,link,rm} from "node:fs/promises";
import {readFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,basename} from "node:path";
import {fileURLToPath} from "node:url";
import {readRegularFixtureBytes,snapshotRegularFixture,runSuite} from "../src/harness.mjs";

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
