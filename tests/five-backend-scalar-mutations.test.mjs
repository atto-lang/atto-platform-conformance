import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {BACKENDS, EXACT_SOURCE, RELATIVE_FIXTURE,
  verifyFiveBackendSourceIdentity} from "../src/five-backend-scalar.mjs";

test("fail closed for every byte changed in each of five source fixtures", {
  timeout: 15000
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ores-parity-mutations-"));
  try {
    for (const backend of BACKENDS) {
      const path = join(workspace, backend, RELATIVE_FIXTURE);
      await mkdir(dirname(path), {recursive:true});
      await writeFile(path, EXACT_SOURCE);
    }
    assert.equal((await verifyFiveBackendSourceIdentity(workspace)).fixtureCount, 5);
    let cases = 0;
    for (const backend of BACKENDS) {
      const path = join(workspace, backend, RELATIVE_FIXTURE);
      for (let offset = 0; offset < EXACT_SOURCE.length; offset++) {
        const bad = Buffer.from(EXACT_SOURCE);
        bad[offset] ^= 1;
        await writeFile(path, bad);
        await assert.rejects(verifyFiveBackendSourceIdentity(workspace),
          /five-backend scalar source mismatch/, `${backend} mutation at byte ${offset}`);
        await writeFile(path, EXACT_SOURCE);
        cases++;
      }
    }
    assert.equal(cases, BACKENDS.length * EXACT_SOURCE.length);
    assert.equal((await verifyFiveBackendSourceIdentity(workspace)).executionVerified, false);
  } finally {
    await rm(workspace, {recursive:true, force:true});
  }
});
