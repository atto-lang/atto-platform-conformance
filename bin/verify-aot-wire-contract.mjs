#!/usr/bin/env node
// Schema-only lint. This verifier cannot prove backend or guest execution.
const required = Object.freeze([
  "json.field_order",
  "json.i64_bounds",
  "json.boolean",
  "json.escapes",
  "json.duplicate_key",
  "json.unknown_key",
  "json.missing_key",
  "json.malformed_utf8",
  "json.nested_denied",
  "json.alias_version_gate",
  "json.schema_fingerprint",
  "json.input_budget",
  "msgpack.field_order",
  "msgpack.signed_i64",
  "msgpack.boolean",
  "msgpack.strict_utf8",
  "msgpack.duplicate_key",
  "msgpack.unknown_key",
  "msgpack.missing_key",
  "msgpack.nil_denied",
  "msgpack.float_denied",
  "msgpack.unsigned64_denied",
  "msgpack.schema_fingerprint",
  "msgpack.input_budget",
  "aot.no_host_reflection",
  "aot.static_decode_table",
  "aot.native_guest_execution",
  "aot.no_runtime_jit",
  "aot.linker_metadata_retention",
  "aot.guest_constructor_ownership",
  "aot.tenant_generation_fence",
  "aot.cross_backend_differential"
]);
const backends = Object.freeze(["java","llvm","wasm","forge","net"]);
// Audit-pinned shape and oracle classification: no authored manifest may
// silently substitute a negative rejection oracle with a positive codec claim.
const canonicalKinds = Object.freeze({
  "json.field_order": "codec",
  "json.i64_bounds": "codec",
  "json.boolean": "codec",
  "json.escapes": "codec",
  "json.duplicate_key": "negative",
  "json.unknown_key": "negative",
  "json.missing_key": "negative",
  "json.malformed_utf8": "negative",
  "json.nested_denied": "negative",
  "json.alias_version_gate": "negative",
  "json.schema_fingerprint": "codec",
  "json.input_budget": "negative",
  "msgpack.field_order": "codec",
  "msgpack.signed_i64": "codec",
  "msgpack.boolean": "codec",
  "msgpack.strict_utf8": "codec",
  "msgpack.duplicate_key": "negative",
  "msgpack.unknown_key": "negative",
  "msgpack.missing_key": "negative",
  "msgpack.nil_denied": "negative",
  "msgpack.float_denied": "negative",
  "msgpack.unsigned64_denied": "negative",
  "msgpack.schema_fingerprint": "codec",
  "msgpack.input_budget": "negative",
  "aot.no_host_reflection": "artifact-or-guest",
  "aot.static_decode_table": "artifact-or-guest",
  "aot.native_guest_execution": "artifact-or-guest",
  "aot.no_runtime_jit": "artifact-or-guest",
  "aot.linker_metadata_retention": "artifact-or-guest",
  "aot.guest_constructor_ownership": "artifact-or-guest",
  "aot.tenant_generation_fence": "artifact-or-guest",
  "aot.cross_backend_differential": "artifact-or-guest"
});
const canonicalUnsupported = Object.freeze(["null","Option","nested arrays","nested maps","union","arbitrary objects","polymorphism","field aliases","custom setters","floating point","uint64","streaming frames"]);
const topLevelFields = Object.freeze(["backends","cases","codecs","contract","limits","runtimeReflectionAllowed","schemaIdentity","schemaVersion","serializationShape","status","supportedScalarTypes","unsupported"]);
const caseFields = Object.freeze(["backends","evidence","id","kind"]);

export function verifyAotWireContract(m) {
  const bad = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["contract is not an object"];
  if (JSON.stringify(Object.keys(m).sort()) !== JSON.stringify(topLevelFields))
    bad.push("unreviewed top-level wire policy fields");
  if (m.contract !== "attolang.aot-wire-json-msgpack/1" || m.schemaVersion !== 1 ||
      m.status !== "candidate-unattested") bad.push("closed contract identity/status");
  if (m.serializationShape !== "closed-nominal-required-fields-only" ||
      JSON.stringify(m.unsupported) !== JSON.stringify(canonicalUnsupported))
    bad.push("closed wire shape and unsupported feature set changed");
  if (JSON.stringify(m.codecs) !== JSON.stringify(["json","messagepack"]))
    bad.push("exact codecs required");
  if (JSON.stringify(m.backends) !== JSON.stringify(backends))
    bad.push("exact five backends required");
  if (JSON.stringify(m.supportedScalarTypes) !== JSON.stringify(["int","i64","bool","string"]))
    bad.push("closed scalar types required");
  if (JSON.stringify(m.limits) !== JSON.stringify({
      inputBytes:65536,stringBytes:4096,fields:256,maxDepth:1}))
    bad.push("wire budget changed");
  if (m.runtimeReflectionAllowed !== false ||
      m.schemaIdentity !== "domain-separated-sha256-of-canonical-ATTOREF1-table")
    bad.push("AOT authority/schema identity changed");
  if (!Array.isArray(m.cases) || m.cases.length !== required.length) {
    bad.push("32 oracle cases required");
    return bad;
  }
  const seen = new Set();
  for (const c of m.cases) {
    if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.id !== "string") {
      bad.push("invalid oracle entry"); continue;
    }
    if (!required.includes(c.id) || seen.has(c.id)) bad.push("oracle ID changed/duplicated");
    seen.add(c.id);
    if (JSON.stringify(Object.keys(c).sort()) !== JSON.stringify(caseFields))
      bad.push("unreviewed oracle fields: " + c.id);
    if (c.kind !== canonicalKinds[c.id])
      bad.push("canonical oracle classification changed: " + c.id);
    if (c.evidence !== "NOT_EXECUTED") bad.push("fabricated wire evidence: " + c.id);
    if (JSON.stringify(c.backends) !== JSON.stringify(backends))
      bad.push("oracle backend scope changed: " + c.id);
    if (!["codec","negative","artifact-or-guest"].includes(c.kind) ||
        (c.id.startsWith("aot.") && c.kind !== "artifact-or-guest") ||
        (!c.id.startsWith("aot.") && c.kind === "artifact-or-guest"))
      bad.push("oracle evidence stage changed: " + c.id);
  }
  if (required.some(id => !seen.has(id))) bad.push("required wire oracle removed");
  return bad;
}
