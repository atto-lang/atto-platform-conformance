import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const base = new URL("../fixtures/task-blocks/v0/", import.meta.url);
const contract = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const ids = ["do-nb-no-handle","task-int-await","task-void-await","reject-bare-nb","reject-escaping-borrow",
 "task-iife-expression","task-iife-block","task-iife-awaited","task-iife-future-observer","reject-async-task-lambda"];

test("task blocks remain an explicitly unverified source contract", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.scope, "task-blocks-v0-draft");
  assert.equal(contract.runtimeVerified, false);
  assert.deepEqual(contract.backends, {
    "java-graalvm": "parser-only-runtime-gated",
    llvm: "fail-closed",
    net: "unverified", wasm: "unverified", forge: "unverified"
  });
  assert.deepEqual(contract.cases.map(c => c.id), ids);
  assert.equal(new Set(contract.cases.map(c => c.file)).size, ids.length);
  for (const c of contract.cases) {
    assert.equal(c.file, c.id + ".ores");
    assert.ok(["accept", "reject"].includes(c.parserExpected));
    assert.ok(["pending", "forbidden", "reject"].includes(c.runtimeExpected));
  }
});

test("fixtures disambiguate explicit detached statements from awaitable expressions", async () => {
  const read = async name => readFile(new URL(name + ".ores",base), "utf8");
  const detached = await read("do-nb-no-handle");
  assert.match(detached, /\bdo nb\s*\{/);
  assert.doesNotMatch(detached, /let\s+Task\s*</);
  assert.match(detached, /\bawait\b/);
  assert.match(detached, /nextStep\s*\(\)/);
  const result = await read("task-int-await");
  assert.match(result, /let\s+Task<int>\s+r\s*=\s*nb\s*\{/);
  assert.match(result, /return\s+x\s*\+\s*1\s*;/);
  assert.match(result, /let\s+int\s+answer\s*=\s*await\s+r\s*;/);
  const zero = await read("task-void-await");
  assert.match(zero, /let\s+Task<void>\s+r\s*=\s*nb\s*\{/);
  assert.match(zero, /await\s+r\s*;/);
});

test("negative fixtures must not be mistaken for executable parity", async () => {
  const bare = await readFile(new URL("reject-bare-nb.ores",base),"utf8");
  assert.match(bare, /\n\s*nb\s*\{/);
  assert.doesNotMatch(bare, /\bdo nb\s*\{/);
  const borrow = await readFile(new URL("reject-escaping-borrow.ores",base),"utf8");
  assert.match(borrow, /rt borrow mut/);
  assert.match(borrow, /nb\s*\{/);
  assert.equal(contract.cases.find(c=>c.id==="reject-escaping-borrow").runtimeExpected,"reject");
});


test("IIFE Task lambdas pass positional args without an async wrapper", async () => {
  const read = async name => readFile(new URL(name + ".ores", base), "utf8");
  const arrow = await read("task-iife-expression");
  const braced = await read("task-iife-block");
  assert.match(arrow, /\(\|int a, string b\| -> nb\s*\{/);
  assert.match(arrow, /\}\)\(5, "xyz"\)/);
  assert.match(arrow, /let Task<int> task\s*=/);
  assert.match(arrow, /let int answer = await task/);
  assert.doesNotMatch(arrow, /\basync\s*\|/);
  assert.match(braced, /\(\|int a, string b\| ->\s*\{/);
  assert.match(braced, /return nb\s*\{/);
  assert.match(braced, /\}\)\(5, "xyz"\)/);
  assert.doesNotMatch(braced, /\basync\s*\|/);
});

test("outer await joins the Task, while asFuture is an explicit observer", async () => {
  const read = async name => readFile(new URL(name + ".ores",base), "utf8");
  const awaited = await read("task-iife-awaited");
  const projected = await read("task-iife-future-observer");
  assert.match(awaited, /let int answer = await\s*\(\|int a, string b\| -> nb/);
  assert.match(projected, /let Future<int> result = /);
  assert.match(projected, /\}\)\(5, "xyz"\)\.asFuture\(\)/);
  assert.match(projected, /let int answer = await result/);
  assert.doesNotMatch(projected, /\basync\s*\|/);
});

test("async lambda nesting must remain forbidden without Future<Task<T>> semantics", async () => {
  const invalid = await readFile(new URL("reject-async-task-lambda.ores",base), "utf8");
  assert.match(invalid, /\(async \|int a, string b\| -> nb\s*\{/);
  const entry = contract.cases.find(c => c.id === "reject-async-task-lambda");
  assert.equal(entry.parserExpected, "reject");
  assert.equal(entry.runtimeExpected, "forbidden");
});
