import test from "node:test";
import assert from "node:assert/strict";
import {readFile, lstat} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, resolve, sep} from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/import-v1");
const rootPath = resolve(root, "project");
const backendNames = ["java", "llvm", "net", "forge", "wasm"];

async function fixture(relative) {
  assert.match(relative, /^project\/[a-zA-Z0-9_./-]+\.ores$/);
  assert.ok(!relative.split("/").some(segment => segment === "." || segment === ".." || !segment));
  const file = resolve(root, relative);
  assert.ok(file.startsWith(rootPath + sep), "fixture must remain under project/");
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), "fixtures must be regular source files");
  return readFile(file, "utf8");
}

test("import v1 corpus covers five targets but never claims runtime verification", async () => {
  const inventory = JSON.parse(await readFile(resolve(root, "cases.json"), "utf8"));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.status, "CORPUS_ONLY_NOT_BACKEND_EXECUTION");
  assert.equal(inventory.provenance, "NONE");
  assert.deepEqual(inventory.evidence, []);
  assert.deepEqual(Object.keys(inventory.backends).sort(), backendNames.sort());
  assert.ok(Object.values(inventory.backends).every(status =>
    !/^(verified|complete|parity)$/i.test(status)));
  assert.deepEqual(inventory.cases.map(({id}) => id), [
    "project-root-function", "relative-function", "rooted-parent-rejection"
  ]);
  assert.deepEqual(inventory.cases.map(({expect}) => expect),
    ["return-42", "return-42", "reject"]);
  for (const entry of inventory.cases) await fixture(entry.entry);
});

test("two positive entrypoints share one package-local function", async () => {
  const manifest = await readFile(resolve(rootPath, ".ores.pkg.toml"), "utf8");
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
