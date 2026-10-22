#!/usr/bin/env node
/**
 * Validate the exact 100 portable source fixtures and optionally materialize
 * each .ores file for a real backend checker. This script NEVER runs a compiler,
 * marks a backend verified, or accepts a claimed status without evidence.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";

const manifestPath = fileURLToPath(new URL("../fixtures/error-pattern/v1/matrix.json", import.meta.url));
const EXPECTED_COUNTS = Object.freeze({
  order: 20, guards: 10, open: 15, fallback: 15,
  result: 20, interface: 10, complement: 10
});
const BACKENDS = ["java-graalvm", "llvm", "wasm", "dotnet", "javascript"];

function reject(message) {
  throw new Error("error-pattern matrix: " + message);
}
function assert(condition, message) {
  if (!condition) reject(message);
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function verify(manifest) {
  assert(manifest?.schemaVersion === 1, "expected schemaVersion=1");
  assert(manifest.scope === "error-pattern-open-nominal-v1", "unexpected scope");
  assert(manifest.totalCases === 100, "declared case count is not 100");
  assert(Array.isArray(manifest.cases) && manifest.cases.length === 100,
    "exactly 100 cases are required");

  const seenIds = new Set(), seenSources = new Set(), counts = {};
  let accept = 0, rejectCount = 0;
  for (const item of manifest.cases) {
    assert(typeof item.id === "string" &&
      /^[a-z][a-z0-9-]*\/[a-z0-9-]+\/[A-Za-z][A-Za-z0-9]*$/.test(item.id),
      "unsafe or malformed id: " + String(item.id));
    assert(!seenIds.has(item.id), "duplicate id: " + item.id);
    seenIds.add(item.id);
    const category = item.id.split("/")[0];
    assert(Object.hasOwn(EXPECTED_COUNTS, category), "unknown category " + category);
    assert(item.category === category, "category does not match id: " + item.id);
    counts[category] = (counts[category] ?? 0) + 1;

    assert(typeof item.program === "string" && item.program.length < 8192 &&
      item.program.includes("match value over") &&
      item.program.includes("fnc classify(") &&
      item.program.trimEnd().endsWith("}"),
      "missing bounded canonical Oreslang program: " + item.id);
    assert(!seenSources.has(item.program), "duplicate Oreslang program: " + item.id);
    seenSources.add(item.program);
    assert(item.expect === "accept" || item.expect === "reject",
      "invalid expected verdict: " + item.id);
    if (item.expect === "accept") {
      assert(item.diagnosticContains === null, "accepted case has expected diagnostic: " + item.id);
      accept++;
    } else {
      assert(typeof item.diagnosticContains === "string" &&
        /^(non-exhaustive match|unreachable match arm)$/.test(item.diagnosticContains),
        "rejected case lacks a precise diagnostic: " + item.id);
      rejectCount++;
    }
    assert(Array.isArray(item.confirmedBackends) && Array.isArray(item.pendingBackends),
      "missing backend evidence state: " + item.id);
    const all = [...item.confirmedBackends, ...item.pendingBackends];
    assert(all.length === BACKENDS.length && new Set(all).size === BACKENDS.length &&
      BACKENDS.every(x => all.includes(x)), "missing or duplicated backend: " + item.id);
    if (item.confirmedBackends.length) {
      assert(Array.isArray(item.evidence) &&
        item.confirmedBackends.every(backend =>
          item.evidence.some(e => e.backend === backend &&
            typeof e.sourceCommit === "string" && /^[0-9a-f]{40}$/.test(e.sourceCommit) &&
            typeof e.reportUrl === "string" && e.reportUrl.startsWith("https://"))),
        "backend claims require explicit exact-source evidence: " + item.id);
    }
  }
  for (const [category, required] of Object.entries(EXPECTED_COUNTS)) {
    assert(counts[category] === required, "category " + category + " expected " + required);
    assert(manifest.categoryCounts?.[category] === required,
      "manifest category tally mismatch: " + category);
  }
  assert(accept === 55 && rejectCount === 45,
    "unexpected positive/negative contract split");
  return {cases: 100, accept, reject: rejectCount, categories: counts};
}

try {
  const args = process.argv.slice(2);
  assert(args.length <= 1, "only --materialize=/absolute/new/directory is supported");
  const data = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(data);
  const summary = verify(manifest);
  if (args.length === 1) {
    const arg = args[0];
    assert(arg.startsWith("--materialize="), "unknown option");
    const folder = arg.slice("--materialize=".length);
    assert(isAbsolute(folder) && folder !== "/", "materialization needs a non-root absolute path");
    assert(!existsSync(folder), "destination already exists: refusing overwrite");
    mkdirSync(folder, {recursive: false, mode: 0o700});
    const emitted = [];
    for (const item of manifest.cases) {
      const file = item.id.replaceAll("/", "--") + ".ores";
      const bytes = Buffer.from(item.program, "utf8");
      writeFileSync(join(folder, file), bytes, {flag: "wx", mode: 0o600});
      emitted.push({
        id: item.id, file, expect: item.expect,
        diagnosticContains: item.diagnosticContains, sha256: hash(bytes)
      });
    }
    writeFileSync(join(folder, "index.json"),
      JSON.stringify({scope: manifest.scope, compilerExecution: false,
        manifestSha256: hash(Buffer.from(data, "utf8")), cases: emitted}, null, 2) + "\n",
      {flag: "wx", mode: 0o600});
    summary.materialized = folder;
  }
  process.stdout.write(JSON.stringify({valid: true, compilerExecuted: false, ...summary}, null, 2) + "\n");
} catch (error) {
  process.stderr.write(String(error?.message ?? error) + "\n");
  process.exitCode = 1;
}
