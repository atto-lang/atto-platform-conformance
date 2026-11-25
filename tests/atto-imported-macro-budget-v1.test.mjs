import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyAttoImportedMacroBudgetV1} from "../scripts/verify-atto-imported-macro-budget-v1.mjs";
const source = new URL("../contracts/atto-source-v1/imported-macro-budget-v1.json", import.meta.url);
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "atto-macro-quota-"));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const file = join(dir, "contract.json");
  writeFileSync(file, readFileSync(source, "utf8"));
  return file;
}
function mutate(t, fn) {
  const file = scratch(t);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  fn(doc);
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  return file;
}
test("canonical 128/129 imported macro ceiling is source-only for all five backends", () => {
  assert.deepEqual(verifyAttoImportedMacroBudgetV1(),
    {backends:5, cases:2, maxExpansions:128, sourceOnly:true, guestsExecuted:0});
});
test("129 expansions cannot be mislabeled executable success", t => {
  const file = mutate(t, doc => doc.cases[1].expected = "COMPILE_AND_EXECUTE");
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("no generated IR guarantee cannot be silently relaxed", t => {
  const file = mutate(t, doc => doc.cases[1].emitted_ir_bytes = 42);
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("macro quota cannot silently drift to 1024", t => {
  const file = mutate(t, doc => doc.max_expansions = 1024);
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("all five backend slots remain required and unexecuted", t => {
  const file = mutate(t, doc => doc.backend_states[1].evidence = "PASSED");
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("removing one backend cannot claim five-backend parity", t => {
  const file = mutate(t, doc => doc.backend_states.pop());
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("canonical .atto syntax cannot downgrade to legacy .ores", t => {
  const file = mutate(t, doc => doc.import_statement = doc.import_statement.replace(".atto", ".ores"));
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /contract\/budget\/evidence/);
});
test("duplicate JSON keys are rejected before they can override the evidence status", t => {
  const file = scratch(t);
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, raw.replace('"source_only": true,',
    '"source_only": false,\n  "source_only": true,'));
  assert.throws(() => verifyAttoImportedMacroBudgetV1(file), /noncanonical or duplicate/);
});
test("manifest symlinks are denied", t => {
  const target = scratch(t);
  const link = target + ".link";
  symlinkSync(target, link);
  assert.throws(() => verifyAttoImportedMacroBudgetV1(link), /symlinked/);
});
