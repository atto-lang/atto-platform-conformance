import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
  nativeNumericDiagnostic,renameNumericGuestMain,validateNumericCorpus,
  executeNativeNumericCorpus
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

test("native corpus execution cannot implicitly pass without pinned tools",async()=>{
  await assert.rejects(executeNativeNumericCorpus({}),/exact 40-character/);
  await assert.rejects(executeNativeNumericCorpus({sourceCommit:"a".repeat(40)}),
    /absolute path and SHA-256/);
});
