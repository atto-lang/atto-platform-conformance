import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {BACKENDS, RELATIVE_FIXTURE, EXACT_SOURCE, EXPECTED_GIT_BLOB,
  PRECEDENCE_RELATIVE_FIXTURE, PRECEDENCE_SOURCE, PRECEDENCE_GIT_BLOB,
  verifyFiveBackendScalarPairSourceIdentity} from "../src/five-backend-scalar.mjs";

async function workspaceFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), "ores-five-scalar-pair-"));
  try {
    for (const repo of BACKENDS) {
      for (const [path, bytes] of [[RELATIVE_FIXTURE, EXACT_SOURCE],
                                  [PRECEDENCE_RELATIVE_FIXTURE, PRECEDENCE_SOURCE]]) {
        const target = join(root, repo, path);
        await mkdir(dirname(target), {recursive: true});
        await writeFile(target, bytes);
      }
    }
    await callback(root);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test("all five backends require both canonical arithmetic fixtures", async () => {
  await workspaceFixture(async workspace => {
    const proof = await verifyFiveBackendScalarPairSourceIdentity(workspace);
    assert.equal(proof.status, "SOURCE_IDENTITY_ONLY_NOT_EXECUTION");
    assert.equal(proof.parityCertified, false);
    assert.equal(proof.executionVerified, false);
    assert.equal(proof.fixtureCount, 2);
    assert.equal(proof.backendCount, 5);
    assert.equal(proof.sourceFileCount, 10);
    assert.deepEqual(proof.fixtures.map(f => f.gitBlobSha),
      [EXPECTED_GIT_BLOB, PRECEDENCE_GIT_BLOB]);
    assert.ok(proof.fixtures.every(f => f.files.length === 5));
  });
});

test("one same-length precedence mutation invalidates all-five contract", async () => {
  await workspaceFixture(async workspace => {
    const path = join(workspace, BACKENDS[3], PRECEDENCE_RELATIVE_FIXTURE);
    const changed = Buffer.from(PRECEDENCE_SOURCE);
    changed[changed.indexOf("3")] = "4".charCodeAt(0);
    assert.equal(changed.length, PRECEDENCE_SOURCE.length);
    await writeFile(path, changed);
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(workspace),
      /precedence source mismatch/);
  });
});

test("one missing precedence fixture cannot be marked supported", async () => {
  await workspaceFixture(async workspace => {
    await rm(join(workspace, BACKENDS[2], PRECEDENCE_RELATIVE_FIXTURE));
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(workspace));
  });
});

test("swapped add and precedence are not equivalent even with five repositories", async () => {
  await workspaceFixture(async workspace => {
    const path = join(workspace, BACKENDS[0], PRECEDENCE_RELATIVE_FIXTURE);
    await writeFile(path, EXACT_SOURCE);
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(workspace));
  });
});

test("symlinked precedence leaf fails closed", {skip: process.platform === "win32"}, async () => {
  await workspaceFixture(async workspace => {
    const target = join(workspace, BACKENDS[4], PRECEDENCE_RELATIVE_FIXTURE);
    const hidden = target + ".real";
    const {rename} = await import("node:fs/promises");
    await rename(target, hidden);
    await symlink(hidden, target);
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(workspace));
  });
});

test("rejects absent backend directory even with both scalar fixtures elsewhere", async () => {
  await workspaceFixture(async workspace => {
    await rm(join(workspace, BACKENDS[4]), {recursive: true});
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(workspace));
  });
});

test("rejects malformed workspace rather than fabricating source-only success", async () => {
  for (const value of ["", "\0", null, 42]) {
    await assert.rejects(verifyFiveBackendScalarPairSourceIdentity(value));
  }
});
