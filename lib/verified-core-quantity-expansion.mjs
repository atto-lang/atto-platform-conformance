// Deterministic expansion of the existing quantity guest corpus; never an execution receipt.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {typedBindingCases} from "./verified-typed-binding-corpus.mjs";
import {typedBindingCases as helperCases} from "./verified-typed-helper-corpus.mjs";

export function expandQuantityCases(original, work, manifest) {
  if (process.env.ATTO_VERIFIED_TYPED_BINDINGS === "1") {
    assert.equal(manifest.profile,"verified-core-quantities-v1");
    const fixtures=join(work,"typed-bindings");
    mkdirSync(fixtures);
    const selected=process.env.ATTO_VERIFIED_HELPERS === "1"?helperCases:typedBindingCases;
    for(const c of selected)writeFileSync(join(fixtures,c.source),c.text,{flag:"wx"});
    return {fixtures,cases:selected.map(({source,expected})=>({source,expected}))};
  }
  if (manifest.profile === "verified-core-refinements-v1" && process.env.ATTO_VERIFIED_CAST_ASCRIPTION === "1") {
    const fixtures = join(work, "expanded-refinements");
    mkdirSync(fixtures);
    cpSync(original, fixtures, { recursive: true });
    const cases = [...manifest.cases];
    const pre = "define dimension Time; define unit Second: Time; define unit Millis: Time = Second / 1000; type Duration = int where units in Second; type Positive = int where self > 0 and units in Second; type Small = i32 where self > 0;";
    const add = (id, body, expected) => {
      const source = "generated-cast-refinement-" + id + ".atto";
      writeFileSync(join(fixtures, source), pre + "\n" + body + "\n", { flag: "wx" });
      cases.push({ source, expected });
    };
    const main = expr => "pub fnc main() -> int { return " + expr + "; }";
    const ok = {kind:"value", decimal:"42"};
    const fail = {kind:"refinementFailure", category:"refinementViolation"};
    for (const [style, cast] of [
      ["prefix", (x,t) => "<" + t + ">(" + x + ")"],
      ["postfix", (x,t) => "(" + x + ")::<" + t + ">"],
      ["keyword", (x,t) => "(" + x + " as " + t + ")"],
    ]) {
      add(style + "-positive", main(cast("42.<Second>", "Positive") + " / 1<Second>"), ok);
      add(style + "-negative", main(cast("0.<Second>", "Positive") + " / 1<Second>"), fail);
      add(style + "-i32", "pub fnc main() -> int { val Small n = " + cast("42","Small") + "; return n; }", ok);
      add(style + "-i32-range", "pub fnc main() -> int { val Small n = " + cast("2147483648","Small") + "; return n; }", fail);
    }
    add("parameter", "fnc tag(int n) -> Duration { return n.<Second>; } " + main("tag(42) / 1<Second>"), ok);
    add("parameter-as", "fnc tag(int n) -> Duration { return n as Second; } " + main("tag(42) / 1<Second>"), ok);
    add("parameter-retag", "fnc tag(Duration n) -> Duration { return n.<Second>; } " + main("42"), {kind:"diagnostic",category:"E_UNIT_ATTACHMENT"});
    assert.equal(cases.length, manifest.cases.length + 15);
    return {fixtures,cases};
  }
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
  addBoundary("cross-cancel", both, "(42<Wide> * 1<Tiny>) / (1<Base> * 1<Base>)", ok);
  addBoundary("zero-extreme-ratio", both, "42 + 0<Wide>.to_unit<Tiny>() / 1<Tiny>", ok);
  addBoundary("nominal-mismatch", base + " define dimension Length; define unit Other: Length;", "1<Base> + 1<Other>", diag("E_UNIT_DIMENSION"));
  addBoundary("nominal-conversion", base + " define dimension Length; define unit Other: Length;", "1<Base>.to_unit<Other>()", diag("E_UNIT_DIMENSION"));
  addBoundary("unknown-dimension", base + " define unit Bad: Missing;", "42", diag("E_UNIT_NAME"));
  addBoundary("forward-cycle", base + " define unit A: Time = B; define unit B: Time = A;", "42", diag("E_UNIT_NAME"));
  addBoundary("duplicate-dimension", base + " define dimension Time;", "42", diag("E_UNIT_DUPLICATE"));
  addBoundary("duplicate-unit", base + " define unit Base: Time;", "42", diag("E_UNIT_DUPLICATE"));
  assert.equal(cases.length, manifest.cases.length + 96);
  if (process.env.ATTO_VERIFIED_CAST_ASCRIPTION === "1") {
    const p = "define dimension Time; define unit Second: Time; define unit Millis: Time = Second / 1000;";
    const trap = category => ({ kind: "arithmeticFailure", category });
    for (const [name, tag] of [
      ["dot", n => n + ".<Second>"],
      ["compact", n => n + "<Second>"],
      ["legacy", n => n + "::<Second>"],
      ["keyword", n => "(" + n + " as Second)"],
    ]) {
      addBoundary("cast-" + name + "-value", p, tag("84") + " / " + tag("2"), ok);
      addBoundary("cast-" + name + "-zero", p, tag("1") + " / " + tag("0"), trap("divisionByZero"));
      addBoundary("cast-" + name + "-overflow", p, tag("-9223372036854775808") + " / " + tag("-1"), trap("integerOverflow"));
    }
    for (const [name, expr] of [
      ["prefix", "(<i64>42).<Second> / 1<Second>"],
      ["postfix", "42::<i64>.<Second> / 1<Second>"],
      ["as", "(42 as i64).<Second> / 1<Second>"],
      ["expression", "(40 + 2).<Second> / 1<Second>"],
      ["conversion", "42000.<Millis>.to_unit<Second>() / 1<Second>"],
    ]) addBoundary("cast-" + name, p, expr, ok);
    for (const [name, expr, category] of [
      ["retag", "42<Second>.<Millis> / 1<Millis>", "E_UNIT_ATTACHMENT"],
      ["residual", "(1<Second> / 1<Millis>).<Second> / 1<Second>", "E_UNIT_ATTACHMENT"],
      ["wrong-kind", "42.<Time>", "E_UNIT_NAME"],
      ["double", "42.<Second>.<Second> / 1<Second>", "E_UNIT_ATTACHMENT"],
      ["cast-erasure-postfix", "42<Second>::<i64>", "E_UNIT_ERASURE"],
      ["cast-erasure-prefix", "<i64>(42<Second>)", "E_UNIT_ERASURE"],
      ["cast-erasure-as", "42<Second> as i64", "E_UNIT_ERASURE"],
    ]) addBoundary("cast-" + name, p, expr, diag(category));
    // Scale-one, multi-dimensional expressions must normalize before
    // scalar lowering; no host-only or backend-specific substitutes.
    const dimensions = "define dimension Time; define dimension Length; define unit Second: Time; define unit Meter: Length;";
    for (const [name, expr] of [
      ["unit-add", "(40.<Meter> + 2.<Meter>) / 1.<Meter>"],
      ["unit-sub", "(44.<Meter> - 2.<Meter>) / 1.<Meter>"],
      ["unit-product-order", "(21.<Meter> * 2.<Second>) / (1.<Second> * 1.<Meter>)"],
      ["unit-velocity", "(84.<Meter> / 2.<Second>) * 1.<Second> / 1.<Meter>"],
      ["unit-area", "(21.<Meter> * 2.<Meter>) / (1.<Meter> * 1.<Meter>)"],
    ]) addBoundary(name, dimensions, expr, ok);
    for (const [name, expr, category] of [
      ["unit-mixed-add", "1.<Meter> + 1.<Second>", "E_UNIT_DIMENSION"],
      ["unit-residual-dimension", "1.<Meter> / 1.<Second>", "E_UNIT_ERASURE"],
      ["unit-residual-area", "1.<Meter> * 1.<Meter>", "E_UNIT_ERASURE"],
    ]) addBoundary(name, dimensions, expr, diag(category));
    assert.equal(cases.length, manifest.cases.length + 128);
  }
  return { fixtures, cases };
}
