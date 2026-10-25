import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp,lstat,mkdir,chmod,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {hashExecutableBounded} from "../src/harness.mjs";
import {fileURLToPath} from "node:url";
import {
  nativeNumericDiagnostic,renameNumericGuestMain,validateNumericCorpus,
  executeNativeNumericCorpus,stageNumericExecutable,runNumericCommand,
  snapshotNumericClangResources
} from "../src/native-numeric-source-evidence.mjs";

const corpusPath=fileURLToPath(new URL("../fixtures/numeric-separators-source-v1.json",import.meta.url));

test("26 numeric guest cases pass shared integrity checks without execution claims",async()=>{
  const source=JSON.parse(await readFile(corpusPath,"utf8"));
  assert.equal(validateNumericCorpus(source).cases.length,26);
  assert.throws(()=>validateNumericCorpus({...source,cases:source.cases.slice(1)}),
    /count/);
  const duplicate=structuredClone(source);
  duplicate.cases[1].id=duplicate.cases[0].id;
  assert.throws(()=>validateNumericCorpus(duplicate),/duplicate/);
  const tampered=structuredClone(source);
  tampered.cases[0].guestSource+=" ";
  assert.throws(()=>validateNumericCorpus(tampered),/mutated/);
});

test("native corpus rejects injected source and contradictory fixture annotations",async()=>{
  const source=JSON.parse(await readFile(corpusPath,"utf8"));
  const tamper=(index,patch)=>{
    const bad=structuredClone(source);
    Object.assign(bad.cases[index],patch);
    return bad;
  };
  const expr="42;} fnc extra(){return 9";
  assert.throws(()=>validateNumericCorpus(tamper(0,{
    expression:expr,guestSource:"pub fnc main():int{return "+expr+";}\n"
  })),/unsafe/);
  const multiline="42\n+1";
  assert.throws(()=>validateNumericCorpus(tamper(0,{
    expression:multiline,guestSource:"pub fnc main():int{return "+multiline+";}\n"
  })),/unsafe/);
  assert.throws(()=>validateNumericCorpus(tamper(0,{
    category:"separator"
  })),/accepted fixture must not declare/);
  const negativeIndex=source.cases.findIndex(x=>x.expect==="reject");
  assert.ok(negativeIndex>=0);
  assert.throws(()=>validateNumericCorpus(tamper(negativeIndex,{
    expectedI64:"42"
  })),/rejected fixture must not declare/);
});

test("primary LLVM error categorization does not confuse failures",()=>{
  assert.equal(nativeNumericDiagnostic("separator",
    "oreslang-llvmc: malformed integer separator at byte 12\n"),true);
  assert.equal(nativeNumericDiagnostic("i64-overflow",
    "oreslang-llvmc: integer literal overflows signed 64-bit result at byte 14\n"),true);
  assert.equal(nativeNumericDiagnostic("type",
    "oreslang-llvmc: arithmetic requires int, got bool at byte 10\n"),true);
  assert.equal(nativeNumericDiagnostic("syntax",
    "oreslang-llvmc: expected identifier at byte 20\n"),true);
  assert.equal(nativeNumericDiagnostic("separator",
    "clang: error: invalid LLVM IR, malformed integer separator"),false);
  assert.equal(nativeNumericDiagnostic("type",
    "oreslang-llvmc: malformed integer separator\nnote: arithmetic requires int, got bool"),false);
  assert.equal(nativeNumericDiagnostic("separator",
    "oreslang-llvmc: integer literal overflows signed 64-bit"),false);
  assert.equal(nativeNumericDiagnostic("separator",
    "oreslang-llvmc: internal parser error; last message: malformed integer separator"),false);
  assert.equal(nativeNumericDiagnostic("i64-overflow",
    "oreslang-llvmc: compilation failed; integer literal overflows signed 64-bit"),false);
  assert.equal(nativeNumericDiagnostic("type",
    "oreslang-llvmc: invalid program; arithmetic requires int, got bool"),false);
  assert.equal(nativeNumericDiagnostic("syntax",
    "oreslang-llvmc: internal bug: expected expression"),false);

  assert.equal(nativeNumericDiagnostic("syntax",
    "fatal: command timed out"),false);
  assert.equal(nativeNumericDiagnostic("separator",
    "runner: file permission denied\noreslang-llvmc: malformed integer separator"),false);
  assert.equal(nativeNumericDiagnostic("separator",
    "clang: linker failed\noreslang-llvmc: malformed integer separator"),false);
  assert.equal(nativeNumericDiagnostic("separator",
    "\n\noreslang-llvmc: malformed integer separator at byte 4"),true);
});

