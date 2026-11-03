import test from "node:test";
import assert from "node:assert/strict";
import {copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
        renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyAttoSourceV1} from "../scripts/verify-atto-source-v1.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = "contracts/atto-source-v1";
const folder = join(root, rel);

function temporaryCorpus(t) {
  const dir = mkdtempSync(join(tmpdir(), "atto-source-v1-"));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const dest = join(dir, rel);
  mkdirSync(dest, {recursive:true});
  copyFileSync(join(folder, "add.atto"), join(dest, "add.atto"));
  copyFileSync(join(folder, "contract.json"), join(dest, "contract.json"));
  return {dir, dest, source:join(dest, "add.atto"), manifest:join(dest, "contract.json")};
}

test("canonical shared AttoLang source and five required backend slots pass identity", t => {
  const {dir} = temporaryCorpus(t);
  assert.deepEqual(verifyAttoSourceV1(dir), {
    blob:"015f8b0f79aafa796a148d2adeff1574e8d6c491",
    backendCount:5, sourceOnly:true
  });
});

test("one-byte source mutation cannot pass a hash-only parity claim", t => {
  const f = temporaryCorpus(t);
  writeFileSync(f.source, readFileSync(f.source,"utf8").replace("40 + 2","40 + 3"));
  assert.throws(() => verifyAttoSourceV1(f.dir), /canonical Atto source bytes/);
});

test("missing .atto guest is never reported as executed source", t => {
  const f = temporaryCorpus(t);
  rmSync(f.source);
  assert.throws(() => verifyAttoSourceV1(f.dir), /ENOENT/);
});

test("canonical .atto symlink is rejected even with identical target bytes", t => {
  const f = temporaryCorpus(t);
  const moved = join(f.dest, "real.atto");
  renameSync(f.source, moved);
  symlinkSync("real.atto", f.source);
  assert.throws(() => verifyAttoSourceV1(f.dir), /symlinked Atto source contract/);
});

test("symlinked source directory is rejected before reading the manifest", t => {
  const f = temporaryCorpus(t);
  const moved = join(f.dir, "real-fixtures");
  renameSync(f.dest, moved);
  symlinkSync(moved, f.dest, "dir");
  assert.throws(() => verifyAttoSourceV1(f.dir), /symlinked Atto source contract/);
});

test("duplicate manifest keys cannot override reviewed schema or source identity", t => {
  const f = temporaryCorpus(t);
  const json = readFileSync(f.manifest,"utf8");
  writeFileSync(f.manifest, json.replace(
    '  "schema": "attolang.source-parity.v1",',
    '  "schema": "not-the-contract",\n  "schema": "attolang.source-parity.v1",'));
  assert.throws(() => verifyAttoSourceV1(f.dir), /noncanonical or duplicate-key/);
});

test("removing the Forge backend cannot be disguised as five-backend parity", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.backends.pop();
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /five backend entries/);
});

test("backend source-path substitution cannot silently select legacy .ores", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.backends[2].fixture_path = "contracts/atto-parity-v1/add.ores";
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /noncanonical backend identity/);
});

test("source-only metadata cannot claim executed compiler or guest receipts", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.promotion.source_only_not_execution = false;
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /source-only versus execution/);
});

test("manifest symlinks and foreign source extensions are rejected", t => {
  const f = temporaryCorpus(t);
  renameSync(f.manifest,join(f.dest,"actual.json"));
  symlinkSync("actual.json", f.manifest);
  assert.throws(() => verifyAttoSourceV1(f.dir), /symlinked Atto source contract/);
  rmSync(f.manifest);
  renameSync(join(f.dest,"actual.json"), f.manifest);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.source.path = "contracts/atto-source-v1/add.ores";
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /canonical .atto fixture identity/);
});

test("Forge is a separate compiler route, not Cranelift or Wasmtime", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.backends[4].repository = "ores-truffle-oreslang/oreslang-source.cranelift";
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /noncanonical backend identity/);
});

test("Forge cannot borrow another backend's path, identity or PR", t => {
  const f = temporaryCorpus(t);
  const original = JSON.parse(readFileSync(f.manifest,"utf8"));
  for (const changed of [
    {id:"llvm"},
    {fixture_path:"contracts/atto-parity-v1/add.ores"},
    {pr:171},
    {repository:"ores-truffle-oreslang/oreslang-source.wasm"}
  ]) {
    const manifest = structuredClone(original);
    Object.assign(manifest.backends[4], changed);
    writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
    assert.throws(() => verifyAttoSourceV1(f.dir), /noncanonical backend identity/);
  }
});

test("PR substitutions in older backend slots are rejected", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.backends[0].pr = 2459;
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /noncanonical backend identity/);
});

test("Forge cannot be omitted while retaining the earlier four backends", t => {
  const f = temporaryCorpus(t);
  const manifest = JSON.parse(readFileSync(f.manifest,"utf8"));
  manifest.backends.pop();
  writeFileSync(f.manifest, JSON.stringify(manifest,null,2)+"\n");
  assert.throws(() => verifyAttoSourceV1(f.dir), /five backend entries/);
});
