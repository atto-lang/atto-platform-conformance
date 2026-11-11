// Source-only adversarial canaries for the *runner*, NOT guest/AOT proof.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const tool=fileURLToPath(new URL("../scripts/verify-value-pipe-tuples-v1.mjs",import.meta.url));

function run(env){
  return spawnSync(process.execPath,[tool],{encoding:"utf8",timeout:10000,env:{...process.env,...env}});
}

test("checker must be the pinned compiler executable, not /bin/false",()=>{
  const r=run({
    ATTO_TUPLE_BACKEND:"llvm-native-guest",
    ATTO_TUPLE_COMPILER_ID:"source-only-fake",
    ATTO_TUPLE_COMPILER_BINARY:process.execPath,
    ATTO_TUPLE_WORKDIR:process.cwd(),
    ATTO_TUPLE_RUN_ARGV_JSON:JSON.stringify([process.execPath,"{fixture}"]),
    ATTO_TUPLE_CHECK_ARGV_JSON:JSON.stringify(["/bin/false","{fixture}"])
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/compile-check argv\[0\] must be the pinned/);
  assert.doesNotMatch(r.stdout,/positive_compile_admission/);
});

test("missing valid *positive compile* cannot be hidden by fake run output and all-negative rejection",()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"atto-tuple-admission-"));
  try{
    const mock=path.join(tmp,"mock-compiler");
    fs.writeFileSync(mock,`#!/usr/bin/env node
if(process.argv.includes("--check")){
  console.error("tuple arity return function mismatch");
  process.exit(1);
}
if(process.argv.includes("--run")){
  process.stdout.write("39\\n");
  process.exit(0);
}
process.exit(9);
`,{mode:0o700});
    const r=run({
      ATTO_TUPLE_BACKEND:"llvm-native-guest",
      ATTO_TUPLE_COMPILER_ID:"source-only-fake",
      ATTO_TUPLE_COMPILER_BINARY:mock,
      ATTO_TUPLE_WORKDIR:tmp,
      ATTO_TUPLE_RUN_ARGV_JSON:JSON.stringify([mock,"--run","{fixture}"]),
      ATTO_TUPLE_CHECK_ARGV_JSON:JSON.stringify([mock,"--check","{fixture}"])
    });
    assert.notEqual(r.status,0,"fake guest output + blanket negative rejection must not earn PASS");
    assert.match(r.stderr,/positive tuple source failed compile-only admission/);
    assert.doesNotMatch(r.stdout,/real_executable_invoked/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test("reject fixture substitution embedded in another argv token",()=>{
  const r=run({
    ATTO_TUPLE_RUN_ARGV_JSON:JSON.stringify([process.execPath,"--run","--input={fixture}"]),
    ATTO_TUPLE_CHECK_ARGV_JSON:JSON.stringify([process.execPath,"--check","{fixture}"])
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/standalone \{fixture\}/);
});

test("a program name cannot be supplied as the fixture placeholder",()=>{
  const r=run({
    ATTO_TUPLE_RUN_ARGV_JSON:JSON.stringify(["{fixture}","--run"]),
    ATTO_TUPLE_CHECK_ARGV_JSON:JSON.stringify([process.execPath,"--check","{fixture}"])
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/standalone \{fixture\}/);
});
