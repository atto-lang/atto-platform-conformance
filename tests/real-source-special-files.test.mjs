import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm,readFile,symlink} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const cli=fileURLToPath(new URL("../bin/real-source-wasm-browser.mjs",import.meta.url));
const digest=b=>createHash("sha256").update(b).digest("hex");

test("native conformance preflight refuses FIFO and symlink substitutions without blocking",{
 skip:process.platform==="win32"
},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-native-special-"));
 const paths={
  compiler:join(dir,"compiler.bin"),bridge:join(dir,"bridge.mjs"),
  source:join(dir,"source.ores"),"browser-module":join(dir,"adapter.mjs")
 };
 const samples={
  compiler:Buffer.from([0x7f,0x45,0x4c,0x46,1]),
  bridge:Buffer.from("export {};\n"),
  source:Buffer.from("pub fnc main(): int { return 42; }\n"),
  "browser-module":Buffer.from("export {};\n")
 };
 const args=()=>Object.entries(paths).flatMap(([k,path])=>[
  "--"+k+"="+path,"--"+k+"-sha256="+digest(samples[k])
 ]).concat(["--output="+join(dir,"guest.wasm"),"--expected-i64=42"]);
 try{
  for(const [key,path] of Object.entries(paths))await writeFile(path,samples[key]);
  for(const key of Object.keys(paths)){
   await rm(paths[key]);
   const mk=spawnSync("mkfifo",[paths[key]],{encoding:"utf8",timeout:1500});
   assert.equal(mk.status,0,mk.stderr||mk.error?.message);
   const child=spawnSync(process.execPath,[cli,...args()],{encoding:"utf8",timeout:3000});
   assert.equal(child.error?.code,undefined,key+" FIFO blocked input admission: "+child.error?.message);
   assert.notEqual(child.status,0,key+" FIFO unexpectedly admitted");
   assert.match(child.stderr,/native conformance input budget|EAGAIN|ELOOP/,key+" FIFO reason");
   await rm(paths[key]);await writeFile(paths[key],samples[key]);
  }
  const target=join(dir,"safe-original.mjs");
  await writeFile(target,samples.bridge);
  await rm(paths.bridge);
  await symlink(target,paths.bridge);
  const symlinkRun=spawnSync(process.execPath,[cli,...args()],{encoding:"utf8",timeout:3000});
  assert.equal(symlinkRun.error?.code,undefined,"symlink admission blocked");
  assert.notEqual(symlinkRun.status,0);
  assert.match(symlinkRun.stderr,/ELOOP|native conformance input budget/);
  await assert.rejects(readFile(join(dir,"guest.wasm")),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true})}
});
