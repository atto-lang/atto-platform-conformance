// Executable SOURCE-FREE reference semantics only. Never certify guest AOT from this module.
const BACKENDS = ["forge", "java", "llvm", "net", "wasm"];
const EXPECTED_FEATURES = [
  "operators_equality","pattern_matching","typed_guards","binary_patterns","closures",
  "typed_actor_messages","selective_receive","monitors_links_registration",
  "scheduler_fairness","supervisor_trees","typed_errors","conditional_match",
  "comprehensions","otp_server_state_machine","otp_app_lifecycle",
  "ets_like_tables","dets_like_store","distributed_rpc","hot_code_upgrade",
  "observability_ffi","big_integer","dynamic_term","distributed_transactions",
  "generic_ordering"
];
const REQUIRED_AOT_FLAGS = [
  "no_runtime_guest_ast_interpretation","no_runtime_guest_jit",
  "no_runtime_guest_code_generation","no_reflection_based_guest_dispatch",
  "static_message_descriptors","static_callable_targets",
  "precompiled_versioned_hot_loading_only"
];
const NOT_EXECUTED = "NOT_EXECUTED";
const fail = message => { throw new Error("INVALID_ERLANG_AOT_CONTRACT: " + message); };

export function validate_erlang_aot_contract(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) fail("object");
  if (c.schema !== "attolang.erlang_otp.full_aot_parity.v1" || c.version !== 1 ||
      c.status !== "DRAFT_SOURCE_CONTRACT_NOT_GUEST_EXECUTION") fail("schema/status");
  const o = c.operator_contract;
  if (!o || o.equality !== "eq" || o.inequality !== "neq" ||
      o.inequality_alias !== "!eq" || o.match_is_not_equality !== true ||
      o.no_implicit_numeric_cross_type_coercion !== true ||
      o.short_circuit_logic !== "PRESERVE_EXISTING_ATTO_GRAMMAR") fail("operators");
  if (JSON.stringify(o.canonical_forbidden_spellings) !==
      JSON.stringify(["==","!=","=:=","/=","=/="])) fail("forbidden operators");
  if (!o.legacy_migration?.includes("blob SHA")) fail("migration safeguards");

  const a = c.aot_policy;
  if (!a || REQUIRED_AOT_FLAGS.some(key => a[key] !== true)) fail("AOT invariant");
  if (!a.backend_modes ||
      Object.keys(a.backend_modes).sort().join(",") !== BACKENDS.join(",") ||
      Object.values(a.backend_modes).some(v => typeof v !== "string" || v.length < 20)) fail("AOT targets");

  if (!Array.isArray(c.feature_plan) || c.feature_plan.length !== EXPECTED_FEATURES.length ||
      c.feature_plan.map(x => x.id).join(",") !== EXPECTED_FEATURES.join(",")) fail("features");
  for (const f of c.feature_plan) {
    if (!["P0","P1","P2"].includes(f.priority) ||
        f.status !== "PLANNED_NOT_EXECUTED" ||
        typeof f.aot_lowering !== "string" || f.aot_lowering.length < 30) fail("feature status/lowering");
  }
  if (JSON.stringify(c.deferred?.map(x => x.id)) !==
      JSON.stringify(["function_clause_matching"]) ||
      c.deferred[0].status !== "DEFERRED" ||
      c.deferred[0].condition.length < 50) fail("deferred dispatch");
  if (!Array.isArray(c.required_negative_cases) || c.required_negative_cases.length < 10 ||
      new Set(c.required_negative_cases).size !== c.required_negative_cases.length) fail("negative cases");
  if (!Array.isArray(c.required_actor_cases) || c.required_actor_cases.length < 14 ||
      new Set(c.required_actor_cases).size !== c.required_actor_cases.length) fail("actor cases");
  if (Object.keys(c.backend_evidence ?? {}).sort().join(",") !== BACKENDS.join(",")) fail("backend matrix");
  for (const evidence of Object.values(c.backend_evidence)) {
    if (Object.keys(evidence).sort().join(",") !==
        ["aot_artifact","guest_compiler","guest_runtime","independent_review",
          "negative_no_executable_output"].join(",")) fail("evidence shape");
    if (Object.values(evidence).some(v => v !== NOT_EXECUTED)) fail("self-certification");
  }
  if (!c.promotion_rules || Object.values(c.promotion_rules).length !== 8 ||
      Object.values(c.promotion_rules).some(v => v !== true)) fail("promotion gates");
  if (!Array.isArray(c.receipts) || c.receipts.length !== 0) fail("unreviewed receipts");
  return {
    status: "SOURCE_ONLY_NOT_EXECUTED",
    aot_parity_certified: false,
    executed_guest_backends: 0,
    feature_count: EXPECTED_FEATURES.length,
    deferred: ["function_clause_matching"]
  };
}

