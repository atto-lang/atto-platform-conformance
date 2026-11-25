// Deterministic expansion of the existing quantity guest corpus; never an execution receipt.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function expandQuantityCases(original, work, manifest) {
  if (manifest.profile !== "verified-core-quantities-v1") return { fixtures: original, cases: manifest.cases };
  const fixtures = join(work, "expanded-quantities");
  mkdirSync(fixtures);
  cpSync(original, fixtures, { recursive: true });
  const cases = [...manifest.cases];
  const seen = new Set(cases.map(c => c.source));
  const ok = { kind: "value", decimal: "42" };
  const diag = category => ({ kind: "diagnostic", category });
  for (const f of [2n, 3n, 5n, 7n, 8n, 10n, 1000n, 1000000n]) {
    const declarations = `define dimension Time;
define unit Base: Time;
define unit Small: Time = Base / ${f};
define unit Alias: Time = Small;`;
    const add = (name, expression, expected) => {
      const source = `generated-${f}-${name}.atto`;
      assert.ok(!seen.has(source), source);
      seen.add(source);
      writeFileSync(join(fixtures, source), declarations + "\n\npub fnc main() -> int { return " + expression + "; }\n", { flag: "wx" });
      cases.push({ source, expected });
    };
    add("downscale", `${42n*f}<Small>.to_unit<Base>() / 1<Base>`, ok);
    add("negative", `0 - (-${42n*f}<Small>.to_unit<Base>() / 1<Base>)`, ok);
    add("zero", "42 + (0<Small>.to_unit<Base>() / 1<Base>)", ok);
    add("upscale", `42<Base>.to_unit<Small>() / ${f}<Small>`, ok);
    add("alias", "84<Alias> / 2<Small>", ok);
    add("fraction", `${f+1n}<Small>.to_unit<Base>() / 1<Base>`, diag("E_UNIT_INEXACT"));
    add("negative-fraction", `-${f+1n}<Small>.to_unit<Base>() / 1<Base>`, diag("E_UNIT_INEXACT"));
    add("overflow", "9223372036854775807<Base>.to_unit<Small>() / 1<Small>", diag("E_UNIT_RANGE"));
    add("mixed-scale", "(1<Base> + 1<Small>) / 1<Base>", diag("E_UNIT_SCALE"));
    add("residual-scale", "1<Base> / 1<Small>", diag("E_UNIT_ERASURE"));
  }
  // Wider normalized scales and nominal identity. All success cases return
  // 42, which is portable even when a backend reports main via exit status.
  const addBoundary = (name, declarations, expression, expected) => {
    const source = "generated-boundary-" + name + ".atto";
    assert.ok(!seen.has(source), source);
    seen.add(source);
    writeFileSync(join(fixtures, source), declarations + "\n\npub fnc main() -> int { return " + expression + "; }\n", { flag: "wx" });
    cases.push({ source, expected });
  };
  const base = "define dimension Time; define unit Base: Time;";
  const p = 1n << 62n;
  let wide = base;
  for (let i = 1; i <= 4; i++) wide += " define unit U" + i + ": Time = " + (i === 1 ? "Base" : "U" + (i-1)) + " * " + p + ";";
  wide += " define unit Wide: Time = U4 * 128;";
  let small = base;
  for (let i = 1; i <= 4; i++) small += " define unit D" + i + ": Time = " + (i === 1 ? "Base" : "D" + (i-1)) + " / " + p + ";";
  small += " define unit Tiny: Time = D4 / 128;";
  addBoundary("wide-same", wide, "84<Wide> / 2<Wide>", ok);
  addBoundary("wide-zero", wide, "42 + 0<Wide>.to_unit<Base>() / 1<Base>", ok);
  addBoundary("wide-overflow", wide, "1<Wide>.to_unit<Base>() / 1<Base>", diag("E_UNIT_RANGE"));
  addBoundary("wide-reject", wide + " define unit Overflow: Time = Wide * 2;", "42", diag("E_UNIT_LIMIT"));
  addBoundary("tiny-same", small, "84<Tiny> / 2<Tiny>", ok);
  addBoundary("tiny-zero", small, "42 + 0<Tiny>.to_unit<Base>() / 1<Base>", ok);
  addBoundary("tiny-inexact", small, "1<Tiny>.to_unit<Base>() / 1<Base>", diag("E_UNIT_INEXACT"));
  addBoundary("tiny-reject", small + " define unit Overflow: Time = Tiny / 2;", "42", diag("E_UNIT_LIMIT"));
  const both = wide + small.slice(base.length);
  addBoundary("cross-cancel", both, "42<Wide> * 1<Tiny>", ok);
  addBoundary("zero-extreme-ratio", both, "42 + 0<Wide>.to_unit<Tiny>() / 1<Tiny>", ok);
  addBoundary("nominal-mismatch", base + " define dimension Length; define unit Other: Length;", "1<Base> + 1<Other>", diag("E_UNIT_DIMENSION"));
  addBoundary("nominal-conversion", base + " define dimension Length; define unit Other: Length;", "1<Base>.to_unit<Other>()", diag("E_UNIT_DIMENSION"));
  addBoundary("unknown-dimension", base + " define unit Bad: Missing;", "42", diag("E_UNIT_NAME"));
  addBoundary("forward-cycle", base + " define unit A: Time = B; define unit B: Time = A;", "42", diag("E_UNIT_NAME"));
  addBoundary("duplicate-dimension", base + " define dimension Time;", "42", diag("E_UNIT_DUPLICATE"));
  addBoundary("duplicate-unit", base + " define unit Base: Time;", "42", diag("E_UNIT_DUPLICATE"));
  assert.equal(cases.length, manifest.cases.length + 96);
  return { fixtures, cases };
}
