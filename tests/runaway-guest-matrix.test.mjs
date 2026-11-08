import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, lstatSync} from "node:fs";
import {resolve, sep} from "node:path";
import {validateManifest, REQUIRED_CATEGORIES} from "../src/runaway-matrix.mjs";
const root = resolve(new URL("..", import.meta.url).pathname);
const matrix = JSON.parse(readFileSync(new URL("../contracts/runaway-guest-matrix-v1.json", import.meta.url)));

test("adversarial guest inventory spans all threat categories without claiming execution", () => {
  assert.equal(validateManifest(matrix), true);
  assert.equal(matrix.cases.length, REQUIRED_CATEGORIES.length);
  for (const item of matrix.cases) {
    if (item.fixture === null) continue;
    const filename = resolve(root, item.fixture);
    assert.ok(filename.startsWith(root + sep), "fixture path stays in checkout");
    const stat = lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "regular checked-in fixture");
    const contents = readFileSync(filename);
    assert.ok(contents.length > 32 && contents.length <= 8192, "bounded source");
  }
});
test("fabricated PASS/guest execution claims are rejected", () => {
  const forged = structuredClone(matrix);
  forged.cases[0].guest_status.java = "PASS";
  assert.throws(() => validateManifest(forged), /UNVERIFIED_GUEST_RESULT/);
});
test("duplicate categories, path traversal and omitted negative mutation fail closed", () => {
  const duplicate = structuredClone(matrix);
  duplicate.cases[1].kind = duplicate.cases[0].kind;
  assert.throws(() => validateManifest(duplicate));
  const traversal = structuredClone(matrix);
  traversal.cases[0].fixture = "fixtures/runaway-v1/../../evil.atto";
  assert.throws(() => validateManifest(traversal), /RUNAWAY_FIXTURE_PATH/);
  const erased = structuredClone(matrix);
  erased.cases.pop();
  assert.throws(() => validateManifest(erased));
  const forgedMutation = structuredClone(matrix);
  forgedMutation.cases.find(c => c.kind === "compiler_mutation").fixture =
    "fixtures/runaway-v1/mutual-recursion.atto";
  assert.throws(() => validateManifest(forgedMutation), /MUTATION_REQUIRES_COMPILER_INTERNALS/);
});