// The matcher is a JS predicate ONLY in this source-free oracle.
// A real compiler MUST lower the equivalent pure Atto pattern to native code.
export class SelectiveMailboxReference {
  constructor({capacity, generation = 1} = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 ||
        !Number.isSafeInteger(generation) || generation < 1) throw new TypeError("invalid mailbox");
    this.capacity = capacity;
    this.generation = generation;
    this.queue = [];
    this.closed = false;
  }
  admit({sender, recipient_generation, type, payload} = {}) {
    if (!Number.isSafeInteger(recipient_generation) || recipient_generation < 1 ||
        typeof sender !== "string" || !sender || typeof type !== "string" || !type)
      throw new TypeError("invalid admission");
    if (this.closed) return {status:"CLOSED"};
    if (recipient_generation !== this.generation) return {status:"STALE_GENERATION"};
    if (this.queue.length >= this.capacity) return {status:"FULL"};
    // No payload cloning/ownership claim: actual guest conformance must prove transfer.
    this.queue.push({sender, type, payload, recipient_generation});
    return {status:"ACCEPTED"};
  }
  receive_matching(matches, {cancelled = false, deadline_expired = false} = {}) {
    if (typeof matches !== "function") throw new TypeError("model matcher required");
    // Cancellation and timeout are modeled as having already won the race.
    if (cancelled) return {status:"CANCELLED"};
    for (let i = 0; i < this.queue.length; i++) {
      if (matches(this.queue[i])) {
        const [message] = this.queue.splice(i, 1);
        return {status:"MATCHED", message};
      }
    }
    if (deadline_expired) return {status:"TIMED_OUT"};
    return {status:this.closed ? "CLOSED_NO_MATCH" : "NO_MATCH"};
  }
  close() { this.closed = true; }
  restart() {
    if (this.generation === Number.MAX_SAFE_INTEGER) throw new RangeError("generation exhausted");
    this.generation++;
    this.queue.length = 0;
    this.closed = false;
    return this.generation;
  }
  pending_types() { return this.queue.map(m => m.type); }
}

// Static supervisor decision reference, not a runtime supervisor or liveness proof.
export function supervisor_restart_plan(strategy, children, failed) {
  if (!["one_for_one","one_for_all","rest_for_one"].includes(strategy)) throw new TypeError("strategy");
  if (!Array.isArray(children) || !children.length ||
      children.some(x => typeof x !== "string" || !x) ||
      new Set(children).size !== children.length) throw new TypeError("children");
  const i = children.indexOf(failed);
  if (i < 0) throw new TypeError("unknown failed child");
  const targets = strategy === "one_for_one" ? [failed] :
    strategy === "one_for_all" ? [...children] : children.slice(i);
  return {
    restart: targets,
    // Failed actor already terminated; siblings stop in reverse start order.
    stop_survivors: targets.filter(x => x !== failed).reverse(),
    unaffected: children.filter(x => !targets.includes(x))
  };
}
