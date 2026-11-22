// SOURCE-ONLY oracle and manifest integrity test. DOES NOT compile Atto guest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../contracts/core-types-v1.json", import.meta.url), "utf8"));
assert.equal(manifest.schema, "atto-core-types-v1");
assert.equal(manifest.contract.int_signed_bits, 64);
assert.deepEqual(manifest.sources.map(x=>x.backend), ["java","llvm","net","wasm","rs","forge","cranelift","js","hdl"]);
assert.equal(new Set(manifest.sources.map(x=>x.repository)).size, 9);
for (const b of manifest.sources) {
  assert.match(b.head_sha, /^[a-f0-9]{40}$/);
  assert.match(b.source_blob_sha, /^[a-f0-9]{40}$/);
  assert.match(b.fixture_positive_blob_sha, /^[a-f0-9]{40}$/);
  assert.match(b.fixture_negative_blob_sha, /^[a-f0-9]{40}$/);
  assert.equal(b.guest_status, "NOT_EXECUTED");
  assert.equal(b.negative_status, "NOT_EXECUTED");
  assert.equal(b.aot_status, "NOT_EXECUTED");
}
assert.equal(manifest.evidence.claim_tier, "SOURCE_ONLY_NO_GUEST_EXECUTION");
assert.equal(manifest.matrix_positive_guest.assertionCount,63);
assert.equal(manifest.matrix_positive_guest.expected_exit,0);
assert.equal(manifest.matrix_positive_guest.compiledGuestStatus,"NOT_EXECUTED");
assert.match(manifest.matrix_positive_guest.sourceGitBlobSha,/^[0-9a-f]{40}$/);
assert.match(manifest.matrix_positive_guest.sourceOnlyOracleGitBlobSha,/^[0-9a-f]{40}$/);
assert.equal(manifest.evidence.source_export_authorization,"DENIED_UNAPPROVED");
assert.equal(manifest.evidence.mirrored_to_other_org,false);
for (const b of manifest.sources) {
  assert.equal(b.fixture_matrix_blob_sha,manifest.matrix_positive_guest.sourceGitBlobSha);
  assert.equal(b.matrix_oracle_test_blob_sha,manifest.matrix_positive_guest.sourceOnlyOracleGitBlobSha);
  assert.equal(b.matrix_guest_status,"NOT_EXECUTED");
}
for (const probe of manifest.evidence.source_free_carrier_probes) {
  assert.equal(probe.runner_steps,0);
  assert.equal(probe.status,"NOT_EXECUTED");
  assert.equal(probe.source_exported,false);
}
const negatives = manifest.negative_guests;
assert.equal(negatives.length, 4);
assert.deepEqual(negatives.map(x => x.file), [
  "void-value-negative.atto", "void-return-negative.atto",
  "bool-truthiness-negative.atto", "i64-literal-overflow-negative.atto"
]);
assert.equal(new Set(negatives.map(x => x.file)).size, 4);
for (const item of negatives) {
  assert.match(item.blob_sha, /^[a-f0-9]{40}$/);
  assert.equal(item.expect, "compile_reject_no_artifact");
  assert.equal(item.guest_status, "NOT_EXECUTED");
}
for (const source of manifest.sources) {
  assert.equal(source.fixture_positive_blob_sha, "9d4027de080b8d625ab869825c4ec62f369adce8");
  assert.match(source.source_oracle_test_blob_sha, /^[a-f0-9]{40}$/);
  assert.deepEqual(source.negative_fixture_blobs,
    Object.fromEntries(negatives.map(x=>[x.file,x.blob_sha])),
    "all backends must pin the four negative fixture Git blobs");
}

const INT_MIN = -(1n << 63n), INT_MAX = (1n << 63n) - 1n;
const limits = manifest.contract.endpoints;
let vectorCount = 0;
for (const [kind, [loText, hiText]] of Object.entries(limits)) {
  const lo=BigInt(loText),hi=BigInt(hiText);
  assert(lo<=hi);
  assert(lo>=INT_MIN&&hi<=INT_MAX);
  for(const x of [INT_MIN,-4294967296n,-2147483649n,-32769n,-129n,-1n,0n,1n,127n,128n,255n,256n,32767n,32768n,65535n,65536n,2147483647n,2147483648n,4294967295n,4294967296n,INT_MAX]){
    const expected = (x>=lo&&x<=hi);
    const model = kind==="i64" ? true : kind==="u64_signed_input" ? x>=0n : x>=lo&&x<=hi;
    assert.equal(model, expected, kind+" on "+x);
    vectorCount++;
  }
}
assert.equal(vectorCount, 8*21);
console.log("SOURCE_ONLY_MODEL_PASS: "+vectorCount+" BigInt vectors, 9 backend source references. Guest parity NOT_EXECUTED.");
