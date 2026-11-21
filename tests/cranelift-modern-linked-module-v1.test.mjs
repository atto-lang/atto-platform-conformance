import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(await readFile(
  join(here, "../contracts/cranelift-modern-linked-module-v1.json"), "utf8"));
const root = resolve(here, "../fixtures/cranelift-linked-module-v1/project");

function local_path(name) {
  // Never permit arbitrary paths from edited registry data to escape the checkout.
  assert.match(name, /^(?:\.ores\.pkg\.toml|src\/(?:lib\/)?[a-z0-9-]+\.atto)$/u);
  const path = resolve(root, name);
  assert.ok(path.startsWith(root + sep), "fixture path escaped project");
  return path;
}

async function checked_bytes(name) {
  const path = local_path(name);
  let parent = root;
  for (const component of name.split("/")) {
    parent = join(parent, component);
    const stat = await lstat(parent);
    assert.equal(stat.isSymbolicLink(), false, "fixture contains symlink: " + name);
  }
  const stat = await lstat(path);
  assert.ok(stat.isFile(), "fixture is not a regular file: " + name);
  assert.ok(stat.size < 1024 * 1024, "fixture exceeds compiler source budget");
  const bytes = await readFile(path);
  assert.equal(bytes.length, stat.size, "fixture changed during read");
  assert.equal(bytes.toString("utf8").includes("\uFFFD"), false, "invalid UTF-8 fixture");
  const hash = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
  assert.equal(hash, corpus.source_blobs[name], "Git blob mismatch: " + name);
  return bytes.toString("utf8");
}

test("modern linked-module corpus is strictly source-only", () => {
  assert.equal(corpus.schema, "atto.cranelift-modern-linked-module.v1");
  assert.equal(corpus.status, "SOURCE_CORPUS_ONLY_NOT_EXECUTED");
  assert.equal(corpus.compiler_sha, null);
  assert.equal(corpus.runner_receipt, null);
  assert.deepEqual(corpus.execution_proofs, []);
  assert.equal(corpus.backend_evidence.cranelift, "NOT_EXECUTED_UNSUPPORTED_ON_MAIN");
  for (const value of Object.values(corpus.backend_evidence))
    assert.ok(value.startsWith("NOT_EXECUTED"), "fake backend PASS");
  assert.equal(corpus.cases.length, 17);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 17);
  assert.equal(corpus.cases.filter(c => c.expect === "PASS").length, 6);
  assert.equal(corpus.cases.filter(c => c.expect === "REJECT").length, 8);
  assert.equal(corpus.cases.filter(c => c.expect === "PANIC").length, 3);
  for (const c of corpus.cases) {
    assert.equal(c.status, "NOT_EXECUTED");
    assert.equal(c.git_blob_sha, corpus.source_blobs[c.entry]);
    assert.ok(["PASS", "REJECT", "PANIC"].includes(c.expect));
    if (c.expect === "PASS") assert.equal(c.expect_stdout, "42\n");
    else assert.equal(c.expect_stdout, null);
  }
});

test("every exact Git blob is accounted for and rooted under the project", async () => {
  assert.equal(Object.keys(corpus.source_blobs).length, 19);
  for (const name of Object.keys(corpus.source_blobs)) {
    assert.match(corpus.source_blobs[name], /^[0-9a-f]{40}$/u);
    await checked_bytes(name);
  }
  const entries = new Set(corpus.cases.map(c => c.entry));
  assert.equal(entries.size, 8);
  assert.deepEqual(
    new Set(Object.keys(corpus.source_blobs)),
    new Set([".ores.pkg.toml", "src/lib/helpers.atto", ...entries])
  );
});

test("portable standalone multi-function typed and checked-call contracts are source-pinned", async () => {
  const byId = new Map(corpus.cases.map(c => [c.id, c]));
  const typed = await checked_bytes("src/standalone-type-first.atto");
  const named = await checked_bytes("src/standalone-name-first.atto");
  const nested = await checked_bytes("src/standalone-nested-call.atto");
  assert.match(typed, /fnc twice\(int value\): int/u);
  assert.match(named, /fnc twice\(value: int\): int/u);
  assert.match(nested, /return twice\(plus_one\(20\)\);/u);
  for (const name of ["standalone-type-first-direct", "standalone-name-first-direct",
    "standalone-nested-direct"]) {
    const x = byId.get(name);
    assert.equal(x.expect, "PASS");
    assert.equal(x.expect_stdout, "42\n");
  }
  const overflow = await checked_bytes("src/standalone-overflow-callee.atto");
  const ignored = await checked_bytes("src/standalone-discarded-argument.atto");
  const unused = await checked_bytes("src/standalone-unused-local.atto");
  assert.match(overflow, /9223372036854775807/u);
  assert.match(ignored, /first\(42, 9223372036854775807 \+ 1\)/u);
  assert.match(unused, /val unused = value \+ 1;/u);
  assert.equal(corpus.cases.filter(c => c.expect === "PANIC").length, 3);
  for (const name of ["invalid-standalone-unbound.atto", "invalid-standalone-arity.atto",
    "invalid-standalone-untyped.atto"]) {
    const source = await checked_bytes("src/" + name);
    assert.match(source, /pub fnc main\(\): int/u);
  }
  for (const c of corpus.cases) assert.equal(c.status, "NOT_EXECUTED");
  for (const value of Object.values(corpus.backend_evidence))
    assert.match(value, /^NOT_EXECUTED/u);
  assert.match(corpus.syntax_profiles.package_import, /pkg/u);
});

