/**
 * Source-only audit of the AttoLang annotation v2 proposal.
 * Deliberately does not claim parser, compiler, JIT, AOT or guest execution.
 */
const REQUIRED_TARGETS = [
  "package", "module", "class", "struct", "enum", "enum_variant",
  "actor", "isoactor", "interface", "trait", "contract", "type_alias",
  "fnc", "routine", "method", "static_method", "constructor", "field",
  "actor_state_field", "interface_member", "parameter", "return_type",
  "generic_parameter", "local_binding", "type_use", "lambda", "macro", "import"
];
const REQUIRED_BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
const ALLOWED_JAVA_STATES = new Set(["partial", "reject", "unavailable"]);
const ALLOWED_PHASES = new Set([
  "SOURCE_METADATA", "COMPILE_FILTER", "TYPE_EFFECT", "AOT_DERIVE",
  "ABI", "OPT_HINT", "TEST_ONLY"
]);
const PARTIAL_FAMILIES = new Set(["BuildMetadata", "Ret", "FromJson"]);
const FORBIDDEN_GRANTS = new Set([
  "Unsafe", "Trusted", "AllowAll", "GrantPermission", "GrantCapability",
  "BypassBorrow", "DisableIsolation"
]);
function requireValid(condition, message) {
  if (!condition) throw new Error("ANNOTATION_V2_INVALID: " + message);
}
function unique(values, label) {
  requireValid(values.length === new Set(values).size, "duplicate " + label);
}
export function validateAnnotationTargetsV2(m) {
  requireValid(m && m.$schema_version === "attolang.annotations-targets/v2",
    "wrong contract version");
  requireValid(m.status === "CANDIDATE_SPEC_NOT_EXECUTED",
    "evidence promotion not authorized by a source-only contract");
  requireValid(JSON.stringify(m.backends) === JSON.stringify(REQUIRED_BACKENDS),
    "backend inventory must remain exact and ordered");
  requireValid(Array.isArray(m.targets), "targets must be an array");
  const targetIds = m.targets.map(x => x?.id);
  unique(targetIds, "target");
  requireValid(targetIds.length === REQUIRED_TARGETS.length &&
    REQUIRED_TARGETS.every(x => targetIds.includes(x)), "target coverage incomplete");
  for (const target of m.targets) {
    requireValid(ALLOWED_JAVA_STATES.has(target.java_state), "invalid java state");
    requireValid(target.other_backends === "reject_unimplemented",
      "unproven backend must reject annotations");
    requireValid(typeof target.reason === "string" && target.reason.length > 10,
      "target must have an audit reason");
  }
  requireValid(JSON.stringify(m.phase_names) === JSON.stringify([...ALLOWED_PHASES]),
    "annotation phases must remain exhaustive");
  requireValid(Array.isArray(m.annotation_families) && m.annotation_families.length >= 20,
    "annotation family coverage incomplete");
  const names = m.annotation_families.map(x => x?.name);
  unique(names, "annotation family");
  for (const family of m.annotation_families) {
    requireValid(typeof family.name === "string" &&
      /^[A-Za-z_][A-Za-z_0-9]*$/.test(family.name), "bad annotation family name");
    requireValid(!FORBIDDEN_GRANTS.has(family.name),
      "annotation cannot grant privileged authority");
    requireValid(ALLOWED_PHASES.has(family.phase), "unregistered annotation phase");
    requireValid(family.status === (PARTIAL_FAMILIES.has(family.name) ? "partial" : "proposed"),
      "implementation status is not supported");
    requireValid(typeof family.repeatable === "boolean", "repeatability undefined");
    requireValid(Array.isArray(family.allowed_targets) && family.allowed_targets.length > 0,
      "annotation family has no targets");
    unique(family.allowed_targets, "allowed target");
    for (const target of family.allowed_targets) {
      requireValid(targetIds.includes(target), "annotation uses unknown target");
    }
    requireValid(family.argument_schema === "requires_explicit_typed_schema_before_activation",
      "annotated arguments have no registered checked schema");
  }
  requireValid(Object.keys(m.evidence ?? {}).length === REQUIRED_BACKENDS.length &&
    REQUIRED_BACKENDS.every(b => m.evidence[b] === "NOT_EXECUTED"),
    "source-only contract cannot assert compiler-backed evidence");
  requireValid(m.rules?.authorization ===
    "annotations can require capabilities but never grant them",
    "authorization is not an annotation-controlled grant");
  requireValid(m.rules?.backend_policy ===
    "unsupported annotations must reject before IR or artifact publication",
    "backend failure admission must remain fail-closed");
  requireValid(m.rules?.evidence?.includes("nonzero job steps"),
    "must require real executed steps");
  return { targets: targetIds.length, families: names.length, backends: REQUIRED_BACKENDS.length };
}
