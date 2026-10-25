import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm, symlink, link} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,basename} from "node:path";
import {BACKENDS, EXACT_SOURCE, RELATIVE_FIXTURE, verifyFiveBackendSourceIdentity} from "../src/five-backend-scalar.mjs";

async function withFixtures(check) {
  const root = await mkdtemp(join(tmpdir(), "ores-scalar-hardening-"));
  try {
    for (const name of BACKENDS) {
      const file = join(root, name, RELATIVE_FIXTURE);
      await mkdir(dirname(file), {recursive:true});
      await writeFile(file, EXACT_SOURCE);
    }
    await check(root);
  } finally { await rm(root, {recursive:true, force:true}); }
}

test("rejects workspace aliases rather than reading through them",
  {skip:process.platform==="win32"}, async () => {
  await withFixtures(async root => {
    const alias = root + "-alias";
    try {
      await symlink(root, alias, "dir");
      await assert.rejects(verifyFiveBackendSourceIdentity(alias), /physical directory, not a symlink/);
    } finally { await rm(alias, {force:true}); }
  });
});

test("rejects source files with more than one filesystem link",
  {skip:process.platform==="win32"}, async () => {
  await withFixtures(async root => {
    const fixture = join(root, BACKENDS[0], RELATIVE_FIXTURE);
    await link(fixture, fixture+".alternate");
    await assert.rejects(verifyFiveBackendSourceIdentity(root), /invalid scalar fixture size\/type/);
  });
});

test("allows stable operating-system ancestor alias, not source-tree alias", {
  skip: process.platform === "win32"
}, async () => {
  await withFixtures(async root => {
    const parentAlias = root + "-parent-alias";
    try {
      await symlink(dirname(root), parentAlias, "dir");
      const proof = await verifyFiveBackendSourceIdentity(join(parentAlias,basename(root)));
      assert.equal(proof.fixtureCount, 5);
      assert.equal(proof.executionVerified, false);
    } finally {
      await rm(parentAlias, {force:true});
    }
  });
});
