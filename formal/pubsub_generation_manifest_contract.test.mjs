import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// These are source-only manifest tampering tests, not guest/runtime receipts.
const checker = readFileSync(new URL("./check_pubsub_generation_manifest.mjs", import.meta.url), "utf8");
const validManifest = JSON.parse(readFileSync(
  new URL("../fixtures/actor-pubsub-generation-v1/manifest.json", import.meta.url), "utf8"));
const anchor = 'const manifest = JSON.parse(readFileSync("fixtures/actor-pubsub-generation-v1/manifest.json", "utf8"));';
assert.equal(checker.split(anchor).length - 1, 1, "checker injection point drift");
function runManifest(data) {
  const script = checker.replace(anchor, "const manifest = " + JSON.stringify(data) + ";");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding:"utf8", timeout:10000, maxBuffer:256 * 1024
  });
  assert.equal(child.error, undefined, String(child.error));
  return child;
}
function rejectMutation(label, mutate) {
  test("rejects tampered manifest: " + label, () => {
    const data = JSON.parse(JSON.stringify(validManifest));
    mutate(data);
    const outcome = runManifest(data);
    assert.notEqual(outcome.status, 0, "manifest tampering was accepted: " + label);
    assert.match(outcome.stderr, /AssertionError/, "expected a manifest assertion, not an unrelated runtime error");
  });
}
test("intact model manifest is source-only and accounts for all five backends", () => {
  const outcome = runManifest(validManifest);
  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(outcome.stdout.trim());
  assert.equal(result.status, "SOURCE_MODEL_MANIFEST_ONLY");
  assert.equal(result.modelCases, 4);
  assert.deepEqual(result.unverifiedBackends.sort(), ["cranelift","java","llvm","net","wasm"]);
});
rejectMutation("duplicate extra case does not count as coverage", data => {
  data.modelCases.push({...data.modelCases[0]});
});
rejectMutation("invented case id does not count as coverage", data => {
  data.modelCases[0].id = "invented_case";
});
rejectMutation("subscriber bound cannot be silently changed", data => {
  data.bounds.subscribers = 2;
});
rejectMutation("delivery bound cannot be silently changed", data => {
  data.bounds.maxDeliveries = 200;
});
rejectMutation("duplicate refinement obligation is not additional evidence", data => {
  data.outstandingRefinement.push(data.outstandingRefinement[0]);
});
