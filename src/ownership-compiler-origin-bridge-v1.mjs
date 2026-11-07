import { placesOverlap } from './ownership-place-cfg-v1.mjs';

// Candidate transport contract for typed source-place provenance. These JSON
// records are illustrative input, NOT authenticated compiler MIR. The API
// always refuses to produce an authorizing verdict. Different storage labels
// are NEVER treated as disjoint without an explicit, separately proven layout.
const IDENT = /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/;
const FORBIDDEN = new Set(['constructor', 'prototype', '__proto__']);
const MODES = new Set(['owned', 'shared-loan', 'exclusive-loan']);
const MAX_FIELDS = 8;
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value) {
  return typeof value === 'string' && IDENT.test(value) && !FORBIDDEN.has(value);
}
function requireCase(ok, reason) {
  if (!ok) throw Error(reason);
}
function fail(reason) {
  return {
    ok: false, verified: false, candidateResolved: false,
    status: 'UNTRACKED_COMPILER_ORIGIN', errors: [reason]
  };
}

// Expression is a fully typed *candidate* projection: no implicit pointer,
// reflection or runtime borrow metadata is introduced. A field's receiver is
// recursively resolved to a compiler-local binding, bounded to 8 fields.
export function inspectCandidateCompilerOrigin(expr, locals) {
  try {
    requireCase(plain(locals), 'INVALID_LEXICAL_BINDINGS');
    let node = expr;
    const projections = [];
    while (plain(node) && node.kind === 'field') {
      requireCase(identifier(node.field), 'INVALID_FIELD');
      requireCase(projections.length < MAX_FIELDS, 'UNTRACKED_DEEP_PROJECTION');
      projections.unshift({ field: node.field });
      node = node.receiver;
    }
    requireCase(plain(node) && node.kind === 'name' && identifier(node.name),
      'UNTRACKED_COMPUTED_ORIGIN');
    requireCase(Object.hasOwn(locals, node.name), 'UNTRACKED_LEXICAL_ROOT');
    const binding = locals[node.name];
    requireCase(plain(binding) && identifier(binding.storageRoot) &&
      identifier(binding.bindingId) && MODES.has(binding.mode),
      'UNVERIFIED_BINDING_ORIGIN');
    // Same canonical storageRoot in two lexical slots means they MAY alias.
    // Different root labels are still only claims and MAY alias too.
    return {
      ok: false, verified: false, candidateResolved: true,
      status: 'CANDIDATE_COMPILER_ORIGIN_UNATTESTED',
      place: { owner: binding.storageRoot, path: projections },
      bindingId: binding.bindingId, mode: binding.mode,
      candidateOwnerAuthority: binding.mode === 'owned',
      errors: []
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'UNKNOWN_ORIGIN_REJECTION');
  }
}

export function inspectCandidateCompilerPair({ first, second, locals,
  layoutClaims = {} } = {}) {
  const left = inspectCandidateCompilerOrigin(first, locals);
  const right = inspectCandidateCompilerOrigin(second, locals);
  if (!left.candidateResolved || !right.candidateResolved) {
    return {
      ok: false, verified: false, candidateResolved: false,
      status: 'UNTRACKED_COMPILER_PAIR',
      errors: [...left.errors, ...right.errors]
    };
  }
  const mayAlias = placesOverlap(left.place, right.place, layoutClaims);
  return {
    ok: false, verified: false, candidateResolved: true,
    status: 'CANDIDATE_COMPILER_PAIR_UNATTESTED',
    candidateMayAlias: mayAlias,
    // A claimed disjoint pair is NEVER an authenticated proof:
    independentStorageVerified: false,
    errors: []
  };
}
