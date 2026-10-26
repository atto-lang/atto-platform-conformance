import test from "node:test";
import assert from "node:assert/strict";
import {lstat, open, mkdtemp, mkdir, writeFile, symlink, rm} from "node:fs/promises";
import {constants} from "node:fs";
import {createHash} from "node:crypto";
import {TextDecoder} from "node:util";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname, resolve, join} from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/import-v1");
const rootPath = resolve(root, "project");
const backendNames = ["java", "llvm", "net", "forge", "wasm"];

const MAX_BYTES = 1_048_576;
// Independent, immutable Git object fingerprints. Updating a fixture requires
// a reviewed update to BOTH the inventory and this source integrity gate.
const PINNED_BLOBS = {
  "project/.ores.pkg.toml": "5a9014b446640775cd2284a1f395354900efbd17",
  "project/src/lib/helper.ores": "3dab45b6139aaf47107de2ca2cf5257e6521b946",
  "project/src/main-plus.ores": "ee07b74614ad88c5419e1e55322784f541833369",
  "project/src/main-relative.ores": "29febca8d2298724f962f6cfdc1f1881e988cd2e",
  "project/src/invalid-root-traversal.ores": "5e6f41674730a965c07892b64c2c14b836055714",
  "project/src/main-cr-comment.ores": "9e264f5c1dd3c1c191d5bb69f2c63da520c20906",
  "project/src/invalid-cr-root-traversal.ores": "50e7e5117e0cd63e48ef416fb9a4ead98bcb0685"
};
const gitBlob = bytes => createHash("sha1")
  .update("blob " + bytes.length + "\0").update(bytes).digest("hex");

// Corpus admission check, not a race-free untrusted-filesystem sandbox.
// Each existing path component must be an actual directory (no symlinks),
// and the leaf must be a bounded regular file whose raw bytes match the
// pinned Git object before any tolerant text parsing or regex checks.
async function readCorpusText(relative, {base=root, expectedSha} = {}) {
  assert.ok(typeof relative === "string" &&
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(relative) &&
    relative.length <= 512 &&
    relative.split("/").every(x => x !== "." && x !== ".."),
    "invalid corpus relative path");
  const initial = await lstat(base);
  assert.ok(initial.isDirectory() && !initial.isSymbolicLink(), "unsafe corpus root directory");
  const components = relative.split("/");
  let current = base, leafInfo;
  for (let index = 0; index < components.length; index++) {
    current = join(current, components[index]);
    const info = await lstat(current);
    assert.ok(!info.isSymbolicLink(), "symlink in corpus path");
    if (index + 1 < components.length) {
      assert.ok(info.isDirectory(), "non-directory corpus path component");
    } else {
      assert.ok(info.isFile(), "corpus source must be a regular file");
      leafInfo = info;
    }
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  const handle = await open(current, flags);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.dev === leafInfo.dev &&
      before.ino === leafInfo.ino &&
      Number.isSafeInteger(before.size) && before.size <= MAX_BYTES,
      "oversized or changed corpus source");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert.ok(bytesRead > 0, "truncated corpus source");
      offset += bytesRead;
    }
    const {bytesRead: extra} = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
    assert.equal(extra, 0, "corpus source expanded during snapshot");
    const after = await handle.stat();
    assert.ok(after.isFile() && before.size === after.size &&
      before.dev === after.dev && before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      "corpus source changed during snapshot");
    if (expectedSha !== undefined) {
      assert.match(expectedSha, /^[0-9a-f]{40}$/);
      assert.equal(gitBlob(bytes), expectedSha, "pinned corpus Git blob mismatch");
    }
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } finally {
    await handle.close();
  }
}

async function fixture(relative) {
  assert.ok(relative.startsWith("project/") && relative.endsWith(".ores"));
  assert.ok(Object.hasOwn(PINNED_BLOBS, relative), "unknown fixture source");
  return readCorpusText(relative, {expectedSha: PINNED_BLOBS[relative]});
}

test("import v1 corpus covers five targets but never claims runtime verification", async () => {
  const inventory = JSON.parse(await readCorpusText("cases.json"));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.status, "CORPUS_ONLY_NOT_BACKEND_EXECUTION");
  assert.equal(inventory.provenance, "NONE");
  assert.deepEqual(inventory.evidence, []);
  assert.deepEqual(Object.keys(inventory.backends).sort(), backendNames.sort());
  assert.ok(Object.values(inventory.backends).every(status =>
    !/^(verified|complete|parity)$/i.test(status)));
  assert.deepEqual(inventory.cases.map(({id}) => id), [
    "project-root-function", "relative-function", "rooted-parent-rejection",
    "cr-comment-relative-function", "cr-comment-rooted-parent-rejection"
  ]);
  assert.deepEqual(inventory.cases.map(({expect}) => expect),
    ["return-42", "return-42", "reject", "return-42", "reject"]);
  assert.deepEqual(inventory.supportBlobs, {
    "project/.ores.pkg.toml": PINNED_BLOBS["project/.ores.pkg.toml"],
    "project/src/lib/helper.ores": PINNED_BLOBS["project/src/lib/helper.ores"]
  });
  const expectedPaths = Object.keys(PINNED_BLOBS)
    .filter(name => name.endsWith(".ores") && name !== "project/src/lib/helper.ores");
  assert.deepEqual(inventory.cases.map(entry => entry.entry).sort(), expectedPaths.sort());
  for (const entry of inventory.cases) {
    assert.equal(entry.gitBlobSha, PINNED_BLOBS[entry.entry],
      "inventory must bind exact source Git blobs");
    await fixture(entry.entry);
  }
});

