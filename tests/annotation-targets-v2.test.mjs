import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateAnnotationTargetsV2 } from "../src/annotation-targets-v2.mjs";

const filename = new URL("../contracts/annotations/annotation-targets-v2.json", import.meta.url);
const baseline = JSON.parse(readFileSync(filename, "utf8"));
const copy = () => structuredClone(baseline);
const rejects = (value) => assert.throws(() => validateAnnotationTargetsV2(value),
  /ANNOTATION_V2_INVALID/);

test("source-only v2 annotation target inventory is complete and unpromoted", () => {
  assert.deepEqual(validateAnnotationTargetsV2(baseline), {
    targets: 28, families: 27, backends: 5
  });
});

test("cannot silently omit declaration, type-use or actor targets", () => {
  const altered = copy();
  altered.targets = altered.targets.filter(t => t.id !== "actor_state_field");
  rejects(altered);
});

test("duplicate target or annotation names never overwrite earlier schemas", () => {
  const duplicateTarget = copy();
  duplicateTarget.targets.push(duplicateTarget.targets[0]);
  rejects(duplicateTarget);
  const duplicateFamily = copy();
  duplicateFamily.annotation_families.push(duplicateFamily.annotation_families[0]);
  rejects(duplicateFamily);
});

test("unregistered annotation targets and phases are refused", () => {
  const badTarget = copy();
  badTarget.annotation_families[0].allowed_targets = ["supervisor"];
  rejects(badTarget);
  const badPhase = copy();
  badPhase.annotation_families[0].phase = "RUNTIME_REFLECTION";
  rejects(badPhase);
});

test("no annotation family can claim permission-grant authority", () => {
  const bad = copy();
  bad.annotation_families[0].name = "GrantPermission";
  rejects(bad);
  const badRule = copy();
  badRule.rules.authorization = "annotations grant capabilities";
  rejects(badRule);
});

test("repeatability must be typed, declared and never inferred from duplication", () => {
  const bad = copy();
  delete bad.annotation_families[0].repeatable;
  rejects(bad);
  const badArguments = copy();
  badArguments.annotation_families[0].argument_schema = "unchecked";
  rejects(badArguments);
});

test("staged feature labels cannot be rewritten as compiler implementation", () => {
  const bad = copy();
  bad.annotation_families.find(x => x.name === "gpu").status = "implemented";
  rejects(bad);
});

test("zero-step CI or host-only evidence cannot be recorded as guest parity", () => {
  const fakePass = copy();
  fakePass.evidence.llvm = "GUEST_PASS";
  rejects(fakePass);
  const zeroSteps = copy();
  zeroSteps.rules.evidence = "a workflow record is sufficient";
  rejects(zeroSteps);
});

test("cannot silently mark LLVM, Wasm, .NET or Forge implemented", () => {
  const bad = copy();
  bad.targets.find(x => x.id === "class").other_backends = "partial";
  rejects(bad);
});

test("changes to the backend inventory are versioned instead of silently inferred", () => {
  const bad = copy();
  bad.backends.push("cranelift");
  rejects(bad);
});
