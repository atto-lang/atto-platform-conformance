import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const base = new URL("../fixtures/task-blocks/v0/", import.meta.url);
const contract = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
const ids = ["do-nb-no-handle","task-int-await","task-void-await","reject-bare-nb","reject-escaping-borrow",
 "task-iife-expression","task-iife-block","task-iife-awaited","task-iife-future-observer",
 "async-task-braced","async-task-expression","async-task-immediate-await",
 "async-future-nested-task","reject-async-task-malformed",
 "task-spelling-value","task-spelling-discard","task-spelling-await","task-nested-not-flattened",
 "nb-task-alias","reject-task-escaping-borrow","reject-task-double-move",
 "reject-task-borrow-across-await","reject-task-borrowed-iife-argument",
 "task-cancel-and-join",
 "suspends-task-body","suspends-task-lambda","suspends-lambda-no-spawn",
 "reject-suspends-task-modifier","reject-sync-lambda-suspends","reject-sync-helper-await",
 "suspends-task-caller-value","suspends-lambda-within-task",
 "reject-suspends-task-prefix","reject-plain-calls-suspends",
 "reject-typed-callback-suspends","reject-mutex-callback-suspends",
 "reject-firstclass-suspends","reject-static-suspends-fnc"];

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
});

test("async task is a single scheduled Task and accepts braced or expression bodies", async () => {
  const read = async name => readFile(new URL(name + ".ores",base), "utf8");
  const braced = await read("async-task-braced");
  const expression = await read("async-task-expression");
  const immediate = await read("async-task-immediate-await");
  assert.match(braced, /\(async task \|int a, string b\| ->\s*\{/);
  assert.match(braced, /return a;/);
  assert.match(braced, /let Task<int> job/);
  assert.match(braced, /let int result = await job/);
  assert.match(expression, /\(async task \|int a, string b\| -> a\)\(5, "xyz"\)/);
  assert.match(immediate, /let int result = await\s*\(async task \|int a, string b\|/);
  for (const id of ["async-task-braced","async-task-expression","async-task-immediate-await"]) {
    assert.equal(contract.cases.find(c => c.id === id)?.parserExpected, "accept");
  }
});

test("ordinary async lambda preserves explicit Future<Task<int>> nesting", async () => {
  const nested = await readFile(new URL("async-future-nested-task.ores",base),"utf8");
  assert.match(nested, /let Task<int> task = await\s*\(async \|int a, string b\| -> nb\s*\{/);
  assert.match(nested, /let int result = await task;/);
  assert.doesNotMatch(nested, /async task/);
  const entry = contract.cases.find(c => c.id === "async-future-nested-task");
  assert.equal(entry.parserExpected,"accept");
  assert.equal(entry.runtimeExpected,"pending");
});

test("malformed async task lambda must fail parser admission", async () => {
  const invalid = await readFile(new URL("reject-async-task-malformed.ores",base), "utf8");
  assert.match(invalid, /\(async task \|int a, string b\|\s*\{/);
  assert.doesNotMatch(invalid, /\| -> \{/);
  const entry = contract.cases.find(c => c.id === "reject-async-task-malformed");
  assert.equal(entry.parserExpected,"reject");
  assert.equal(entry.runtimeExpected,"forbidden");
});


test("task and nb share one Task expression contract, await is the join", async () => {
  const read = async id => readFile(new URL(id + ".ores",base), "utf8");
  const value = await read("task-spelling-value");
  const detached = await read("task-spelling-discard");
  const joined = await read("task-spelling-await");
  assert.match(value, /let Task<int> job = task\s*\{/);
  assert.match(value, /let int value = await job;/);
  assert.match(detached, /\bdo task\s*\{/);
  assert.match(joined, /let int value = await task\s*\{/);
  const alias = await read("nb-task-alias");
  assert.match(alias, /let Task<int> job = nb task\s*\{/);
  assert.equal(contract.cases.find(c => c.id === "nb-task-alias")?.parserExpected, "accept");
});

test("nested Task is not flattened by one await", async () => {
  const file = await readFile(new URL("task-nested-not-flattened.ores",base),"utf8");
  assert.match(file, /Task<Task<int>> outer/);
  assert.match(file, /async task \|int x\| -> task\s*\{/);
  assert.match(file, /Task<int> inner = await outer;/);
  assert.match(file, /int answer = await inner;/);
});

test("borrow and move negative fixtures cannot be classified as passes", async () => {
  const read = async id => readFile(new URL(id + ".ores",base), "utf8");
  for (const id of [
    "reject-task-escaping-borrow", "reject-task-double-move",
    "reject-task-borrow-across-await", "reject-task-borrowed-iife-argument"
  ]) {
    const entry = contract.cases.find(c => c.id === id);
    assert.equal(entry.parserExpected,"accept");
    assert.equal(entry.runtimeExpected,"reject");
  }
  assert.match(await read("reject-task-escaping-borrow"), /rt borrow/);
  assert.match(await read("reject-task-double-move"), /Task<int> second = task/);
  assert.match(await read("reject-task-borrow-across-await"), /await job/);
  assert.match(await read("reject-task-borrowed-iife-argument"), /async task/);
});


test("cancellation and actual cleanup join are distinct guest contracts, not executable yet", async () => {
  const file = await readFile(new URL("task-cancel-and-join.ores", base), "utf8");
  assert.match(file, /let Task<int> job = nb task\s*\{/);
  assert.match(file, /job\.cancel\(\);/);
  assert.match(file, /await job\.get_done\(\);/);
  const entry = contract.cases.find(c => c.id === "task-cancel-and-join");
  assert.equal(entry.parserExpected, "accept");
  assert.equal(entry.runtimeExpected, "pending");
  assert.equal(contract.runtimeVerified, false);
});


test("suspends is a callable effect inside Task, never an implicit spawn", async () => {
  const read = async id => readFile(new URL(id + ".ores", base), "utf8");
  const block = await read("suspends-task-body");
  const lambda = await read("suspends-task-lambda");
  const direct = await read("suspends-lambda-no-spawn");
  assert.match(block, /suspends fnc compute_blocking/);
  assert.match(block, /let Task<int> child = task\s*\{/);
  assert.match(block, /return compute_blocking\(5\);/);
  assert.match(lambda, /\(async task \|int a\| ->\s*\{/);
  assert.match(lambda, /return compute_blocking\(a\);/);
  assert.match(direct, /\(suspends \|int a\| -> compute_blocking\(a\)\)\(5\)/);
  assert.doesNotMatch(direct, /\basync task\b/);
  for (const id of ["suspends-task-body","suspends-task-lambda","suspends-lambda-no-spawn"]) {
    const row = contract.cases.find(c => c.id === id);
    assert.equal(row.parserExpected, "accept");
    assert.equal(row.runtimeExpected, "pending");
  }
});

test("suspends task is redundant, ordinary lambdas cannot inherit effects", async () => {
  const read = async id => readFile(new URL(id + ".ores", base), "utf8");
  assert.match(await read("reject-suspends-task-modifier"),
    /\(suspends task \|int a\| -> a\)/);
  const badModifier = contract.cases.find(c => c.id === "reject-suspends-task-modifier");
  assert.equal(badModifier.parserExpected,"reject");
  assert.equal(badModifier.runtimeExpected,"forbidden");

  const plainLambda = await read("reject-sync-lambda-suspends");
  assert.match(plainLambda, /suspends fnc caller/);
  assert.match(plainLambda, /\|int a\| -> compute_blocking\(\)/);
  assert.equal(contract.cases.find(c=>c.id==="reject-sync-lambda-suspends").runtimeExpected,"reject");

  const helper = await read("reject-sync-helper-await");
  assert.match(helper, /fnc invalid\(\): int\s*\{\s*return await compute\(\)/);
  assert.equal(contract.cases.find(c=>c.id==="reject-sync-helper-await").runtimeExpected,"reject");
});


test("suspends has caller-local effect and adds no hidden Task or Future", async () => {
  const read = async id => readFile(new URL(id + ".ores", base), "utf8");
  const direct = await read("suspends-task-caller-value");
  assert.match(direct, /suspends fnc read_value\(\): int/);
  assert.match(direct, /let Task<int> job = task\s*\{/);
  assert.match(direct, /return read_value\(\);/);
  assert.match(direct, /let int result = await job;/);
  const lambda = await read("suspends-lambda-within-task");
  assert.match(lambda, /\(suspends \|int value\| -> value\)\(5\)/);
  assert.doesNotMatch(lambda, /async task/);
  for (const id of ["suspends-task-caller-value","suspends-lambda-within-task"]) {
    assert.equal(contract.cases.find(c => c.id===id)?.runtimeExpected,"pending");
  }
});

test("suspends task is not a new launch mode and direct plain callers lack effect", async () => {
  const read = async id => readFile(new URL(id + ".ores",base), "utf8");
  assert.match(await read("reject-suspends-task-prefix"), /suspends task\s*\{/);
  assert.equal(contract.cases.find(c=>c.id==="reject-suspends-task-prefix")?.parserExpected,"reject");
  const plain = await read("reject-plain-calls-suspends");
  assert.match(plain, /fnc plain\(\): int \{ return read_value\(\); \}/);
  assert.equal(contract.cases.find(c=>c.id==="reject-plain-calls-suspends")?.runtimeExpected,"reject");
  assert.equal(contract.runtimeVerified,false);
});


test("a suspends effect cannot be erased through plain Fnc values or callbacks", async () => {
  const read = async id => readFile(new URL(id+".ores",base),"utf8");
  const expected = [
    "reject-typed-callback-suspends", "reject-mutex-callback-suspends",
    "reject-firstclass-suspends", "reject-static-suspends-fnc"
  ];
  for (const id of expected) {
    const c = contract.cases.find(entry => entry.id === id);
    assert.equal(c?.parserExpected, "accept");
    assert.equal(c?.runtimeExpected, "reject");
  }
  assert.match(await read("reject-typed-callback-suspends"), /apply\(\|int n\| -> read_blocking\(\), 3\)/);
  assert.match(await read("reject-mutex-callback-suspends"), /mutex\.with_lock\(\|n\| ->\s*\{/);
  assert.match(await read("reject-firstclass-suspends"), /Fnc<int> callback = read_blocking;/);
  assert.match(await read("reject-static-suspends-fnc"), /Fnc<int> callback = Worker\.read_blocking;/);
  assert.equal(contract.runtimeVerified, false);
});
