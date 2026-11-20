import {spawnSync} from "node:child_process";
import {test} from "node:test";
import {strict as assert} from "node:assert";
import {cp, mkdtemp, readFile, writeFile, symlink, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyImplicitValInitializeFixtureManifest, readLimitedBytes} from "../src/implicit-val-initialize-manifest.mjs";

const fixtures = fileURLToPath(
  new URL("../fixtures/implicit-val-initialize/v1/", import.meta.url)
);

async function withFixtureCopy(check) {
  const dir = await mkdtemp(join(tmpdir(), "oreslang-implicit-val-manifest-"));
  try {
    await cp(fixtures, dir, {recursive: true});
    await check(dir);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

test("15 exact byte-pinned fixtures, zero runtime certification", async () => {
  const result = await verifyImplicitValInitializeFixtureManifest(fixtures);
  assert.deepEqual(result, {
    fixtureCount: 15,
    accepted: 8,
    rejected: 7,
    gitBlobIntegrity: "VERIFIED",
    backendProof: "NOT_EXECUTED",
  });
});

test("tampered fixture fails even though manifest claims acceptance", async () => {
  await withFixtureCopy(async (dir) => {
    const file = join(dir, "initialize-arrow-double-colon.ores");
    await writeFile(file, (await readFile(file, "utf8")) + "// modified\n");
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /Git blob SHA mismatch/
    );
  });
});

test("cannot invent compiler-backed evidence or backend confirmations", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.cases[0].confirmedBackends = ["java"];
    manifest.cases[0].pendingBackends = ["llvm", "net", "wasm", "forge"];
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /must not invent backend confirmations/
    );
  });
});

test("path traversal and duplicate fixture identities fail closed", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "manifest.json");
    const baseline = JSON.parse(await readFile(path, "utf8"));
    baseline.cases[0].file = "../other.ores";
    await writeFile(path, JSON.stringify(baseline));
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /invalid, duplicate, or unpinned/
    );
    const duplicate = JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8"));
    duplicate.cases[1] = {...duplicate.cases[0]};
    await writeFile(path, JSON.stringify(duplicate));
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /invalid, duplicate, or unpinned/
    );
  });
});

test("symlink replacement never follows the fixture", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "initialize-colon-braces.ores");
    await rm(path);
    await symlink(join(fixtures, "initialize-colon-braces.ores"), path);
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /fixture must be a regular file/
    );
  });
});

test("manifest symlinks fail closed before JSON is parsed", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "manifest.json");
    await rm(path);
    await symlink(join(fixtures, "manifest.json"), path);
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /manifest must be a regular file/
    );
  });
});

test("oversized fixture is rejected before a SHA is accepted", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "initialize-colon-braces.ores");
    await writeFile(path, Buffer.alloc(33 * 1024));
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /fixture must be a regular file no larger than 32768 bytes/
    );
  });
});

test("Cranelift is a distinct required backend, never an alias of Forge", async () => {
  await withFixtureCopy(async (dir) => {
    const path = join(dir, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.cases[0].pendingBackends = ["java", "llvm", "wasm", "net", "forge"];
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(
      verifyImplicitValInitializeFixtureManifest(dir),
      /must not invent backend confirmations/
    );
  });
});


test("FIFO input rejects promptly without waiting for a writer", {skip: process.platform === "win32"}, async () => {
  await withFixtureCopy(async dir => {
    await rm(join(dir, "manifest.json"));
    const fifo = spawnSync("mkfifo", [join(dir, "manifest.json")], {timeout: 2000});
    assert.equal(fifo.status, 0);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/verify-implicit-val-initialize.mjs", import.meta.url)), dir], {timeout: 2000, encoding: "utf8"});
    assert.equal(child.error, undefined, "reader must reject before timeout");
    assert.equal(child.status, 1);
    assert.match(child.stderr, /must be a regular file/);
  });
});

test("a growing descriptor is capped at limit plus one, including short reads", async () => {
  let total = 0, calls = 0;
  const growing = {async read(buffer, offset, length) {
    calls++;
    const count = Math.min(3, length);
    buffer.fill(65, offset, offset + count);
    total += count;
    return {bytesRead: count};
  }};
  await assert.rejects(readLimitedBytes(growing, 8, "fixture"), /exceeded the size limit/);
  assert.equal(total, 9);
  assert.equal(calls, 3);
});
