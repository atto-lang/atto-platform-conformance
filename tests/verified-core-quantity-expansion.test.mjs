import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { expandQuantityCases } from "../lib/verified-core-quantity-expansion.mjs";

const original = fileURLToPath(new URL("../fixtures/verified-core-quantities-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(original, "cases.json"), "utf8"));

test("expanded corpus is complete, deterministic and isolated from input files", () => {
  const work1 = mkdtempSync(join(tmpdir(), "verified-quantities-"));
  const work2 = mkdtempSync(join(tmpdir(), "verified-quantities-"));
  try {
    const a = expandQuantityCases(original, work1, manifest);
    const b = expandQuantityCases(original, work2, manifest);
    assert.equal(a.cases.length, 119);
    assert.deepEqual(a.cases, b.cases);
    assert.equal(new Set(a.cases.map(x => x.source)).size, 119);
    assert.equal(a.cases.filter(x => x.source.startsWith("generated-")).length, 96);
    for (const entry of a.cases) {
      assert.deepEqual(readFileSync(join(a.fixtures, entry.source)), readFileSync(join(b.fixtures, entry.source)));
    }
    assert.ok(readdirSync(original).every(name => !name.startsWith("generated-")));
    const byName = new Map(a.cases.map(c => [c.source, c.expected]));
    assert.deepEqual(byName.get("generated-boundary-wide-reject.atto"), {kind:"diagnostic",category:"E_UNIT_LIMIT"});
    assert.deepEqual(byName.get("generated-boundary-tiny-reject.atto"), {kind:"diagnostic",category:"E_UNIT_LIMIT"});
    assert.deepEqual(byName.get("generated-boundary-zero-extreme-ratio.atto"), {kind:"value",decimal:"42"});
    assert.deepEqual(byName.get("generated-boundary-nominal-conversion.atto"), {kind:"diagnostic",category:"E_UNIT_DIMENSION"});
    const wide = (1n << 62n) ** 4n * 128n;
    assert.equal(wide.toString(2).length, 256);
    assert.equal((wide * 2n).toString(2).length, 257);
  } finally {
    rmSync(work1, {recursive:true,force:true});
    rmSync(work2, {recursive:true,force:true});
  }
});
test("nonquantity profiles are not changed", () => {
  const other = {profile:"verified-core-refinements-v1",cases:[]};
  assert.deepEqual(expandQuantityCases(original, "unused", other), {fixtures:original,cases:[]});
});

test("opt-in typed binding corpus includes standard measure cases without changing default matrix", () => {
  const prior = process.env.ATTO_VERIFIED_TYPED_BINDINGS;
  const work = mkdtempSync(join(tmpdir(), "verified-measure-"));
  try {
    process.env.ATTO_VERIFIED_TYPED_BINDINGS = "1";
    const {fixtures,cases} = expandQuantityCases(original, work, manifest);
    assert.equal(cases.length,36);
    assert.equal(new Set(cases.map(c=>c.source)).size,36);
    const measure = cases.filter(c=>c.source.startsWith("generated-binding-measure-"));
    assert.equal(measure.length,12);
    assert.equal(measure.filter(c=>c.expected.kind==="value").length,6);
    assert.equal(measure.filter(c=>c.expected.kind==="diagnostic").length,6);
    for(const entry of measure) {
      const input=readFileSync(join(fixtures,entry.source),"utf8");
      assert.match(input,/define unit Centimeter: Length = Meter \/ 100;/);
      assert.match(input,/type NegativeInt = int where self < 0;/);
      assert.match(input,/pub fnc main\(\) -> int/);
    }
  } finally {
    if(prior===undefined) delete process.env.ATTO_VERIFIED_TYPED_BINDINGS;
    else process.env.ATTO_VERIFIED_TYPED_BINDINGS=prior;
    rmSync(work,{recursive:true,force:true});
  }
});