test("real LLVM host ABI isolates i64 guest from i32 status wrapper",()=>{
  // LLVM LlvmCodegen.cpp exports @__oreslang_guest_main() returning i64
  // and a distinct @main() returning i32 with status conversion. A false
  // assumption that i64 @main() exists would make every corpus case fail.
  const original="; ModuleID = 'numeric'\n"
    +"define i64 @__oreslang_guest_main() {\nentry:\n ret i64 -9223372036854775808\n}\n"
    +"define i32 @main() {\nentry:\n %v = call i64 @__oreslang_guest_main()\n"
    +" %truncated = trunc i64 %v to i32\n ret i32 %truncated\n}\n";
  const changed=renameNumericGuestMain(original);
  assert.ok(changed.includes("define i64 @__oreslang_guest_main()"));
  assert.ok(changed.includes("define i32 @oreslang_numeric_unused_host_main()"));
  assert.ok(changed.includes("call i64 @__oreslang_guest_main()"));
  assert.ok(!changed.includes("define i32 @main()"));
  assert.throws(()=>renameNumericGuestMain("define i64 @main() { ret i64 1 }"),
    /one i64/);
  assert.throws(()=>renameNumericGuestMain(original+original),/one i64/);
  assert.throws(()=>renameNumericGuestMain(""),/missing or oversized/);
});

test("native corpus execution fails closed on missing or changed fixture/tool pins",async()=>{
  await assert.rejects(executeNativeNumericCorpus({}),/exact 40-character/);
  await assert.rejects(executeNativeNumericCorpus({sourceCommit:"a".repeat(40)}),
    /manifest SHA-256 required/);
  await assert.rejects(executeNativeNumericCorpus({
    sourceCommit:"a".repeat(40),manifestSha256:"b".repeat(64)
  }),/manifest SHA-256 mismatch/);
  // The fixture digest must be supplied independently, not derived from the
  // same mutable manifest inside the execution command.
});


