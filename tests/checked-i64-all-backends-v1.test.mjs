import test from "node:test";
import assert from "node:assert/strict";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyCheckedI64AllBackends} from "../scripts/verify-checked-i64-all-backends-v1.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const subdir = "contracts/checked-i64-all-backends-v1";

function copyFixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "atto-checked-11-"));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const folder = join(root,subdir);
  mkdirSync(folder,{recursive:true});
  for (const file of ["cases.tsv","manifest.json"])
    copyFileSync(join(project,subdir,file),join(folder,file));
  const path = join(folder,"manifest.json");
  const cases = join(folder,"cases.tsv");
  return {root,folder,path,cases};
}
function mutateManifest(f, edit) {
  const value = JSON.parse(readFileSync(f.path,"utf8"));
  edit(value);
  writeFileSync(f.path,JSON.stringify(value,null,2)+"\n");
}

test("all eleven canonical backends and exact Java/JS arithmetic corpus pass source-only oracle", t => {
  const f = copyFixture(t);
  assert.deepEqual(verifyCheckedI64AllBackends(f.root), {
    sourceOnly:true,
    backendCount:11,
    caseCount:15,
    blob:"71309fac2ab6b2191a0056c84d78987bd342dce0"
  });
});
test("missing eleventh backend cannot silently pass as ten-backend parity", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.backend_snapshots.pop());
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /all eleven/);
});
test("duplicate or swapped Forge/Cranelift identities are rejected", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.backend_snapshots[2].repository =
    "atto-lang/atto-source.cranelift");
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /reordered or substituted/);
});
test("unreviewed compiler head cannot masquerade as an exact source snapshot", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.backend_snapshots[4].main_sha = "0".repeat(40));
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /reordered or substituted/);
});
test("zero-step/source-only registry cannot certify PASSED compiler execution", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => {
    data.backend_snapshots[4].execution_status = "PASSED";
    data.backend_snapshots[4].receipt = "self-attested";
  });
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /cannot claim executable parity/);
});
test("symlinked corpus rejected even when the linked bytes are identical", t => {
  const f = copyFixture(t), moved = join(f.folder,"renamed.tsv");
  renameSync(f.cases,moved);
  symlinkSync("renamed.tsv",f.cases);
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /symlinked conformance/);
});
test("one-byte source corpus mutation fails before any guest parity claim", t => {
  const f = copyFixture(t);
  writeFileSync(f.cases,readFileSync(f.cases,"utf8").replace("sum(0,0)","sum(0,1)"));
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /canonical checked-i64 corpus bytes/);
});
test("even rewritten manifest SHA cannot override the pinned corpus identity", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.corpus.git_blob_sha1 = "0".repeat(40));
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /canonical source corpus identity/);
});
test("duplicate JSON keys or textual drift fail closed", t => {
  const f = copyFixture(t);
  const text = readFileSync(f.path,"utf8");
  writeFileSync(f.path,text.replace(
    '  "status": "CANDIDATE_SOURCE_ONLY",',
    '  "status": "PASSED",\n  "status": "CANDIDATE_SOURCE_ONLY",'));
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /noncanonical or duplicate-key/);
});
test("missing actual source file never counts as conformance", t => {
  const f = copyFixture(t);
  rmSync(f.cases);
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /ENOENT/);
});
test("Wasm harness may not be silently rebranded as an independent compiler", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.backend_snapshots[10].role = "independent_compiler");
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /reordered or substituted/);
});
test("only a reviewed, specific spec PR may be cited as semantic authority", t => {
  const f = copyFixture(t);
  mutateManifest(f, data => data.specification = "https://github.com/atto-lang/atto-spec");
  assert.throws(() => verifyCheckedI64AllBackends(f.root), /wrong schema/);
});
