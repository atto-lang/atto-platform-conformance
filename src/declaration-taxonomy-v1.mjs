// SOURCE-FREE reference only. This is NOT an Oreslang parser or compiler.
export function decide(policy, declaration) {
  const rules = policy?.rules?.[declaration?.kind];
  if (!rules) return "UNKNOWN_KIND";
  const d = declaration.options ?? {};
  const parents = d.parents ?? [];
  if (parents.some(p => !rules.parent_kinds.includes(p.kind))) return "PARENT_KIND";
  if (parents.length > rules.max_parents) return "MULTIPLE_SUPERCLASSES";
  if (rules.isolation === "preserve" &&
      parents.some(p => p.isolation && p.isolation !== (d.isolation ?? "shared")))
    return "ISOLATION_CHANGE";
  if ((d.ordinary_fields ?? 0) > 0 && !rules.ordinary_fields)
    return "PERSISTENT_STATE_OUTSIDE_SCHEMA";
  if ((d.state_blocks ?? 0) > rules.guest_state_blocks) return "STATE_SCHEMA_COUNT";
  if ((d.mutable_fields ?? 0) > 0 && declaration.kind === "record")
    return "IMMUTABLE_RECORD_MUTATION";
  if (d.direct_state_access) return "DIRECT_STATE_ACCESS";
  if (d.loan_escape) return "STATE_LOAN_ESCAPE";
  if (d.loan_across_await) return "STATE_LOAN_SUSPEND";
  if (d.override_intrinsic) return "SEALED_INTRINSIC";
  if (d.claims_control) return "CONTROL_FORGERY";
  if (d.shared_mutation && declaration.kind === "state_container")
    return "UNGUARDED_SHARED_MUTATION";
  if (rules.identity_key && (typeof d.identity_key !== "string" || !d.identity_key))
    return "GRAIN_IDENTITY_REQUIRED";
  if ((d.interfaces ?? []).length && (!rules.interfaces ||
      d.interfaces.some(i => i.kind !== "interface"))) return "INTERFACE_KIND";
  if ((d.interfaces ?? []).some(i => (i.capabilities ?? []).length))
    return "INTERFACE_CAPABILITY_GRANT";
  if ((d.traits ?? []).length && !rules.traits) return "TRAIT_NOT_ADMITTED";
  if ((d.traits ?? []).some(t => t.stateful)) return "TRAIT_STATE_FORBIDDEN";
  if ((d.traits ?? []).some(t => (t.capabilities ?? []).length))
    return "TRAIT_CAPABILITY_GRANT";
  const declared = new Set(d.capabilities ?? []);
  if ((d.granted_capabilities ?? []).some(x => !declared.has(x)))
    return "CAPABILITY_WIDENING";
  return "OK";
}