test("canonical +, relative import, and nonlinear scalar call witnesses stay distinct", async () => {
  const rooted = await checked_bytes("src/main-root.atto");
  const relative = await checked_bytes("src/main-relative.atto");
  const nonlinear = await checked_bytes("src/main-nonlinear.atto");
  const helper = await checked_bytes("src/lib/helpers.atto");
  assert.match(rooted, /from "\+src\/lib\/helpers\.atto"/u);
  assert.match(relative, /from "\.\/lib\/helpers\.atto"/u);
  assert.match(nonlinear, /return twice\(21\);/u);
  assert.match(helper, /return value \+ value;/u);
  assert.match(helper, /pub fnc increment/u);
  assert.match(helper, /fnc private_helper/u);
  assert.doesNotMatch(helper, /pub fnc private_helper/u);
});

test("unsupported and authority-violating imports have distinct compile-negative sources", async () => {
  const rejected = [
    ["invalid-private-export.atto", /import private_helper/u],
    ["invalid-retired-root.atto", /from "\+\/src/u],
    ["invalid-root-traversal.atto", /from "\+src\/\.\.\/src/u],
    ["invalid-missing-export.atto", /import missing/u],
    ["invalid-duplicate-binding.atto", /import twice as increment/u]
  ];
  for (const [name, witness] of rejected) {
    const source = await checked_bytes("src/" + name);
    assert.match(source, witness, "negative fixture mutated: " + name);
  }
});

test("native candidate adapter denies accidental green on missing binary", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = resolve(here, "../bin/run-cranelift-modern-linked-module-v1.mjs");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: 10000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 125, "missing native compiler must be NOT_EXECUTED");
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.classification, "NOT_EXECUTED");
  assert.equal(receipt.certified, false);
  assert.deepEqual(receipt.case_results, []);
  assert.match(receipt.reason, /ATTO_CRANELIFT_BIN/);
});

test("native candidate adapter rejects a fabricated Cranelift guest success", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "atto-cranelift-fake-"));
  try {
    const fake = join(dir, "fake-orescranelift");
    await writeFile(fake, "#!/bin/sh\n# Fabricated CLI acceptance must not count as a guest.\nexit 0\n");
    await chmod(fake, 0o700);
    const script = resolve(here, "../bin/run-cranelift-modern-linked-module-v1.mjs");
    const processResult = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ATTO_CRANELIFT_BIN: fake },
      timeout: 15000
    });
    assert.equal(processResult.error, undefined);
    assert.equal(processResult.status, 1, "fabricated success became green");
    const receipt = JSON.parse(processResult.stdout);
    assert.equal(receipt.classification, "GUEST_EXECUTION_FAILED");
    assert.equal(receipt.certified, false);
    assert.deepEqual(receipt.case_results, []);
    assert.match(receipt.reason, /linked function|CLIF|checked IR|guest/u);
    assert.match(receipt.compiler_sha256, /^[0-9a-f]{64}$/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native candidate adapter rejects a fabricated Cranelift global rejection", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "atto-cranelift-fail-"));
  try {
    const fake = join(dir, "fake-orescranelift");
    await writeFile(fake, "#!/bin/sh\necho 'E_FAKE' >&2\nexit 1\n");
    await chmod(fake, 0o700);
    const script = resolve(here, "../bin/run-cranelift-modern-linked-module-v1.mjs");
    const processResult = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ATTO_CRANELIFT_BIN: fake },
      timeout: 15000
    });
    assert.equal(processResult.error, undefined);
    assert.equal(processResult.status, 1, "fabricated rejection became green");
    const receipt = JSON.parse(processResult.stdout);
    assert.equal(receipt.classification, "GUEST_EXECUTION_FAILED");
    assert.equal(receipt.certified, false);
    assert.deepEqual(receipt.case_results, []);
    assert.match(receipt.reason, /checked guest rejected|unexpected acceptance/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native candidate adapter never follows a symlink compiler binary", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "atto-cranelift-link-"));
  try {
    const fake = join(dir, "link-orescranelift");
    await symlink(process.execPath, fake);
    const script = resolve(here, "../bin/run-cranelift-modern-linked-module-v1.mjs");
    const processResult = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ATTO_CRANELIFT_BIN: fake },
      timeout: 15000
    });
    assert.equal(processResult.error, undefined);
    assert.equal(processResult.status, 1, "symlink compiler accepted");
    const receipt = JSON.parse(processResult.stdout);
    assert.equal(receipt.classification, "GUEST_EXECUTION_FAILED");
    assert.equal(receipt.certified, false);
    assert.match(receipt.reason, /non-symlink regular file/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
