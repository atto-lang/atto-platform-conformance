import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// These checks exercise a finite host model, NOT an AttoLang compiler/runtime.
const source = readFileSync(new URL("./check_actor_control.mjs", import.meta.url), "utf8");
function run(text) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", text], {
    encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024
  });
  assert.equal(child.error, undefined, String(child.error));
  return child;
}
function isExactModelFailure(result, reason) {
  return result.stderr.split(/\r?\n/).some(line => line.trim() === "Error: " + reason);
}
test("unmodified bounded oracle explores each required CONTROL action", () => {
  const result = run(source);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.ok(report.states >= 20 && report.edges >= 25, "trivial state-space evidence");
  for (const name of ["send", "panic", "notice", "deliver", "discard"]) {
    assert.ok(report.hits?.[name] > 0, "required action not reached: " + name);
  }
});
const mutants = [
  ["panic loses priority CONTROL notice", "control:1", "control:0", "panic"],
  ["mailbox closure silently loses queued messages", "dropped:s.dropped+s.queued", "dropped:s.dropped", "discard"],
  ["delivery duplicates an accepted message", "delivered:s.delivered+1", "delivered:s.delivered+2", "deliver"],
  ["send is admitted after closure", "if(s.alive&&s.queued<2&&s.accepted<2)", "if(s.queued<2&&s.accepted<2)", "closed mailbox admitted data"],
  ["supervisor notification is disabled", "if(s.control)moves.push", "if(false)moves.push", "vacuous exploration"],
  ["actor cannot panic at all", 'if(s.alive)moves.push(["panic"', 'if(false)moves.push(["panic"', "vacuous exploration"]
];
for (const [label, original, replacement, expectedReason] of mutants) {
  test("rejects mutant for intended contract: " + label, () => {
    assert.equal(source.split(original).length - 1, 1, "mutation anchor drift: " + label);
    const mutant = source.replace(original, replacement);
    const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      encoding: "utf8", input: mutant, timeout: 10000
    });
    assert.equal(syntax.error, undefined, "syntax checker unavailable: " + label);
    assert.equal(syntax.status, 0, "invalid mutant syntax: " + label + "\n" + syntax.stderr);
    const runResult = run(mutant);
    assert.notEqual(runResult.status, 0, "mutant survived: " + label);
    assert.ok(isExactModelFailure(runResult, expectedReason),
      "mutant did not produce its expected model violation " + expectedReason + ": " + runResult.stderr);
  });
}
test("unrelated execution errors are not valid mutation counterexamples", () => {
  const anchor = " const initial=";
  assert.equal(source.split(anchor).length - 1, 1, "unrelated-crash anchor drift");
  const crashed = run(source.replace(anchor, ' throw Error("unrelated model failure");\n' + anchor));
  assert.notEqual(crashed.status, 0);
  assert.ok(isExactModelFailure(crashed, "unrelated model failure"));
  for (const [, , , reason] of mutants) {
    assert.ok(!isExactModelFailure(crashed, reason),
      "unrelated exception masqueraded as a contract counterexample: " + reason);
  }
});
