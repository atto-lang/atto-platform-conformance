import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * An intentionally small, independent reference model for the fixture grammar.
 * This does NOT compile/execute Oreslang or promote a backend to confirmed.
 * Every unsupported fixture form fails instead of being interpreted loosely.
 */
const manifest = JSON.parse(readFileSync(fileURLToPath(
  new URL("../fixtures/error-pattern/v1/matrix.json", import.meta.url)), "utf8"));
const PARENT = Object.freeze({
  FileNotFoundError: "IOError",
  NetworkError: "IOError",
  IOError: "Error",
  ArgumentError: "Error",
  UserError: "Error"
});
const ancestorOf = (ancestor, child) => {
  let current = child;
  for (let i = 0; i < 12 && current; i++, current = PARENT[current]) {
    if (current === ancestor) return true;
  }
  return false;
};
function parseArm(line) {
  const match = /^\s*on\s+(.*?)\s*->\s*\{/.exec(line);
  assert.ok(match, "unexpected source arm: " + line);
  let body = match[1];
  const guarded = /\swhen\s/.test(body);
  body = body.split(/\swhen\s/)[0];
  if (body.startsWith("Err(")) {
    const type = /^Err\((\w+)/.exec(body)?.[1];
    assert.ok(type, "malformed Err payload pattern");
    return {kind: "Err", type, guarded};
  }
  if (body.startsWith("Ok(")) return {kind: "Ok", guarded};
  if (body.startsWith("!")) return {kind: "Not", type: body.slice(1), guarded};
  if (body === "_") return {kind: "Fallback", guarded};
  const type = body.split(" ")[0];
  if (/^[a-z]/.test(type)) return {kind: "Fallback", guarded};
  assert.match(type, /^[A-Z][A-Za-z0-9]*$/);
  return {kind: "Type", type, guarded};
}
function analyze(program) {
  const subject = /fnc classify\(([^)]*)\s+value\): int/.exec(program)?.[1];
  assert.ok(subject, "reference oracle requires a single classify scrutinee");
  const arms = program.split("\n").filter(line => /^\s*on\s.*->/.test(line)).map(parseArm);
  assert.ok(arms.length > 0, "reference oracle requires at least one arm");

  for (let i = 0; i < arms.length; i++) {
    const later = arms[i];
    for (let j = 0; j < i; j++) {
      const prior = arms[j];
      if (prior.guarded) continue;
      if (prior.kind === "Fallback" ||
        (prior.kind === "Type" && later.kind === "Type" &&
          ancestorOf(prior.type, later.type)) ||
        (prior.kind === "Err" && later.kind === "Err" &&
          ancestorOf(prior.type, later.type)) ||
        (prior.kind === "Ok" && later.kind === "Ok")) {
        return {expect: "reject", diagnosticContains: "unreachable match arm"};
      }
    }
  }

  let complete;
  if (subject.startsWith("Result<")) {
    complete = arms.some(arm => arm.kind === "Ok" && !arm.guarded)
      && arms.some(arm => arm.kind === "Err" && arm.type === "Error" && !arm.guarded);
  } else if (subject.includes(" | ")) {
    complete = arms.some(arm => arm.kind === "Fallback" && !arm.guarded)
      || (arms.some(arm => arm.type === "CodedError" && !arm.guarded)
        && arms.some(arm => arm.type?.startsWith("Shape") && !arm.guarded));
  } else {
    complete = arms.some(arm => arm.kind === "Fallback" && !arm.guarded)
      || arms.some(arm => arm.kind === "Type" && arm.type === "Error" && !arm.guarded)
      || arms.some(arm => arm.kind === "Type" && !arm.guarded &&
        arms.some(other => other.kind === "Not" && !other.guarded &&
          other.type === arm.type));
  }
  return complete ? {expect: "accept", diagnosticContains: null}
    : {expect: "reject", diagnosticContains: "non-exhaustive match"};
}

test("all 100 error-pattern expected verdicts agree with independent finite oracle", () => {
  assert.equal(manifest.cases.length, 100);
  for (const item of manifest.cases) {
    const result = analyze(item.program);
    assert.deepEqual(result, {
      expect: item.expect, diagnosticContains: item.diagnosticContains
    }, item.id);
    assert.deepEqual(item.confirmedBackends, [],
      "model agreement must never count as executable backend evidence");
  }
});

test("oracle distinguishes coverage from pattern shadowing", () => {
  const original = manifest.cases.find(x => x.id ===
    "order/child-before-root/FileNotFoundError");
  assert.ok(original);
  assert.deepEqual(analyze(original.program), {expect: "accept", diagnosticContains: null});
  const reordered = original.program.replace(
    /on FileNotFoundError specific -> \{ return 1; \}\n\s*on Error other -> \{ return 2; \}/,
    "on Error other -> { return 1; }\n    on FileNotFoundError specific -> { return 2; }");
  assert.notEqual(reordered, original.program);
  assert.deepEqual(analyze(reordered), {
    expect: "reject", diagnosticContains: "unreachable match arm"
  });
});
