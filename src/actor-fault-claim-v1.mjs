// Shape-only admission for AttoLang actor-fault containment declarations.
// This never executes faults, authenticates GitHub receipts, or certifies isolation.
import { types } from 'node:util';

export const BACKENDS = Object.freeze([
  'oreslang-source.java', 'oreslang-source.llvm', 'oreslang-source.wasm',
  'oreslang-source.forge', 'oreslang-source.net',
  'oreslang-source.rs', 'oreslang-source.cranelift'
]);
export const FAILURES = Object.freeze([
  'guest-panic', 'guest-stack-quota', 'guest-memory-bounds', 'actor-oom',
  'native-segv', 'host-oom', 'os-process-kill', 'vm-corruption'
]);
export const SCOPES = Object.freeze(['actor', 'tenant', 'process']);
export const MECHANISMS = Object.freeze([
  'none', 'same-process-guards', 'bounded-guest-vm', 'dedicated-worker-process'
]);
const FATAL = new Set(['native-segv', 'host-oom', 'os-process-kill', 'vm-corruption']);
const KEYS = Object.freeze([
  'schema', 'backend', 'failure_class', 'claimed_scope', 'isolation_mechanism',
  'one_actor_per_worker', 'supervisor_out_of_process', 'enforced_memory_limit',
  'execution_status'
]);
function plainExact(value) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
         Object.getPrototypeOf(value) !== null)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== KEYS.length ||
        keys.some(k => typeof k !== 'string' || !KEYS.includes(k))) return false;
    for (const key of KEYS) {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || !Object.hasOwn(desc, 'value') || !desc.enumerable) return false;
    }
    return true;
  } catch { return false; }
}
const result = (valid, reason) => Object.freeze({
  valid, reason, certified: false, releaseReady: false,
  evidenceClass: 'SELF_REPORTED_SHAPE_ONLY'
});

export function validateActorFaultClaim(claim) {
  if (!plainExact(claim)) return result(false, 'MALFORMED_CLAIM');
  const { schema, backend, failure_class: failure, claimed_scope: scope,
    isolation_mechanism: mechanism, one_actor_per_worker: single,
    supervisor_out_of_process: parent, enforced_memory_limit: bounded,
    execution_status: execution } = claim;
  if (schema !== 'atto.actor-fault-claim.v1' ||
      !BACKENDS.includes(backend) || !FAILURES.includes(failure) ||
      !SCOPES.includes(scope) || !MECHANISMS.includes(mechanism) ||
      !['not_executed', 'executed_claimed'].includes(execution) ||
      [single, parent, bounded].some(v => typeof v !== 'boolean'))
    return result(false, 'INVALID_DECLARATION');
  // A process-level failure is allowed to be acknowledged as uncontained.
  // Process-level metadata NEVER implies that the process survives.
  if (scope !== 'process' && mechanism === 'none')
    return result(false, 'MISSING_ISOLATION_MECHANISM');
  if (FATAL.has(failure) && scope !== 'process') {
    // A signal handler, GC heap, arena, or same-process VM is insufficient
    // evidence of actor/tenant survival after a corrupted host process.
    if (mechanism !== 'dedicated-worker-process' || !parent)
      return result(false, 'FATAL_HOST_FAULT_REQUIRES_EXTERNAL_SUPERVISOR');
    if (scope === 'actor' && !single)
      return result(false, 'ACTOR_SCOPE_REQUIRES_DEDICATED_WORKER');
    if (failure === 'host-oom' && !bounded)
      return result(false, 'HOST_OOM_REQUIRES_OS_ENFORCED_LIMIT');
  }
  // Nonfatal guest failures can be contained by real checked lowering, but
  // a descriptive field alone cannot prove that lowering was exercised.
  return result(true, execution === 'not_executed' ?
    'NOT_EXECUTED' : 'SELF_REPORTED_NOT_AUTHENTICATED');
}
