import test from "node:test";
import assert from "node:assert/strict";
import {
  gitBlobSha,classFixtures,assertDuplicateRejection,runClassGate
} from "./run-llvm.mjs";

test("12 pinned fixtures: 4 class guests, 4 class rejects, 4 actor pending",()=>{
  const {cases,manifestSha256,actorsPending}=classFixtures();
  assert.equal(cases.length,8);
  assert.equal(actorsPending,4);
  assert.match(manifestSha256,/^[a-f0-9]{64}$/);
  assert.equal(cases.filter(x=>x.item.expect==="accept").length,4);
  assert.equal(cases.filter(x=>x.item.expect==="reject").length,4);
  assert.match(gitBlobSha(Buffer.from("test")),/^[a-f0-9]{40}$/);
});

test("collision evidence rejects unrelated error/crash/IR/success",()=>{
  const good={status:1,signal:null,stdout:"",
    stderr:"oreslang-llvmc: duplicate native method name/arity 'x/0' (self receiver does not count toward arity) at byte 37 [file: class-zero-implicit-then-mut-reject.ores]\n"};
  assert.equal(assertDuplicateRejection(good,"x/0","class-zero-implicit-then-mut-reject.ores"),true);
  for(const bad of [
    {...good,status:0},{...good,status:139},
    {...good,stdout:"; ModuleID = forged"},
    {...good,signal:"SIGSEGV"},
    {...good,stderr:"unsupported source target"},
    {...good,stderr:"oreslang-llvmc: unrelated error at byte 1\n"+good.stderr},
    {...good,stderr:"oreslang-llvmc: duplicate native method name/arity 'x/1' at byte 37 [file: class-zero-implicit-then-mut-reject.ores]\n"},
    {...good,stderr:good.stderr.replace("at byte 37","at byte NOT_A_NUMBER")},
    {...good,stderr:good.stderr.replace("x/0","x/00")},
    {...good,stderr:good.stderr.replace("[file: class-zero-implicit-then-mut-reject.ores]","[file: wrong.ores]")},
    {...good,stderr:good.stderr.replace("x/0", "x/0' trailing unrelated diagnostic '")}
  ])assert.throws(()=>assertDuplicateRejection(bad,"x/0","class-zero-implicit-then-mut-reject.ores"));
  assert.throws(()=>assertDuplicateRejection(good,"x/42"));
  assert.throws(()=>assertDuplicateRejection(good,"x/0","wrong.ores"));
});

test("real compiler gate cannot skip when executable/pin missing",()=>{
  assert.throws(()=>runClassGate(),/required/);
  assert.throws(()=>runClassGate({compiler:"relative",compilerSha256:"0".repeat(64),
    compilerSourceSha:"1".repeat(40)}),/required/);
  assert.throws(()=>runClassGate({compiler:"/invalid/oreslang-llvmc",
    compilerSha256:"0".repeat(64),compilerSourceSha:"1".repeat(40)}));
});
