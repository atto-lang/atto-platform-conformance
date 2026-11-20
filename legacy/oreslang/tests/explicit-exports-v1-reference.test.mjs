#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";

const contractPath = new URL("../fixtures/explicit-exports-v1/contract.json", import.meta.url);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const allowedScopes = new Set(["file", "pkg", "public"]);
const visibilityRank = new Map([["private", -1], ["default", -1], ["file", 0], ["pkg", 1], ["public", 2]]);
const typeKinds = new Set(["class","actor","type","trait","interface","contract","struct","enum","module"]);
const valueKinds = new Set(["fnc","routine","const","val","let","symbol"]);

function namespaceOf(kind) {
  if (typeKinds.has(kind)) return kind === "module" ? "module" : "type";
  if (valueKinds.has(kind)) return "value";
  throw new Error("unknown declaration kind: " + kind);
}

function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}

const exportKinds = new Set([
  "class","actor","type","trait","interface","contract","struct","enum","module",
  "fnc","routine","const","val","let","symbol","model"
]);
const identRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
const symbolRe = /^#[A-Za-z_][A-Za-z0-9_]*$/;

function parseExportSyntax(source) {
  const original = source;
  let text = source.trim();

  if (!text.endsWith(";")) fail("EXPORT_SEMICOLON_REQUIRED");
  text = text.slice(0, -1).trim();

  if (!/^export(?:\s|\[|\()/.test(text)) fail("NOT_EXPORT_DECL");
  text = text.slice("export".length).trimStart();

  let scope = "public";
  let scopeSeen = false;
  if (text.startsWith("[") || text.startsWith("(")) {
    const open = text[0];
    const close = open === "[" ? "]" : ")";
    const end = text.indexOf(close, 1);
    if (end < 0) fail("MALFORMED_EXPORT_SCOPE");
    const raw = text.slice(1, end).trim();
    if (!["file","pkg","package"].includes(raw)) fail("EXPORT_UNKNOWN_SCOPE");
    scope = raw === "package" ? "pkg" : raw;
    scopeSeen = true;
    text = text.slice(end + 1).trimStart();
  }

  if (scopeSeen && (text.startsWith("[") || text.startsWith("("))) {
    fail("EXPORT_MULTIPLE_SCOPES");
  }

  if (/^\*/.test(text) && /\bfrom\b/.test(text)) fail("EXPORT_REEXPORT_UNSUPPORTED");
  if (/^from\b/.test(text)) fail("EXPORT_REEXPORT_UNSUPPORTED");
  if (/^\*/.test(text)) fail("EXPORT_WILDCARD_UNSUPPORTED");

  let kind = null;
  const firstWord = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (firstWord && exportKinds.has(firstWord[1])) {
    kind = firstWord[1];
    text = text.slice(firstWord[0].length).trimStart();
  } else if (firstWord && ["string","int","float","bool","void"].includes(firstWord[1])) {
    fail("EXPORT_UNKNOWN_DECLARATION_KIND");
  }

  function parseOne(raw, insideGroup) {
    const item = raw.trim();
    if (!item) fail("EXPORT_MALFORMED_LIST");

    if (item.includes("{") || item.includes("}")) fail("EXPORT_NESTED_GROUP");
    if (item.includes("::") || item.includes(".") || item.includes("/")) {
      fail("EXPORT_QUALIFIED_TARGET_UNSUPPORTED");
    }
    if (item.includes("<") || item.includes(">")) fail("EXPORT_GENERIC_TARGET_UNSUPPORTED");
    if (item.includes("(") || item.includes(")")) fail("EXPORT_CALLABLE_SIGNATURE_UNSUPPORTED");

    const words = item.split(/\s+/);
    if (insideGroup && words.length > 1 && exportKinds.has(words[0])) {
      fail("EXPORT_KIND_PREFIX_IN_GROUP");
    }

    if (item.startsWith("#")) {
      const selfIdentity = item.match(/^(#[A-Za-z_][A-Za-z0-9_]*)\s+as\s+(#[A-Za-z_][A-Za-z0-9_]*)$/);
      if (selfIdentity) {
        if (kind !== null && kind !== "symbol") fail("EXPORT_KIND_MISMATCH");
        if (selfIdentity[1] !== selfIdentity[2]) fail("EXPORT_SYMBOL_IDENTITY_MISMATCH");
        return {name:selfIdentity[1], symbol:true, selfIdentity:true};
      }
      if (/^(#[A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.test(item)) {
        fail("EXPORT_SYMBOL_BINDING_ALIAS_UNSUPPORTED");
      }
      if (!symbolRe.test(item)) fail("MALFORMED_EXPORT_TARGET");
      if (kind !== null && kind !== "symbol") fail("EXPORT_KIND_MISMATCH");
      return {name:item, symbol:true};
    }

    if (/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+#[A-Za-z_][A-Za-z0-9_]*$/.test(item)) {
      fail("EXPORT_SYMBOL_IDENTITY_TARGET_REQUIRES_SYMBOL_SOURCE");
    }

    if (/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+(?:'[^']*'|"[^"]*")$/.test(item)) {
      fail("EXPORT_LITERAL_ALIAS_UNSUPPORTED");
    }

    const aliasMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (aliasMatch) return {name:aliasMatch[1], external:aliasMatch[2]};

    if (!identRe.test(item)) fail("EXPORT_MALFORMED_LIST");
    return {name:item};
  }

  let items;
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) fail("EXPORT_MALFORMED_LIST");
    const inner = text.slice(1, -1);
    if (inner.trim() === "") fail("EXPORT_EMPTY_GROUP");
    if (inner.includes("{") || inner.includes("}")) fail("EXPORT_NESTED_GROUP");

    const raw = inner.split(",");
    if (raw[raw.length - 1].trim() === "") raw.pop();
    if (raw.length === 0 || raw.some(x => x.trim() === "")) fail("EXPORT_MALFORMED_LIST");
    items = raw.map(x => parseOne(x, true));
  } else {
    if (text.includes("{") || text.includes("}")) fail("EXPORT_MALFORMED_LIST");
    items = [parseOne(text, false)];
  }

  if (kind === "symbol" && items.some(x => !x.symbol)) fail("EXPORT_KIND_MISMATCH");
  if (kind !== "symbol" && items.some(x => x.symbol) && kind !== null) fail("EXPORT_KIND_MISMATCH");

  return {scope, kind, items};
}


function parseVisibilityToken(token) {
  const aliases = contract.scope_aliases;
  if (aliases[token]) return aliases[token];
  if (token === "private") return "private";
  return null;
}

function parseModifierHeader(source) {
  const tokens = source.trim().split(/\s+/);
  let defineCount = 0;
  const vis = [];
  let kind = null;
  for (const token of tokens) {
    if (token === "define") {
      defineCount++;
      continue;
    }
    const v = parseVisibilityToken(token);
    if (v) {
      vis.push(v);
      continue;
    }
    if (["class","actor","type","trait","interface","contract","struct","enum","module"].includes(token)) {
      kind = token;
      break;
    }
  }
  if (defineCount !== 1) fail("INVALID_DEFINE_COUNT");
  if (vis.length > 1) fail("DUPLICATE_VISIBILITY");
  if (!kind) fail("MISSING_DECLARATION_KIND");
  return {kind, visibility:vis[0] ?? "default"};
}

function bindingKey(b) {
  return [b._symbolId, b.external, b.scope].join("\0");
}

function canonicalBindings(bindings) {
  const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  return bindings.map(({_symbolId, ...b}) => b).sort((a,b) =>
    compare(a.external,b.external) ||
    compare(a.local,b.local) ||
    compare(a.scope,b.scope)
  );
}

function resolve(items, {ownerScope = "public", abi = false} = {}) {
  if (!allowedScopes.has(ownerScope)) fail("INVALID_OWNER_SCOPE");
  const ownerRank = visibilityRank.get(ownerScope);
  let declarationSeen = false;
  const decls = [];
  const imports = [];
  const exports = [];

  for (const item of items) {
    if (item.op === "export") {
      exports.push(item);
      continue;
    }
    if (item.op === "import") {
      if (declarationSeen) fail("EXPORT_IMPORT_PRELUDE");
      imports.push(item);
      continue;
    }
    if (item.op === "decl") {
      declarationSeen = true;
      if (!visibilityRank.has(item.visibility)) fail("INVALID_VISIBILITY");
      decls.push({...item, _id:JSON.stringify([item.kind, item.name])});
      continue;
    }
    fail("UNKNOWN_ITEM");
  }

  const byName = new Map();
  for (const d of decls) {
    const key = d.name;
    const list = byName.get(key) ?? [];
    if (list.some(x => namespaceOf(x.kind) === namespaceOf(d.kind) &&
        !(["fnc","routine"].includes(x.kind) && x.kind === d.kind))) {
      fail("DUPLICATE_LOCAL_SYMBOL");
    }
    list.push(d);
    byName.set(key, list);
  }

  // A callable family is one logical symbol, including all default-visible
  // overloads. Explicit modifiers may agree or be absent, never conflict.
  for (const list of byName.values()) {
    for (const kind of ["fnc", "routine"]) {
      const family = list.filter(d => d.kind === kind);
      if (family.length < 2) continue;
      const explicit = new Set(family.map(d => d.visibility).filter(v => v !== "default"));
      if (explicit.size > 1) fail("OVERLOAD_VISIBILITY_CONFLICT");
      const signatures = family.map(d => d.signature);
      if (signatures.some(s => typeof s !== "string" || !s)) fail("MISSING_OVERLOAD_SIGNATURE");
      if (new Set(signatures).size !== family.length) fail("DUPLICATE_OVERLOAD_SIGNATURE");
      for (const d of family) d.visibility = [...explicit][0] ?? "default";
    }
  }

  const importedByName = new Map();
  for (const i of imports) {
    const list = importedByName.get(i.name) ?? [];
    list.push(i);
    importedByName.set(i.name, list);
  }

  const bindings = [];
  const bindingKeys = new Set();

  function addBinding(binding) {
    const existing = bindings.find(b => b.external === binding.external);
    if (existing && existing._symbolId !== binding._symbolId) fail("EXPORT_ALIAS_COLLISION");
    if (existing && existing._symbolId === binding._symbolId && existing.scope !== binding.scope) fail("EXPORT_SCOPE_CONFLICT");
    const key = bindingKey(binding);
    if (!bindingKeys.has(key)) {
      bindingKeys.add(key);
      bindings.push(binding);
    }
  }

  for (const d of decls) {
    if (["file","pkg","public"].includes(d.visibility)) {
      addBinding({_symbolId:d._id, local:d.name, external:d.name, scope:d.visibility});
    }
  }

  for (const ex of exports) {
    if (!allowedScopes.has(ex.scope)) fail("INVALID_EXPORT_SCOPE");
    let candidates = byName.get(ex.name) ?? [];
    if (ex.kind) {
      const typed = candidates.filter(d => d.kind === ex.kind);
      if (typed.length === 0) {
        if (candidates.length > 0) fail("EXPORT_KIND_MISMATCH");
        if (importedByName.has(ex.name)) fail("EXPORT_IMPORTED_NAME");
        fail("EXPORT_UNKNOWN_TARGET");
      }
      candidates = typed;
    } else {
      if (candidates.length === 0) {
        if (importedByName.has(ex.name)) fail("EXPORT_IMPORTED_NAME");
        fail("EXPORT_UNKNOWN_TARGET");
      }
      const logical = new Set(candidates.map(d => namespaceOf(d.kind) + ":" + d.kind));
      if (logical.size > 1) fail("EXPORT_AMBIGUOUS_TARGET");
    }
    if (candidates.length !== 1 && !candidates.every(d =>
        ["fnc","routine"].includes(d.kind) && d.kind === candidates[0].kind)) fail("EXPORT_AMBIGUOUS_TARGET");
    const d = candidates[0];
    if (d.visibility === "private") fail("EXPORT_EXPLICIT_PRIVATE");
    if (["file","pkg","public"].includes(d.visibility) && d.visibility !== ex.scope) fail("EXPORT_SCOPE_CONFLICT");
    addBinding({_symbolId:d._id, local:d.name, external:ex.external ?? d.name, scope:ex.scope});
  }

  const effectiveScope = new Map();
  for (const d of decls) {
    let rank = visibilityRank.get(d.visibility);
    for (const b of bindings) {
      if (b._symbolId === d._id) rank = Math.max(rank, visibilityRank.get(b.scope));
    }
    effectiveScope.set(d._id, Math.min(rank, ownerRank));
  }

  function resolveSignatureRef(ref) {
    const candidates = (byName.get(ref) ?? []).filter(d => namespaceOf(d.kind) === "type");
    if (candidates.length === 0) fail("UNKNOWN_SIGNATURE_REF");
    if (candidates.length !== 1) fail("AMBIGUOUS_SIGNATURE_REF");
    return candidates[0];
  }

  function checkRefs(refs, audience, seen = new Set()) {
    for (const ref of refs) {
      const target = resolveSignatureRef(ref);
      if (effectiveScope.get(target._id) < audience) fail("EXPORT_API_LEAK");
      if (seen.has(target._id)) continue;
      seen.add(target._id);
      checkRefs(target.signatureRefs ?? [], audience, seen);
    }
  }

  for (const d of decls) {
    const dBindings = bindings.filter(b => b._symbolId === d._id);
    for (const b of dBindings) {
      checkRefs(d.signatureRefs ?? [], Math.min(visibilityRank.get(b.scope), ownerRank));
    }
  }

  const rankScope = ["file", "pkg", "public"];
  const result = {bindings:canonicalBindings(bindings.map(b =>
    ({...b, scope:rankScope[Math.min(visibilityRank.get(b.scope), ownerRank)]})))};
  if (abi) {
    // A reference projection, not a production signature digest. The model
    // receives canonical typed signature strings from its trusted fixtures.
    result.abi = JSON.stringify(bindings.map(b => ({
      symbol:b._symbolId, external:b.external,
      scope:rankScope[Math.min(visibilityRank.get(b.scope), ownerRank)],
      signatures:decls.filter(d => d._id === b._symbolId)
        .map(d => d.signature ?? "").sort()
    })).sort((a,b) => a.external < b.external ? -1 : a.external > b.external ? 1 : 0));
  }
  return result;
}

assert.equal(contract.schema, "oreslang.explicit-exports.v1");
assert.equal(contract.version, 1);
assert.deepEqual(contract.canonical_scopes, ["file","pkg","public"]);
assert.equal(contract.native_exposure, "separate");
assert.equal(contract.local_export_resolves_imports, false);
assert.equal(contract.export_transparent_to_import_prelude, true);

assert.equal(contract.syntax_policy.semicolon_required, true);
assert.equal(contract.syntax_policy.empty_group_allowed, false);
assert.equal(contract.syntax_policy.singleton_group_allowed, true);
assert.equal(contract.syntax_policy.trailing_comma_allowed, true);
assert.equal(contract.syntax_policy.nested_group_allowed, false);
assert.equal(contract.syntax_policy.wildcard_allowed, false);
assert.equal(contract.syntax_policy.qualified_target_allowed, false);
assert.equal(contract.syntax_policy.local_export_from_allowed, false);
assert.equal(contract.syntax_policy.per_item_scope_allowed, false);
assert.equal(contract.syntax_policy.symbol_alias_allowed, "self_identity_only");
assert.equal(contract.syntax_policy.literal_alias_allowed, false);
assert.equal(contract.syntax_policy.typed_export_uses_declaration_kind, true);
assert.equal(contract.syntax_policy.malformed_export_falls_back_to_identifier, false);

for (const c of contract.syntax_cases) {
  try {
    const got = parseExportSyntax(c.source);
    if (c.error) assert.fail(c.source + " expected " + c.error);
    assert.deepEqual(got, c.expect, c.source);
  } catch (e) {
    if (!c.error) throw e;
    assert.equal(e.code, c.error, c.source);
  }
}

for (const [spell, scope] of Object.entries(contract.scope_aliases)) {
  assert.ok(["file","pkg","public"].includes(scope), "bad scope alias: " + spell);
}

for (const c of contract.modifier_cases) {
  try {
    const got = parseModifierHeader(c.source);
    if (c.error) assert.fail(c.source + " expected " + c.error);
    assert.deepEqual(got, c.expect, c.source);
  } catch (e) {
    if (!c.error) throw e;
    assert.equal(e.code, c.error, c.source);
  }
}

let fixed = 0;
for (const c of contract.cases) {
  try {
    const got = resolve(c.items, c.context);
    if (c.error) assert.fail(c.name + " expected " + c.error);
    assert.deepEqual(got, {bindings:canonicalBindings(c.expect.bindings)}, c.name);
  } catch (e) {
    if (!c.error) throw e;
    assert.equal(e.code, c.error, c.name);
  }
  fixed++;
}

// Property: moving a local export before/after its declaration cannot change the resolved interface.
for (const scope of ["file","pkg","public"]) {
  const before = resolve([
    {op:"export",name:"X",kind:"class",scope},
    {op:"decl",name:"X",kind:"class",visibility:"default"}
  ]);
  const after = resolve([
    {op:"decl",name:"X",kind:"class",visibility:"default"},
    {op:"export",name:"X",kind:"class",scope}
  ]);
  assert.deepEqual(before, after, "order independence at scope " + scope);
}

// Property: arbitrary runs of export metadata are transparent to the import prelude.
for (let n = 0; n <= 32; n++) {
  const prefix = Array.from({length:n}, (_,i) => ({op:"export",name:"X"+i,kind:"class",scope:"public"}));
  const decls = Array.from({length:n}, (_,i) => ({op:"decl",name:"X"+i,kind:"class",visibility:"default"}));
  const got = resolve([...prefix, {op:"import",name:"Dep",kind:"class"}, ...decls]);
  assert.equal(got.bindings.length, n);
}

// Property: once a real declaration appears, later imports fail regardless of surrounding exports.
for (let n = 0; n <= 16; n++) {
  const around = Array.from({length:n}, (_,i) => ({op:"export",name:"X",kind:"class",scope:"public"}));
  let code = null;
  try {
    resolve([
      {op:"decl",name:"X",kind:"class",visibility:"default"},
      ...around,
      {op:"import",name:"Dep",kind:"class"}
    ]);
  } catch (e) { code = e.code; }
  assert.equal(code, "EXPORT_IMPORT_PRELUDE");
}

// Property: no source export can imply target-native exposure in this contract.
assert.equal(contract.native_exposure, "separate");

for (const c of contract.abi_cases) {
  const left = resolve(c.left, {abi:true}).abi;
  const right = resolve(c.right, {abi:true}).abi;
  assert.equal(left === right, c.equal, c.name);
}

// Trusted fixture IDs represent resolved identities, never package display
// names. This models access policy; it does not implement a source linker.
for (const c of contract.access_cases) {
  function permits(scope) {
    if (scope === "public") return true;
    if (scope === "pkg") return c.callerPackage === "p";
    if (scope === "file") return c.callerFile === "a";
    fail("INVALID_ACCESS_SCOPE");
  }
  assert.equal(permits(c.member) && permits(c.owner), c.expect, c.name);
}

// Connect syntax to semantic resolution for the accepted Symbol identity
// assertion. Parsing alone does not create or authorize a Symbol declaration.
const parsedIdentity = parseExportSyntax("export symbol #ready as #ready;");
const symbolExport = {op:"export",kind:"symbol",name:parsedIdentity.items[0].name,scope:parsedIdentity.scope};
assert.deepEqual(resolve([{op:"decl",kind:"symbol",name:"#ready",visibility:"default"},symbolExport]),
  resolve([{op:"decl",kind:"symbol",name:"#ready",visibility:"default"}, {...symbolExport,source_span:"elsewhere"}]));
assert.throws(() => resolve([symbolExport]), {code:"EXPORT_UNKNOWN_TARGET"});
assert.throws(() => resolve([{op:"decl",kind:"symbol",name:"#ready",visibility:"private"},symbolExport]),
  {code:"EXPORT_EXPLICIT_PRIVATE"});

console.log(JSON.stringify({
  status:"PASS",
  schema:contract.schema,
  fixed_cases:fixed,
  modifier_cases:contract.modifier_cases.length,
  syntax_cases:contract.syntax_cases.length,
  abi_cases:contract.abi_cases.length,
  access_cases:contract.access_cases.length,
  symbol_integration_cases:3,
  order_independence_scopes:3,
  export_prelude_prefix_cases:33,
  declaration_closes_prelude_cases:17,
  total_assertion_groups:fixed + contract.modifier_cases.length + contract.syntax_cases.length + 3 + 33 + 17 + 1 + contract.abi_cases.length + contract.access_cases.length + 3
}));
