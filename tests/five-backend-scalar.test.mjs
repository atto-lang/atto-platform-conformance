import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {BACKENDS, EXACT_SOURCE, RELATIVE_FIXTURE, EXPECTED_GIT_BLOB,
  verifyFiveBackendSourceIdentity} from "../src/five-backend-scalar.mjs";

async function fixtureSpace(callback) {
  const root = await mkdtemp(join(tmpdir(), "five-oreslang-parity-"));
  try {
    for (const repo of BACKENDS) {
      const path = join(root, repo, RELATIVE_FIXTURE);
      await mkdir(dirname(path), {recursive:true});
      await writeFile(path, EXACT_SOURCE);
    }
    await callback(root);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
}

test("requires all five identical Java/LLVM/.net/.wasm/.forge fixtures", async () => {
  await fixtureSpace(async workspace => {
    const proof = await verifyFiveBackendSourceIdentity(workspace);
    assert.equal(proof.fixtureCount, 5);
    assert.equal(proof.executionVerified, false);
    assert.equal(proof.status, "SOURCE_IDENTITY_ONLY_NOT_EXECUTION");
    assert.deepEqual(proof.files.map(x=>x.repository), [...BACKENDS]);
    assert.ok(proof.files.every(x => x.gitBlobSha === EXPECTED_GIT_BLOB));
  });
});
test("rejects one changed semantic source", async () => {
  await fixtureSpace(async workspace => {
    await writeFile(join(workspace, BACKENDS[3], RELATIVE_FIXTURE),
      Buffer.from("pub fnc main(): int { return 41 + 2; }\n"));
    await assert.rejects(verifyFiveBackendSourceIdentity(workspace),
      /scalar fixture size|scalar source mismatch/);
  });
});
test("rejects missing source even if four other backends match", async () => {
  await fixtureSpace(async workspace => {
    await rm(join(workspace, BACKENDS[4], RELATIVE_FIXTURE));
    await assert.rejects(verifyFiveBackendSourceIdentity(workspace));
  });
});
test("rejects symlinked leaf fixture paths even with correct source bytes", {
  skip: process.platform === "win32"
}, async () => {
  await fixtureSpace(async workspace => {
    const path = join(workspace, BACKENDS[2], RELATIVE_FIXTURE);
    const hidden = path + ".real";
    const {rename} = await import("node:fs/promises");
    await rename(path, hidden);
    await symlink(hidden, path, "file");
    await assert.rejects(verifyFiveBackendSourceIdentity(workspace), /ELOOP|symbolic link|symlink|fixture path escaped the expected physical checkout/i);
  });
});
test("rejects symlinked fixture directories", {skip:process.platform==="win32"}, async () => {
  await fixtureSpace(async workspace => {
    const real = join(workspace, BACKENDS[0], "contracts/v1/semantics/fixtures");
    const renamed = real + "-real";
    const {rename} = await import("node:fs/promises");
    await rename(real, renamed);
    await symlink(renamed, real, "dir");
    await assert.rejects(verifyFiveBackendSourceIdentity(workspace), /unsafe fixture directory/);
  });
});
