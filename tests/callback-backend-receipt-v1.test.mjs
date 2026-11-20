import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifier = join(
  root,
  "fixtures/execution-context-callbacks/v1/verify_backend_receipt.py",
);
const manifestVerifier = join(
  root,
  "fixtures/execution-context-callbacks/v1/verify_fixture_manifest.py",
);
const fixtureBlob = "83f7db76fd6437d7d4994210e78034b93a5bff26";
const stdout = [
  "before_callback",
  "callback_enter",
  "callback_exit",
  "after_callback",
  "after_await",
  "42",
];

function invoke(receipt) {
  const dir = mkdtempSync(join(tmpdir(), "ores-callback-receipt-"));
  try {
    const file = join(dir, "receipt.json");
    writeFileSync(file, JSON.stringify(receipt));
    return spawnSync("python3", [verifier, file], {
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function base(status) {
  return {
    schema_version: "1.0.0",
    fixture_id: "sync_resolve_registration",
    fixture_git_blob: fixtureBlob,
    backend: "java",
    source_head: "a".repeat(40),
    status,
    compiled_guest: status === "PASS",
    observed_exit: null,
    observed_stdout: null,
  };
}

test("fixture manifest verifier pins exact source and manifest blobs", () => {
  const result = spawnSync("python3", [manifestVerifier], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CALLBACK_SOURCE_FIXTURE_V1_PASS/);
  assert.match(result.stdout, new RegExp(fixtureBlob));
});

test("PASS requires real compiled guest scheduling evidence", () => {
  const receipt = {
    ...base("PASS"),
    compiled_guest: true,
    compiler_identity: "java-linked-program-runner+jdk25",
    expected_exit: 0,
    observed_exit: 0,
    expected_stdout: stdout,
    observed_stdout: stdout,
    guest_inline: false,
    fresh_resume_dispatch: true,
    logical_execution_preserved: true,
    producer_active_execution: false,
    callback_boundary: "HOST_CALLBACK",
    diagnostic: null,
  };
  const result = invoke(receipt);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status=PASS/);

  for (const mutation of [
    {...receipt, guest_inline: true},
    {...receipt, fresh_resume_dispatch: false},
    {...receipt, producer_active_execution: true},
    {...receipt, callback_boundary: "IO"},
    {...receipt, compiled_guest: false},
  ]) {
    assert.notEqual(invoke(mutation).status, 0);
  }
});

test("EXPECTED_REJECT cannot masquerade as guest execution", () => {
  const receipt = {
    ...base("EXPECTED_REJECT"),
    backend: "llvm",
    compiler_identity: "oreslang-llvmc@sha256:example",
    diagnostic:
      "native actor/async declaration requires actor frames, suspension-aware borrow checking and LLVM lowering",
    emitted_artifact: false,
  };
  assert.equal(invoke(receipt).status, 0);

  for (const mutation of [
    {...receipt, compiled_guest: true},
    {...receipt, observed_exit: 1},
    {...receipt, observed_stdout: []},
    {...receipt, emitted_artifact: true},
    {...receipt, diagnostic: ""},
  ]) {
    assert.notEqual(invoke(mutation).status, 0);
  }
});

test("NOT_EXECUTED cannot smuggle compiler or guest evidence", () => {
  const receipt = {
    ...base("NOT_EXECUTED"),
    backend: "forge",
    reason: "source workflow queued or failed before runner execution",
    diagnostic: null,
  };
  assert.equal(invoke(receipt).status, 0);

  for (const mutation of [
    {...receipt, compiled_guest: true},
    {...receipt, observed_exit: 0},
    {...receipt, observed_stdout: stdout},
    {...receipt, diagnostic: "parser said no"},
    {...receipt, reason: ""},
  ]) {
    assert.notEqual(invoke(mutation).status, 0);
  }
});

test("receipt verifier rejects wrong backend, fixture, and status", () => {
  const receipt = {
    ...base("NOT_EXECUTED"),
    reason: "not run",
  };
  for (const mutation of [
    {...receipt, backend: "unknown"},
    {...receipt, fixture_git_blob: "0".repeat(40)},
    {...receipt, fixture_id: "other"},
    {...receipt, status: "PASS-ish"},
  ]) {
    assert.notEqual(invoke(mutation).status, 0);
  }
});
