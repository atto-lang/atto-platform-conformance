import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Source-only oracle regression tests. These are NOT compiler-backed .atto evidence.
const source = readFileSync(new URL("./reliable-pubsub-bounded.mjs", import.meta.url), "utf8");
function run(sourceText) {
  const result = spawnSync(process.execPath,
    ["--input-type=module", "-e", sourceText + "\nconsole.log(JSON.stringify(verify()));"],
    { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}
function replaceUnique(anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, "mutation anchor drift: " + anchor);
  return source.replace(anchor, replacement);
}
function assertMutationRejected(anchor, replacement) {
  const result = run(replaceUnique(anchor, replacement));
  assert.notEqual(result.status, 0, "broken oracle or absent mutant was accepted");
  assert.match(result.stderr, /mutation lacked its intended invariant counterexample/,
    "expected a failed mutation-evidence gate rather than an arbitrary execution error");
}
test("bounded RELIABLE model explores states and kills both unsafe mutations", () => {
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.classification, "SOURCE_FREE_BOUNDED_MODEL");
  assert.ok(report.states > 50 && report.edges > report.states, "trivial exploration");
  assert.equal(report.negativeControls, 2);
});
test("literal backslash-n trace separators cannot impersonate a witness", () => {
  assertMutationRejected("message.split(\"\\ntrace=\")", "message.split(\"\\\\ntrace=\")");
});
test("literal backslash-n state separators cannot impersonate an invariant failure", () => {
  assertMutationRejected("message.startsWith(violation + \"\\nstate=\")", "message.startsWith(violation + \"\\\\nstate=\")");
});
test("removing early-ack faulty transition must fail the counterexample gate", () => {
  assertMutationRejected("if (mutant === \"early-ack\") n.acked.push(m.id);", "if (false) n.acked.push(m.id);");
});
test("removing stale-queue faulty transition must fail the counterexample gate", () => {
  assertMutationRejected("if (mutant !== \"retain-old-queue\") n.queue = [];", "n.queue = [];");
});
