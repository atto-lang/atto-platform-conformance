import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, lstatSync, realpathSync} from "node:fs";
import {resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {validateManifest, REQUIRED_CATEGORIES} from "../src/runaway-matrix.mjs";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const matrix = JSON.parse(readFileSync(new URL("../contracts/runaway-guest-matrix-v1.json", import.meta.url)));
const mutate = fn => { const item = structuredClone(matrix); fn(item); return item; };

test("all ten threat categories exist, but no guest execution is claimed", () => {
  assert.equal(validateManifest(matrix), true);
  assert.equal(matrix.cases.length, REQUIRED_CATEGORIES.length);
  for (const item of matrix.cases) {
    if (item.fixture === null) continue;
    const filename = resolve(root, item.fixture);
    assert.ok(filename.startsWith(root + sep), "fixture path stays in checkout");
    const stat = lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "regular checked-in fixture");
    const realFile = realpathSync(filename);
    assert.ok(realFile.startsWith(root + sep), "cannot follow directory symlink outside checkout");
    const contents = readFileSync(realFile);
    assert.ok(contents.length > 32 && contents.length <= 8192, "bounded source");
  }
});
test("forged PASS or omitted backend can never claim guest parity", () => {
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].guest_status.java = "PASS")), /UNVERIFIED_GUEST_RESULT/);
  assert.throws(() => validateManifest(mutate(m =>
    delete m.cases[0].guest_status.llvm)), /UNVERIFIED_GUEST_RESULT/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].guest_status.wasm = null)), /UNVERIFIED_GUEST_RESULT/);
});
test("threat ID, category, path and fixture binding cannot be forged", () => {
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[1].kind = m.cases[0].kind)), /RUNAWAY_CASE_ID_OR_KIND/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[1].id = m.cases[0].id)), /RUNAWAY_CASE_ID_OR_KIND/);
  assert.throws(() => validateManifest({}), /RUNAWAY_MANIFEST_HEADER/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].fixture = "fixtures/runaway-v1/../../evil.atto")), /RUNAWAY_FIXTURE_PATH/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].fixture = "fixtures/runaway-v1/nested-loop.atto")), /RUNAWAY_FIXTURE_PATH/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases.pop())), /RUNAWAY_MANIFEST_HEADER/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases.find(c => c.kind === "compiler_mutation").fixture =
      "fixtures/runaway-v1/mutual-recursion.atto")), /MUTATION_REQUIRES_COMPILER_INTERNALS/);
});
test("changed expected outcomes or unknown fields are not valid evidence", () => {
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].expect = "guest-passed")), /RUNAWAY_EXPECTATION_MISMATCH/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].sibling = "dies")), /RUNAWAY_EXPECTATION_MISMATCH/);
  assert.throws(() => validateManifest(mutate(m =>
    m.cases[0].verified = true)), /RUNAWAY_CASE_ID_OR_KIND/);
  assert.throws(() => validateManifest(mutate(m =>
    m.backends.reverse())), /RUNAWAY_MANIFEST_HEADER/);
});