test("two positive entrypoints share one package-local function", async () => {
  const manifest = await readCorpusText("project/.ores.pkg.toml",
    {expectedSha: PINNED_BLOBS["project/.ores.pkg.toml"]});
  assert.match(manifest, /^schema_version = "1"/);
  const plus = await fixture("project/src/main-plus.ores");
  const relative = await fixture("project/src/main-relative.ores");
  const helper = await fixture("project/src/lib/helper.ores");
  assert.match(plus, /import fnc helper from "\+\/src\/lib\/helper";/);
  assert.match(relative, /import fnc helper from "\.\/lib\/helper";/);
  for (const src of [plus, relative]) assert.match(src, /return helper\(41\);/);
  assert.match(helper, /pub fnc helper\(int value\): int/);
  assert.match(helper, /return value \+ 1;/);
});

test("negative fixture encodes normalization-within-root traversal", async () => {
  const invalid = await fixture("project/src/invalid-root-traversal.ores");
  assert.match(invalid, /"\+\/src\/\.\.\/src\/lib\/helper"/);
});


test("CR-only line comment cannot hide a canonical import or traversal rejection", async () => {
  const positives = await fixture("project/src/main-cr-comment.ores");
  const negative = await fixture("project/src/invalid-cr-root-traversal.ores");
  for (const [name, source] of [["positive", positives], ["negative", negative]]) {
    assert.match(source, /^\/\/[^\r\n]+\rimport fnc helper from "/,
      name + ": the import must start on the second logical line");
    assert.equal(source.includes("\n"), false,
      name + ": fixture must use CR-only line endings, not normalize to LF");
    assert.ok(source.includes("\rfnc main(): int"),
      name + ": main must follow the import on another CR-only line");
  }
  assert.match(positives, /import fnc helper from "\.\/lib\/helper";/);
  assert.match(positives, /return helper\(41\);/);
  assert.match(negative, /import fnc helper from "\+\/src\/\.\.\/src\/lib\/helper";/);
});


test("corpus admission rejects path escape, symlink ancestor/leaf and modified bytes", async () => {
  const base = await mkdtemp(join(tmpdir(), "oreslang-corpus-audit-"));
  try {
    await mkdir(join(base, "project", "src"), {recursive: true});
    await writeFile(join(base, "project", "src", "okay.ores"), "ok\n");
    const pinned = gitBlob(Buffer.from("ok\n"));
    assert.equal(await readCorpusText("project/src/okay.ores", {base, expectedSha: pinned}),
      "ok\n");
    for (const path of [
      "../outside.ores", "/project/src/okay.ores", "project//src/okay.ores",
      "project/src/../src/okay.ores", "project\\src\\okay.ores",
      "project/./src/okay.ores"
    ]) {
      await assert.rejects(() => readCorpusText(path, {base}), /invalid corpus relative path/);
    }
    await writeFile(join(base, "project", "src", "okay.ores"), "tampered\n");
    await assert.rejects(
      () => readCorpusText("project/src/okay.ores", {base, expectedSha: pinned}),
      /pinned corpus Git blob mismatch/);
    await mkdir(join(base, "elsewhere"));
    await writeFile(join(base, "elsewhere", "source.ores"), "external\n");
    await symlink(join(base, "elsewhere"), join(base, "project", "src", "alias"));
    await assert.rejects(() => readCorpusText("project/src/alias/source.ores", {base}),
      /symlink in corpus path/);
    await symlink(join(base, "elsewhere", "source.ores"),
      join(base, "project", "src", "alias.ores"));
    await assert.rejects(() => readCorpusText("project/src/alias.ores", {base}),
      /symlink in corpus path/);
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test("corpus input budget and UTF-8 checks apply before interpreting source", async () => {
  const base = await mkdtemp(join(tmpdir(), "oreslang-corpus-bytes-"));
  try {
    await mkdir(join(base, "project"), {recursive: true});
    const path = join(base, "project", "large.ores");
    await writeFile(path, Buffer.alloc(MAX_BYTES + 1, 65));
    await assert.rejects(() => readCorpusText("project/large.ores", {base}),
      /oversized or changed corpus source/);
    await writeFile(path, Buffer.from([0xc0, 0xaf]));
    await assert.rejects(() => readCorpusText("project/large.ores", {base}),
      /valid|utf-8/i);
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});
