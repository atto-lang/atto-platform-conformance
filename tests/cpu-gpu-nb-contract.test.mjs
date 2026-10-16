import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir,lstat} from "node:fs/promises";

const root = new URL("../fixtures/cpu-gpu-v1/", import.meta.url);
const requiredIds = [
  "cpu-value", "gpu-value", "nb-cpu-unary", "nb-gpu-unary",
  "gpu-cpu-gpu-nested", "gpu-empty-reject",
  "nb-not-stream", "gpu-no-implicit-download"
].sort();
const fiveBackends = ["forge","java","llvm","net","wasm"];

test("CPU/GPU/nb registry exhaustively pins eight real source fixtures", async () => {
  const metadata = JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
  assert.equal(metadata.schemaVersion,1);
  assert.equal(metadata.contract,"cpu-gpu-nb-v1");
  assert.equal(metadata.kind,"normative-target-corpus-not-execution-evidence");
  assert.deepEqual([...metadata.backends].sort(),fiveBackends);
  assert.deepEqual(metadata.cases.map(c=>c.id).sort(),requiredIds);
  const filenames=(await readdir(root)).sort();
  assert.deepEqual(filenames,
    [...requiredIds.map(id=>id+".ores"),"manifest.json"].sort(),
    "no unregistered or absent source fixtures");
  const files=new Set();
  for(const c of metadata.cases){
    assert.match(c.id,/^[a-z0-9-]+$/);
    assert.equal(c.file,c.id+".ores");
    assert.ok(!files.has(c.file),"duplicate source registration");
    files.add(c.file);
    assert.ok(["accept_when_lowered","reject_always"].includes(c.outcome));
    assert.equal(c.evidence,"not_verified","do not pretend contract fixtures executed");
    assert.equal(typeof c.expectedTypeOrDiagnostic,"string");
    assert.ok(c.expectedTypeOrDiagnostic.length>0);
    const url=new URL(c.file,root);
    const fileStat=await lstat(url);
    assert.ok(fileStat.isFile() && !fileStat.isSymbolicLink(),"regular exact source only");
    const source=await readFile(url,"utf8");
    assert.ok(source.length>30 && source.endsWith("\n"),"no empty or partial fixtures");
    assert.match(source,/\b(cpu|gpu)\s*\{/,"real region token must be present");
    if(c.id.startsWith("nb-"))assert.match(source,/\bnb\s+(cpu|gpu)\s*\{/);
  }
});

test("single-completion futures, nested graph and no implicit transfer have explicit contracts", async () => {
  const metadata=JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
  const byId=Object.fromEntries(metadata.cases.map(c=>[c.id,c]));
  assert.equal(byId["nb-cpu-unary"].expectedTypeOrDiagnostic,"Future<int>");
  assert.equal(byId["nb-gpu-unary"].expectedTypeOrDiagnostic,"Future<GpuBuffer<f32>>");
  assert.equal(byId["nb-not-stream"].outcome,"reject_always");
  assert.equal(byId["nb-not-stream"].expectedTypeOrDiagnostic,"future_not_stream");
  assert.equal(byId["gpu-empty-reject"].outcome,"reject_always");
  assert.equal(byId["gpu-no-implicit-download"].expectedTypeOrDiagnostic,"residency_mismatch");
  const nested=await readFile(new URL(byId["gpu-cpu-gpu-nested"].file,root),"utf8");
  assert.match(nested,/gpu\s*\{[\s\S]+cpu\s*\{[\s\S]+Gpu\.download[\s\S]+Gpu\.upload/);
  // This suite certifies fixture completeness and desired semantics only.
  // Backend compiler executions must be added separately, with pinned SHA,
  // a passing baseline, typed diagnostics and no artifact on rejection.
});
