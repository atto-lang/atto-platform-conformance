import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,writeFile,readFile,chmod,symlink,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {runNativeCranelift} from "../bin/run-cranelift-native-v1.mjs";

const commit="a".repeat(40);
const untrusted="b".repeat(64);
test("native Cranelift admission requires an absolute installed real compiler",async()=>{
  await assert.rejects(runNativeCranelift(),/unconfigured compiler/);
  await assert.rejects(runNativeCranelift({compiler:"./fake",compilerSha256:untrusted,
    compilerCommit:commit}),/unconfigured compiler/);
});
test("native Cranelift gate rejects incomplete source revision and compiler digest",async()=>{
  await assert.rejects(runNativeCranelift({compiler:"/no/such/compiler",
    compilerSha256:untrusted}),/source commit/);
  await assert.rejects(runNativeCranelift({compiler:"/no/such/compiler",
    compilerCommit:commit}),/SHA-256/);
});
test("native runner forbids injected process launchers before any source or compiler I/O",async()=>{
  let attempted=false;
  const fake=()=>{attempted=true;return {status:0,stdout:"42\\n",stderr:""};};
  await assert.rejects(runNativeCranelift({compiler:"/no/such/compiler",
    compilerSha256:untrusted,compilerCommit:commit,spawn:fake}),
    /unknown or accessor native runner option/);
  assert.equal(attempted,false);
});
test("native runner denies accessors, symbols and inherited option objects",async()=>{
  let accessed=false;
  const getter={compiler:"/no/such/compiler",compilerSha256:untrusted,compilerCommit:commit};
  Object.defineProperty(getter,"timeoutMs",{enumerable:true,get(){
    accessed=true;throw Error("GETTER_EXECUTED");
  }});
  await assert.rejects(runNativeCranelift(getter),/unknown or accessor native runner option/);
  assert.equal(accessed,false);
  const symbol=Symbol("injected-execution");
  await assert.rejects(runNativeCranelift({[symbol]:true}),
    /unknown or accessor native runner option/);
  await assert.rejects(runNativeCranelift(Object.create({compiler:"/no/such/compiler"})),
    /native runner options must be plain object/);
  await assert.rejects(runNativeCranelift(null),/native runner options must be plain object/);
});
test("native Cranelift gate refuses invalid time budgets before filesystem access",async()=>{
  for(const ms of [0,99,30001,-1,NaN,Infinity,1.5]){
    await assert.rejects(runNativeCranelift({compiler:"/no/such/compiler",
      compilerSha256:untrusted,compilerCommit:commit,timeoutMs:ms}),/unsafe compiler timeout/);
  }
});
test("native Cranelift gate does not accept a missing executable",async()=>{
  await assert.rejects(runNativeCranelift({compiler:"/does/not/exist/orescranelift",
    compilerSha256:untrusted,compilerCommit:commit}),/ENOENT/);
});
test("native gate refuses symlinked fake compiler",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orescranelift-symlink-"));
  try{
    const exe=join(root,"fake-compiler"),alias=join(root,"alias");
    const bytes=Buffer.from("#!/bin/sh\nprintf '42\\n'\n");
    await writeFile(exe,bytes);await chmod(exe,0o700);await symlink(exe,alias);
    await assert.rejects(runNativeCranelift({compiler:alias,
      compilerSha256:createHash("sha256").update(bytes).digest("hex"),
      compilerCommit:commit}),/symlink is forbidden/);
  }finally{await rm(root,{recursive:true,force:true})}
});
test("native gate refuses executable digest spoof before launching any guest",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orescranelift-digest-"));
  try{
    const exe=join(root,"fake-compiler");
    await writeFile(exe,"#!/bin/sh\nexit 0\n");await chmod(exe,0o700);
    await assert.rejects(runNativeCranelift({compiler:exe,
      compilerSha256:untrusted,compilerCommit:commit}),/compiler digest mismatch/);
  }finally{await rm(root,{recursive:true,force:true})}
});
test("native gate rejects interpreted shell wrapper that fabricates stdout",async()=>{
  if(process.platform==="win32")return;
  const root=await mkdtemp(join(tmpdir(),"orescranelift-fake-success-"));
  try{
    const exe=join(root,"fake-compiler");
    const bytes=Buffer.from("#!/bin/sh\nprintf '42\\n'\n");
    await writeFile(exe,bytes);await chmod(exe,0o700);
    await assert.rejects(runNativeCranelift({compiler:exe,
      compilerSha256:createHash("sha256").update(bytes).digest("hex"),
      compilerCommit:commit}),/host-native executable image/);
  }finally{await rm(root,{recursive:true,force:true})}
});
test("native gate CLI rejects missing tool and cannot falsely claim a successful run",()=>{
  const cli=new URL("../bin/run-cranelift-native-v1.mjs",import.meta.url).pathname;
  const p=spawnSync(process.execPath,[cli],{encoding:"utf8",timeout:10000});
  assert.equal(p.status,3);
  assert.match(p.stderr,/NATIVE_CRANELIFT_GUEST_NOT_VERIFIED/);
  assert.equal(p.stdout,"");
});
test("native gate CLI rejects unknown arguments before executing source",()=>{
  const cli=new URL("../bin/run-cranelift-native-v1.mjs",import.meta.url).pathname;
  const p=spawnSync(process.execPath,[cli,"--claim-parity=true"],{encoding:"utf8",timeout:10000});
  assert.equal(p.status,3);
  assert.match(p.stderr,/unknown\/duplicate compiler argument/);
});

