import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const dir=fileURLToPath(new URL("../fixtures/function-syntax/",import.meta.url));
const manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));

test("function syntax corpus keeps explicit staged backend/tool expectations",()=>{
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.scope,"end-delimited-function-syntax-v2");
  assert.equal(manifest.cases.length,1);
  const c=manifest.cases[0];
  assert.equal(c.id,"end-delimited-roundtrip");
  assert.equal(c.file,"end-delimited-roundtrip.ores");
  assert.equal(c.sourceGitBlobSha1,"6d085173b18d247a6e2641f6aa27ca4a4a3d6b2b");
  assert.deepEqual(c.expectations,{
    java:"accept-and-typecheck",
    formatter:"format-idempotently",
    llvm:"reject-before-ir-until-native-parity"
  });
  assert.deepEqual(c.confirmedBackends,[]);
  assert.deepEqual(c.pendingBackends,["java","formatter","llvm"]);
  assert.equal(manifest.sourceFreeReferenceEvidence.runId,39443132577);
  assert.match(manifest.sourceFreeReferenceEvidence.result,/prior as-separator reference tests passed/);
  assert.match(manifest.sourceFreeReferenceEvidence.result,/:: extension requires refreshed source-free oracle/);
  assert.match(manifest.notes,/v2 fixture adds the callable-header :: separator/i);
  assert.match(manifest.notes,/LLVM remains fail-closed/i);
});

test("function syntax corpus retains exact shared Git blob bytes",async()=>{
  const c=manifest.cases[0];
  const bytes=await readFile(join(dir,c.file));
  const actual=createHash("sha1")
    .update("blob "+bytes.length+"\0")
    .update(bytes)
    .digest("hex");
  assert.equal(actual,c.sourceGitBlobSha1);
});
