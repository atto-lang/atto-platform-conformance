import { inspectTypedPlaceIdentity } from './ownership-typed-origin-ids-v1.mjs';

// Candidate-only identity inventory. The JS JSON shape does not authenticate
// compiler-issued BindingIds, origin proofs, move state, or source/guest CI.
// This mirrors one fail-closed invariant of native LLVM/Java frontends and
// MUST NEVER produce an executable/merge-authorizing verdict.
const error = reason => ({
  ok:false, verified:false, candidateValid:false,
  independentStorageVerified:false, status:'INVALID_IDENTITY_INVENTORY',
  errors:[reason]
});
export function inspectCandidateIdentityInventory(entries) {
  if (!Array.isArray(entries) || entries.length > 1024)
    return error('INVALID_INVENTORY_SHAPE');
  const bindings = new Set();
  const liveOwners = new Set();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'moved,place' ||
        typeof entry.moved !== 'boolean')
      return error('INVALID_INVENTORY_ENTRY');
    const candidate = inspectTypedPlaceIdentity(entry.place);
    if (!candidate.candidateValid)
      return error('INVALID_COMPILER_PLACE');
    if (bindings.has(candidate.bindingId))
      return error('DUPLICATE_BINDING_ID');
    bindings.add(candidate.bindingId);
    if (candidate.mode === 'owned' && !entry.moved &&
        candidate.originId !== 0) {
      if (liveOwners.has(candidate.originId))
        return error('DUPLICATE_LIVE_ALLOCATION_ORIGIN');
      liveOwners.add(candidate.originId);
    }
  }
  return {
    ok:false, verified:false, candidateValid:true,
    independentStorageVerified:false,
    status:'CANDIDATE_IDENTITY_INVENTORY_UNATTESTED', errors:[]
  };
}
