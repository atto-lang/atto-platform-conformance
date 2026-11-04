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
export function verifyAotWireContract(m) {
  const bad = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["contract is not an object"];
  if (m.contract !== "attolang.aot-wire-json-msgpack/1" || m.schemaVersion !== 1 ||
      m.status !== "candidate-unattested") bad.push("closed contract identity/status");
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
