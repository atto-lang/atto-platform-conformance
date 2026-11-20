import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {BACKENDS, EXACT_SOURCE, RELATIVE_FIXTURE,
  verifyFiveBackendSourceIdentity} from "../src/five-backend-scalar.mjs";

async function withSourceWorkspace(check) {
  const root = await mkdtemp(join(tmpdir(), "ores-parity-special-files-"));
  try {
    for (const repo of BACKENDS) {
      const path = join(root, repo, RELATIVE_FIXTURE);
      await mkdir(dirname(path), {recursive:true});
      await writeFile(path, EXACT_SOURCE);
    }
    await check(root);
  } finally {
    await rm(root, {recursive:true, force:true});
  }
}

test("rejects named pipe fixture without blocking on read", {
  skip: process.platform === "win32", timeout: 3000
}, async () => {
  await withSourceWorkspace(async root => {
    const path = join(root, BACKENDS[1], RELATIVE_FIXTURE);
    await rm(path);
    const result = spawnSync("mkfifo", [path], {encoding:"utf8", timeout:2000});
    assert.equal(result.status, 0, `mkfifo failed: ${result.stderr || result.error}`);
    await assert.rejects(verifyFiveBackendSourceIdentity(root),
      /fixture must be an ordinary regular file/);
  });
});

test("rejects directory at the expected fixture file path", async () => {
  await withSourceWorkspace(async root => {
    const path = join(root, BACKENDS[2], RELATIVE_FIXTURE);
    await rm(path);
    await mkdir(path);
    await assert.rejects(verifyFiveBackendSourceIdentity(root),
      /fixture must be an ordinary regular file/);
  });
});