test("native gate refuses a CLIF-spoofing interpreted wrapper before any invocation",async()=>{
  if(process.platform==="win32")return;
  const root=await mkdtemp(join(tmpdir(),"orescranelift-fake-clif-"));
  try{
    const exe=join(root,"fake-compiler"),marker=join(root,"launched");
    const bytes=Buffer.from("#!/bin/sh\n"+
      "echo launched > '"+marker+"'\n"+
      "echo 'function u0:0() -> i64 {}'\n");
    await writeFile(exe,bytes);await chmod(exe,0o700);
    await assert.rejects(runNativeCranelift({compiler:exe,
      compilerSha256:createHash("sha256").update(bytes).digest("hex"),
      compilerCommit:commit}),/host-native executable image/);
    await assert.rejects(stat(marker),/ENOENT/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test("native gate rejects malformed ELF compiler candidates and admits a real image only for behavioral checks",async()=>{
  if(process.platform!=="linux")return;
  const root=await mkdtemp(join(tmpdir(),"orescranelift-elf-validation-"));
  try{
    const native=await readFile("/usr/bin/true");
    const magicOnly=Buffer.alloc(128);
    magicOnly.set(Buffer.from("7f454c46","hex"),0);
    const wrongMachine=Buffer.from(native);
    wrongMachine.writeUInt16LE(process.arch==="x64"?183:62,18);
    const unboundedProgramHeaders=Buffer.from(native);
    unboundedProgramHeaders.writeBigUInt64LE(BigInt(native.length-1),32);
    const zeroProgramHeaders=Buffer.from(native);
    zeroProgramHeaders.writeUInt16LE(0,56);
    for(const [name,bytes] of [
      ["magic-only",magicOnly],["wrong-machine",wrongMachine],
      ["invalid-program-table",unboundedProgramHeaders],
      ["zero-program-headers",zeroProgramHeaders]
    ]){
      const exe=join(root,name);
      await writeFile(exe,bytes);await chmod(exe,0o700);
      await assert.rejects(runNativeCranelift({compiler:exe,
        compilerSha256:createHash("sha256").update(bytes).digest("hex"),
        compilerCommit:commit}),/host-native executable image/,name);
    }
    const exe=join(root,"native-but-not-a-compiler");
    await writeFile(exe,native);await chmod(exe,0o700);
    await assert.rejects(runNativeCranelift({compiler:exe,
      compilerSha256:createHash("sha256").update(native).digest("hex"),
      compilerCommit:commit}),/did not produce bounded CLIF IR/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test("native compiler identity is checked before IR, between IR/JIT, and after JIT",async()=>{
  // Static callsite coverage protects the no-injected-launcher design until
  // an independently installed compiler is available for real execution.
  const code=await readFile(new URL("../bin/run-cranelift-native-v1.mjs",import.meta.url),"utf8");
  const guards=[...code.matchAll(/await requireStableCompilerImage\(compiler,compilerSha256,evidence\);/g)]
    .map(match=>match.index);
  assert.equal(guards.length,3,"all three compiler identity checks must remain");
  const ir=code.indexOf('const ir=spawnSync(compiler,["ir",file]');
  const jit=code.indexOf('const command=spawnSync(compiler,["run",file]');
  const result=code.indexOf("records.push({id:test.id");
  assert.ok(guards[0]<ir&&ir<guards[1]&&guards[1]<jit&&jit<guards[2]&&guards[2]<result,
    "identity evidence must surround both compiler launches");
  assert.match(code,/observed\.ino===initial\.ino/);
  assert.match(code,/observed\.ctimeMs===initial\.ctimeMs/);
  assert.match(code,/await executableEvidence\(path,digest\)/);
});
