import test from "node:test";
import {spawnSync} from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const dir=fileURLToPath(new URL("../contracts/value-pipe-tuples/v1/",import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,"runner-contract.json"),"utf8"));
function gitBlob(input){const b=Buffer.from(input);return createHash("sha1").update(Buffer.concat([Buffer.from("blob "+b.length+String.fromCharCode(0)),b])).digest("hex");}
test("source-only fixture byte identity, NOT guest execution",()=>{
 assert.equal(manifest.schema,"atto.conformance.value-pipe-tuples/v1");
 assert.equal(manifest.negative.length,4);
 assert.equal(manifest.positive.stdout,"39\n");
 for(const fixture of [manifest.positive,...manifest.negative]){
   assert.match(fixture.path,/^(?:negative\/)?[a-z0-9-]+\.atto$/);
   assert.equal(gitBlob(fs.readFileSync(path.join(dir,fixture.path))),fixture.git_blob_sha1);
 }
});
test("positive source uses named stages and tuple lambdas",()=>{
 const source=fs.readFileSync(path.join(dir,manifest.positive.path),"utf8");
 assert.match(source,/\|> validate/);
 assert.match(source,/\|> \|users, x, y\|/);
 assert.match(source,/\|> \|sorted, a, b\|/);
 assert.match(source,/Tuple\[int, int\]/);
});

// Admission negative canaries are source-only: a fake or missing tool must
// never earn a green guest/AOT claim merely because fixtures are well-formed.
test("real backend runner fails closed without a binary and commands",()=>{
  const tool=fileURLToPath(new URL("../scripts/verify-value-pipe-tuples-v1.mjs",import.meta.url));
  const env={...process.env};
  for(const key of ["ATTO_TUPLE_RUN_ARGV_JSON","ATTO_TUPLE_CHECK_ARGV_JSON",
      "ATTO_TUPLE_BACKEND","ATTO_TUPLE_COMPILER_ID","ATTO_TUPLE_COMPILER_BINARY",
      "ATTO_TUPLE_WORKDIR"])delete env[key];
  const run=spawnSync(process.execPath,[tool],{encoding:"utf8",env,timeout:10000});
  assert.notEqual(run.status,0,"missing backend must not produce a PASS");
  assert.match(run.stderr,/ATTO_TUPLE_RUN_ARGV_JSON is required/);
  assert.doesNotMatch(run.stdout,/real_executable_invoked/);
});

test("runner rejects fabricated empty and malformed guest argv",()=>{
  const tool=fileURLToPath(new URL("../scripts/verify-value-pipe-tuples-v1.mjs",import.meta.url));
  for(const forged of ["[]","[123]","[\"not-an-executable\"]"]){
    const run=spawnSync(process.execPath,[tool],{encoding:"utf8",timeout:10000,
      env:{...process.env,ATTO_TUPLE_RUN_ARGV_JSON:forged,
        ATTO_TUPLE_CHECK_ARGV_JSON:'["/bin/false","{fixture}"]'}});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/ATTO_TUPLE_RUN_ARGV_JSON must be JSON argv/);
  }
});
