import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Model-source mutation gates: not compiler/runtime/production evidence.
const source = readFileSync(new URL("./check_actor_control.mjs", import.meta.url), "utf8");
function run(text) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", text], {
    encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024
  });
  assert.equal(child.error, undefined, String(child.error));
  return child;
}
test("unmodified bounded oracle produces nontrivial evidence", () => {
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.ok((report.states || report.edges) > 0, "empty state-space evidence");
});
const mutants = [["panic loses priority CONTROL notice","control:1","control:0"],["mailbox closure silently loses queued messages","dropped:s.dropped+s.queued","dropped:s.dropped"],["delivery duplicates an accepted message","delivered:s.delivered+1","delivered:s.delivered+2"],["send is admitted after closure","if(s.alive&&s.queued<2&&s.accepted<2)","if(s.queued<2&&s.accepted<2)"],["supervisor notification is disabled","if(s.control)moves.push","if(false)moves.push"],["actor cannot panic at all","if(s.alive)moves.push([\"panic\"","if(false)moves.push([\"panic\""]];
for (const [label, original, replacement] of mutants) {
  test("rejects mutant: " + label, () => {
    assert.equal(source.split(original).length - 1, 1, "mutation anchor drift: " + label);
    const runResult = run(source.replace(original, replacement));
    assert.notEqual(runResult.status, 0, "mutant survived: " + label);
    assert.match(runResult.stderr, /Error|AssertionError/, "mutant had no assertion failure: " + label);
  });
}