test("private executable snapshots isolate mutations of original tool bytes",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-num-tool-test-"));
  const runner=join(dir,"runner");
  const origin=join(dir,"origin");
  try{
    await (await import("node:fs/promises")).mkdir(runner,{mode:0o700});
    const bytes=Buffer.from("#!/bin/sh\nprintf 'original\\n'\n");
    await writeFile(origin,bytes,{mode:0o500});
    const digest=createHash("sha256").update(bytes).digest("hex");
    const staged=await stageNumericExecutable({
      file:origin,digest,label:"synthetic compiler",
      workspace:runner,filename:"oreslang-llvmc"
    });
    const stat=await lstat(staged);
    assert.equal(stat.mode&0o777,0o500);
    assert.equal(await hashExecutableBounded(staged),digest);
    const first=spawnSync(staged,[],{encoding:"utf8",timeout:3000});
    assert.equal(first.status,0);
    assert.equal(first.stdout,"original\n");
    // A mutation at the caller path cannot alter the already staged bytes.
    await chmod(origin,0o700);
    await writeFile(origin,"#!/bin/sh\nprintf 'tampered\\n'\n");
    const second=spawnSync(staged,[],{encoding:"utf8",timeout:3000});
    assert.equal(second.status,0);
    assert.equal(second.stdout,"original\n");
    assert.equal(await hashExecutableBounded(staged),digest);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("snapshot admission rejects symlinks, wrong pins and non-private directories",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-num-tool-deny-"));
  const runner=join(dir,"runner");
  const origin=join(dir,"origin");
  const alias=join(dir,"alias");
  try{
    await (await import("node:fs/promises")).mkdir(runner,{mode:0o700});
    const bytes=Buffer.from("#!/bin/sh\nexit 0\n");
    await writeFile(origin,bytes,{mode:0o500});
    await symlink(origin,alias);
    const digest=createHash("sha256").update(bytes).digest("hex");
    await assert.rejects(stageNumericExecutable({
      file:alias,digest,label:"linked fake",workspace:runner,filename:"clang"
    }),/canonical|symlink/);
    await assert.rejects(stageNumericExecutable({
      file:origin,digest:"f".repeat(64),label:"wrong hash",
      workspace:runner,filename:"clang"
    }),/SHA-256 differs/);
    await chmod(runner,0o770);
    await assert.rejects(stageNumericExecutable({
      file:origin,digest,label:"group-write workspace",
      workspace:runner,filename:"clang"
    }),/must be private/);
    await assert.rejects(stageNumericExecutable({
      file:origin,digest,label:"wrong slot",
      workspace:runner,filename:"compiler"
    }),/unexpected numeric executable snapshot name/);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test("bounded real child process execution distinguishes failure, signal and timeout",()=>{
  const nonzero=runNumericCommand(process.execPath,["-e","process.stderr.write('bad source');process.exit(7)"],3000);
  assert.equal(nonzero.code,7);
  assert.equal(nonzero.stderr,"bad source");
  assert.equal(nonzero.error,null);
  assert.equal(nonzero.stderrBytes,10);
  assert.equal(nonzero.stderrSha256,
    createHash("sha256").update(Buffer.from("bad source")).digest("hex"));
  const signalled=runNumericCommand(process.execPath,["-e",
    "process.kill(process.pid,'SIGTERM')"],3000);
  assert.notEqual(signalled.signal,null);
  const timedOut=runNumericCommand(process.execPath,["-e","while(true){}"],120);
  assert.equal(timedOut.error,"ETIMEDOUT");
  assert.notEqual(timedOut.code,0);
  const tooMuch=runNumericCommand(process.execPath,["-e",
    "process.stdout.write('x'.repeat(5*1024*1024))"],3000);
  assert.ok(tooMuch.error||tooMuch.signal||tooMuch.code!==0);
  // The evidence SHA must be over the original pipe bytes, not the decoded
  // replacement characters produced by invalid UTF-8.
  const invalidUtf8=runNumericCommand(process.execPath,["-e",
    "process.stdout.write(Buffer.from([0xff,0xfe,0x41,0x00]))"],3000);
  assert.equal(invalidUtf8.code,0);
  assert.equal(invalidUtf8.stdoutBytes,4);
  const raw=Buffer.from([0xff,0xfe,0x41,0x00]);
  assert.equal(invalidUtf8.stdoutSha256,
    createHash("sha256").update(raw).digest("hex"));
  assert.notEqual(invalidUtf8.stdoutSha256,
    createHash("sha256").update(Buffer.from(invalidUtf8.stdout)).digest("hex"));
});

test("native verifier refuses group/world-writable Clang resource roots",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-num-resource-perms-"));
  const compiler=join(dir,"compiler");
  const clang=join(dir,"clang");
  const resources=join(dir,"resources");
  try{
    const script=Buffer.from("#!/bin/sh\\nexit 0\\n");
    const sha=x=>createHash("sha256").update(x).digest("hex");
    await writeFile(compiler,script,{mode:0o500});
    await writeFile(clang,script,{mode:0o500});
    await mkdir(resources,{mode:0o700});
    await chmod(resources,0o777);
    const manifest=await readFile(corpusPath);
    await assert.rejects(executeNativeNumericCorpus({
      compiler,compilerSha256:sha(script),
      clang,clangSha256:sha(script),
      clangResourceDir:resources,
      sourceCommit:"a".repeat(40),manifestSha256:sha(manifest)
    }),/group[/]world-writable/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("Clang resource tree snapshots detect nested mutation and forbid symlinks",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-clang-tree-audit-"));
  const nested=join(dir,"include");
  const header=join(nested,"stdint.h");
  const link=join(nested,"alias.h");
  try{
    await mkdir(nested,{mode:0o700});
    await writeFile(header,"ABCD\n",{mode:0o600});
    const before=await snapshotNumericClangResources(dir);
    assert.equal(before.files,1);
    assert.equal(before.entries,3);
    assert.match(before.sha256,/^[a-f0-9]{64}$/);
    await writeFile(header,"WXYZ\n");
    const after=await snapshotNumericClangResources(dir);
    assert.notEqual(after.sha256,before.sha256,
      "same-length changed header bytes must change resource digest");
    await chmod(header,0o666);
    await assert.rejects(snapshotNumericClangResources(dir),/group\/world-writable/);
    await chmod(header,0o600);
    await symlink(header,link);
    await assert.rejects(snapshotNumericClangResources(dir),/symlink/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("runtime Clang resource changes revoke all otherwise recorded evidence",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-clang-tree-drift-"));
  try{
    const resourceDir=join(dir,"resources");
    const header=join(resourceDir,"test.h");
    const compiler=join(dir,"compiler");
    const clang=join(dir,"clang");
    await mkdir(resourceDir,{mode:0o700});
    await writeFile(header,"BEFORE\n",{mode:0o600});
    const compilerBytes=Buffer.from(
      "#!/bin/sh\nprintf 'AFTER\\n' > '"+header+"'\n"+
      "printf 'oreslang-llvmc: malformed integer separator at byte 0\\n' >&2\nexit 1\n");
    const clangBytes=Buffer.from("#!/bin/sh\nexit 0\n");
    await writeFile(compiler,compilerBytes,{mode:0o500});
    await writeFile(clang,clangBytes,{mode:0o500});
    const sha=x=>createHash("sha256").update(x).digest("hex");
    const manifest=await readFile(corpusPath);
    const result=await executeNativeNumericCorpus({
      compiler,compilerSha256:sha(compilerBytes),
      clang,clangSha256:sha(clangBytes),clangResourceDir:resourceDir,
      sourceCommit:"e".repeat(40),manifestSha256:sha(manifest)
    });
    assert.equal(result.ok,false);
    assert.equal(result.clangResourceTreeUnchanged,false);
    assert.equal(result.failed,26);
    assert.ok(result.results.every(x=>x.status==="TOOLCHAIN_CHANGED"));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("real 26-case admission loop fails closed on fake compiler and mismatched diagnostics",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-numeric-negative-"));
  try{
    const compiler=join(dir,"fake-compiler");
    const clang=join(dir,"fake-clang");
    // These programs are only deliberately untrusted test doubles, not
    // evidence that an Oreslang guest was compiled. Every accepted source
    // must remain a mismatch even if the test double exits with a diagnostic.
    const compilerBytes=Buffer.from("#!/bin/sh\n"+
      "printf 'oreslang-llvmc: malformed integer separator at byte 0\\n' >&2\nexit 1\n");
    const clangBytes=Buffer.from("#!/bin/sh\n"+
      "if [ \"$1\" = \"-print-resource-dir\" ]; then printf '/tmp\\n'; exit 0; fi\nexit 1\n");
    await writeFile(compiler,compilerBytes,{mode:0o500});
    await writeFile(clang,clangBytes,{mode:0o500});
    const manifestBytes=await readFile(corpusPath);
    const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
    const receipt=await executeNativeNumericCorpus({
      compiler,compilerSha256:sha(compilerBytes),
      clang,clangSha256:sha(clangBytes),clangResourceDir:dir,
      sourceCommit:"a".repeat(40),manifestSha256:sha(manifestBytes)
    });
    assert.equal(receipt.ok,false);
    assert.equal(receipt.parityCertified,false);
    assert.equal(receipt.sourceCommitAttested,false);
    assert.equal(receipt.results.length,26);
    assert.ok(receipt.results.every(row=>row.compilerError===null && row.compilerSignal===null));
    assert.ok(receipt.results.every(row=>/^[a-f0-9]{64}$/.test(row.compilerStderrSha256)));
    assert.ok(receipt.results.every(row=>/^[a-f0-9]{64}$/.test(row.compilerStdoutSha256)));
    assert.equal(receipt.results.filter(x=>x.expect==="accept"&&x.status!=="MISMATCH").length,0);
    assert.equal(receipt.results.filter(x=>x.category==="i64-overflow"&&
      x.status!=="MISMATCH").length,0);
    assert.equal(receipt.results.filter(x=>x.category==="type"&&
      x.status!=="MISMATCH").length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});


test("linker stdout cannot certify an accepted Oreslang guest",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ores-num-linker-denial-"));
  try{
    const compiler=join(dir,"compiler");
    const clang=join(dir,"clang-install");
    // These are deliberately synthetic, test-local programs. The fake
    // compiler emits the correct dual-entry ABI, while fake Clang claims a
    // successful link but writes unexpected stdout and no real executable.
    const compilerBytes=Buffer.from(
      "#!/bin/sh\n"+
      "printf 'define i64 @__oreslang_guest_main() {\\nentry:\\n ret i64 42\\n}\\n"+
      "define i32 @main() {\\nentry:\\n ret i32 0\\n}\\n'\n");
    const clangBytes=Buffer.from(
      "#!/bin/sh\nprintf 'UNEXPECTED_LINKER_STDOUT\\n'\nexit 0\n");
    await writeFile(compiler,compilerBytes,{mode:0o500});
    await writeFile(clang,clangBytes,{mode:0o500});
    const manifest=await readFile(corpusPath);
    const sha=x=>createHash("sha256").update(x).digest("hex");
    const receipt=await executeNativeNumericCorpus({
      compiler,compilerSha256:sha(compilerBytes),
      clang,clangSha256:sha(clangBytes),clangResourceDir:dir,
      sourceCommit:"c".repeat(40),manifestSha256:sha(manifest)
    });
    assert.equal(receipt.ok,false);
    assert.equal(receipt.verified,0);
    assert.equal(receipt.failed,26);
    const positives=receipt.results.filter(c=>c.expect==="accept");
    assert.equal(positives.length,12);
    for(const result of positives){
      assert.equal(result.status,"MISMATCH");
      assert.equal(result.clangExit,0);
      assert.ok(result.clangStdoutBytes>0);
      assert.equal(result.clangStdoutSha256,
        sha(Buffer.from("UNEXPECTED_LINKER_STDOUT\n")));
      assert.equal(result.guestExit,undefined);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
