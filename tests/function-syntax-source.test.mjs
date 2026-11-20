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
  assert.equal(c.sourceGitBlobSha1,"512597025b9890efa34c1b59cc4f27524edcbeda");
  assert.deepEqual(c.expectations,{
    java:"accept-and-typecheck",
    formatter:"format-idempotently",
    llvm:"reject-before-ir-until-native-parity"
  });
  assert.deepEqual(c.confirmedBackends,[]);
  assert.deepEqual(c.pendingBackends,["java","formatter","llvm"]);
  assert.equal(manifest.sourceFreeReferenceEvidence.runId,39443132577);
  assert.equal(manifest.sourceFreeReferenceEvidence.covers,"v1-as-separator-only");
  assert.match(manifest.sourceFreeReferenceEvidence.result,/^21\/21 independent syntax-reference tests passed$/);
  assert.equal(manifest.v2SourceFreeReferenceEvidence.repository,"zed-pkg/zed-lambdas");
  assert.equal(manifest.v2SourceFreeReferenceEvidence.pullRequest,26);
  assert.equal(manifest.v2SourceFreeReferenceEvidence.runId,39625325242);
  assert.equal(manifest.v2SourceFreeReferenceEvidence.jobId,119308910442);
  assert.equal(manifest.v2SourceFreeReferenceEvidence.privateSourceBytes,0);
  assert.equal(manifest.v2SourceFreeReferenceEvidence.covers,"adversarial-v2-33-vectors");
  assert.match(manifest.v2SourceFreeReferenceEvidence.marker,/accepted=14 rejected=19 private_source_bytes=0$/);
  assert.match(manifest.notes,/No cross-org private compiler source export is authorized/i);
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
