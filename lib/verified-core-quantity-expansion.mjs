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
  assert.equal(cases.length, manifest.cases.length + 80);
  return { fixtures, cases };
}
