#!/usr/bin/env node
// Candidate real-binary Cranelift guest check. Never claims CI or release certification.
// An absent compiler is NOT_EXECUTED (exit 125); it is not a skipped green test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)),
  "../fixtures/cranelift-linked-module-v1/project");
const contract = JSON.parse(await readFile(new URL(
  "../contracts/cranelift-modern-linked-module-v1.json", import.meta.url), "utf8"));
const binary = process.env.ATTO_CRANELIFT_BIN;
const result = {
  schema: "atto.cranelift-linked-native-candidate-execution.v1",
  classification: "NOT_EXECUTED",
  certified: false,
  source_contract: "atto.cranelift-modern-linked-module.v1",
  compiler_sha256: null,
  compiler_head_attested: false,
  case_results: [],
};
const finish = (status, reason) => {
  if (reason) result.reason = String(reason);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = status;
};
if (!binary || !isAbsolute(binary)) {
  finish(125, "ATTO_CRANELIFT_BIN requires an explicit absolute executable path");
} else {
  try {
    assert.equal(process.argv.length, 2, "unapproved runner arguments");
    assert.equal(contract.schema, result.source_contract);
    assert.equal(contract.status, "SOURCE_CORPUS_ONLY_NOT_EXECUTED");
    assert.equal(contract.cases.length, 17);
    const total = { PASS: 6, PANIC: 3, REJECT: 8 };
    for (const [kind, count] of Object.entries(total))
      assert.equal(contract.cases.filter(c => c.expect === kind).length, count, kind);
    assert.equal(new Set(contract.cases.map(c => c.id)).size, 17, "duplicate case");
    assert.equal(Object.keys(contract.source_blobs).length, 19);
    const binaryStat = await lstat(binary);
    assert.ok(binaryStat.isFile() && !binaryStat.isSymbolicLink(),
      "compiler must be a real non-symlink regular file");
    assert.ok(binaryStat.size > 0 && binaryStat.size < 128 * 1024 * 1024,
      "compiler file too large / empty");
    const compilerBytes = await readFile(binary);
    assert.equal(compilerBytes.length, binaryStat.size, "compiler bytes drifted");
    result.compiler_sha256 = createHash("sha256").update(compilerBytes).digest("hex");

    async function checkedSource(name) {
      assert.match(name, /^(?:\.ores\.pkg\.toml|src\/(?:lib\/)?[a-z0-9-]+\.atto)$/u,
        "unexpected fixture path");
      const path = resolve(project, name);
      assert.ok(path.startsWith(project + sep), "source outside project");
      let cursor = project;
      for (const segment of name.split("/")) {
        cursor = join(cursor, segment);
        const stat = await lstat(cursor);
        assert.ok(!stat.isSymbolicLink(), "symlink source not permitted");
      }
      const stat = await lstat(path);
      assert.ok(stat.isFile() && stat.size < 1024 * 1024, "invalid source type/budget");
      const bytes = await readFile(path);
      assert.equal(bytes.length, stat.size, "source mutated mid-read");
      const hash = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
        .update(bytes).digest("hex");
      assert.equal(hash, contract.source_blobs[name], "source blob SHA mismatch: " + name);
      return path;
    }
    const paths = new Map();
    for (const name of Object.keys(contract.source_blobs))
      paths.set(name, await checkedSource(name));

    function run(mode, entry) {
      const child = spawnSync(binary, [mode, entry], {
        cwd: project,
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 256 * 1024,
        shell: false,
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: project,
          LANG: "C",
          LC_ALL: "C",
        },
      });
      assert.equal(child.error, undefined, "binary launch failed: " + String(child.error));
      assert.equal(child.signal, null, "signal/timeout: " + child.signal);
      assert.ok(child.status === 0 || child.status === 1,
        "unexpected compiler exit: " + child.status);
      return child;
    }
    for (const spec of contract.cases) {
      assert.equal(spec.status, "NOT_EXECUTED", "registry may not self-certify");
      assert.equal(spec.git_blob_sha, contract.source_blobs[spec.entry]);
      const entry = paths.get(spec.entry);
      assert.ok(entry, "missing fixture: " + spec.id);
      const checks = {};
      for (const mode of ["check", "ir", "run"]) {
        const outcome = run(mode, entry);
        checks[mode] = { exit_code: outcome.status,
          stdout_bytes: Buffer.byteLength(outcome.stdout, "utf8") };
        if (spec.expect === "REJECT") {
          assert.equal(outcome.status, 1, spec.id + " " + mode + ": unexpected acceptance");
          assert.equal(outcome.stdout, "", spec.id + " " + mode + ": emitted guest/IR");
          assert.ok(outcome.stderr.trim(), spec.id + ": missing rejection diagnostic");
        } else if (mode === "check") {
          assert.equal(outcome.status, 0, spec.id + ": checked guest rejected");
          assert.equal(outcome.stdout, "", spec.id + ": check emitted guest output");
        } else if (mode === "ir") {
          assert.equal(outcome.status, 0, spec.id + ": checked IR rejected");
          assert.match(outcome.stdout, /; linked function main/u, spec.id);
          assert.match(outcome.stdout, /\bcall\s+/u,
            spec.id + ": no actual native helper call in CLIF");
        } else if (spec.expect === "PASS") {
          assert.equal(outcome.status, 0, spec.id + ": guest failed");
          assert.equal(outcome.stdout, "42\n", spec.id + ": incorrect CLI result");
          assert.equal(outcome.stderr, "", spec.id + ": unexpected diagnostics");
        } else if (spec.expect === "PANIC") {
          assert.equal(outcome.status, 1, spec.id + ": checked failure was erased");
          assert.equal(outcome.stdout, "", spec.id + ": overflow printed success");
          assert.match(outcome.stderr, /i64 arithmetic overflow/u,
            spec.id + ": missing checked failure classification");
        }
      }
      result.case_results.push({ id: spec.id, expected: spec.expect,
        observed: "CANDIDATE_MATCH", checks });
    }
    for (const [name] of paths) await checkedSource(name);
    assert.equal((await readFile(binary)).length, compilerBytes.length,
      "compiler size changed during run");
    assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"),
      result.compiler_sha256, "compiler binary changed during run");

    // A user-supplied local binary is not independently authenticated to a
    // compiler Git HEAD/tree. These are guest *candidate* observations only.
    result.classification = "LOCAL_GUEST_CANDIDATE_UNATTESTED";
    result.reason = "No independent source/head/runner provenance or authorized CI receipt";
    finish(0);
  } catch (error) {
    result.classification = result.case_results.length
      ? "PARTIAL_GUEST_EXECUTION_FAILED" : "GUEST_EXECUTION_FAILED";
    finish(1, error?.message ?? error);
  }
}
