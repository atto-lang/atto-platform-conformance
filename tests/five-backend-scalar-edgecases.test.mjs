import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, rename, symlink, link} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {BACKENDS, EXACT_SOURCE, RELATIVE_FIXTURE,
  verifyFiveBackendSourceIdentity} from "../src/five-backend-scalar.mjs";

async function withFixtures(check) {
  const root = await mkdtemp(join(tmpdir(), "ores-scalar-adversarial-"));
  try {
    for (const backend of BACKENDS) {
      const target = join(root, backend, RELATIVE_FIXTURE);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, EXACT_SOURCE);
    }
    await check(root);
  } finally { await rm(root, {recursive:true, force:true}); }
}

test("malformed workspace arguments fail closed instead of using the cwd", async () => {
  for (const path of [undefined, null, "", "\0", "./\0here", 0, {}, []]) {
    await assert.rejects(verifyFiveBackendSourceIdentity(path), /workspace must be/);
  }
});

test("rejects a directory at the leaf instead of reading a fixture", async () => {
  await withFixtures(async root => {
    const leaf = join(root, BACKENDS[0], RELATIVE_FIXTURE);
    await rm(leaf);
    await mkdir(leaf);
    await assert.rejects(verifyFiveBackendSourceIdentity(root),
      /ordinary regular file|invalid scalar fixture size\/type|EISDIR/);
  });
});

test("rejects an atomic replacement with different source bytes", async () => {
  await withFixtures(async root => {
    const leaf = join(root, BACKENDS[1], RELATIVE_FIXTURE);
    const replacement = leaf + ".new";
    await writeFile(replacement, Buffer.from("pub fnc main(): int { return 41 + 2; }\n"));
    await rename(replacement, leaf);
    await assert.rejects(verifyFiveBackendSourceIdentity(root),
      /source mismatch|size\/type|fixture replaced/);
  });
});

test("rejects a directory replaced by a symlink to the original", {
  skip: process.platform === "win32"
}, async () => {
  await withFixtures(async root => {
    const dir = join(root, BACKENDS[0], "contracts/v1/semantics/fixtures");
    await rename(dir, dir + ".old");
    await symlink(dir + ".old", dir, "dir");
    await assert.rejects(verifyFiveBackendSourceIdentity(root), /unsafe fixture directory/);
  });
});

test("rejects a same-byte replacement with a hardlink alias", {
  skip: process.platform === "win32"
}, async () => {
  await withFixtures(async root => {
    const leaf = join(root, BACKENDS[0], RELATIVE_FIXTURE);
    const replacement = leaf + ".new";
    await writeFile(replacement, EXACT_SOURCE);
    await link(replacement, replacement + ".alias");
    await rename(replacement, leaf);
    await assert.rejects(verifyFiveBackendSourceIdentity(root), /invalid scalar fixture size\/type/);
  });
});
