import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp,lstat,chmod,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {hashExecutableBounded} from "../src/harness.mjs";
import {fileURLToPath} from "node:url";
import {
  nativeNumericDiagnostic,renameNumericGuestMain,validateNumericCorpus,
  executeNativeNumericCorpus,stageNumericExecutable
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
  assert.equal(nativeNumericDiagnostic("syntax",
    "fatal: command timed out"),false);
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
