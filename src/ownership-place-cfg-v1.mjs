// Candidate reference semantics for future typed-MIR place/loan dataflow.
// This is NOT a compiler, soundness proof, authorization oracle, or execution
// attestation. A frontend must independently prove canonical owner identity,
// field non-overlap, and array-element independence before using these rules.
const IDENT = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_PATH = 8;
const MAX_EVENTS = 256;

function isObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function identifier(x) {
  return typeof x === 'string' && IDENT.test(x) && !FORBIDDEN.has(x);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Place identities are canonical owners, not arbitrary aliases or names.
// E.g. { owner: 'frame_owner_1', path: [{field: 'profile'}, {field:'age'}] }
export function normalizePlace(p) {
  assert(isObject(p) && identifier(p.owner), 'INVALID_PLACE_OWNER');
  assert(Array.isArray(p.path) && p.path.length <= MAX_PATH, 'INVALID_PLACE_PATH');
  const path = p.path.map(step => {
    assert(isObject(step), 'INVALID_PLACE_STEP');
    const keys = Object.keys(step);
    assert(keys.length === 1, 'AMBIGUOUS_PLACE_STEP');
    if (keys[0] === 'field') {
      assert(identifier(step.field), 'INVALID_FIELD_PROJECTION');
      return { field: step.field };
    }
    if (keys[0] === 'index') {
      assert(step.index === '*' ||
        (Number.isSafeInteger(step.index) && step.index >= 0 && step.index <= 2147483647),
        'INVALID_INDEX_PROJECTION');
      return { index: step.index };
    }
    throw new Error('UNSUPPORTED_PLACE_PROJECTION');
  });
  return { owner: p.owner, path };
}
function stepsEqual(a, b) {
  return a.field !== undefined ? b.field === a.field : b.index === a.index;
}
function samePath(a, b) {
  return a.owner === b.owner && a.path.length === b.path.length &&
    a.path.every((step, i) => stepsEqual(step, b.path[i]));
}
function groupMatches(group, owner, parent, first, second, type) {
  if (!isObject(group) || group.kind !== type || group.owner !== owner ||
      !Array.isArray(group.parent) || !Array.isArray(group.members)) return false;
  let g;
  try { g = normalizePlace({ owner, path: group.parent }); }
  catch { return false; }
  return samePath(g, { owner, path: parent }) &&
    group.members.includes(first) && group.members.includes(second);
}
function certifiedDisjoint(a, b, parent, policy) {
  if (!isObject(policy)) return false;
  if (a.field !== undefined && b.field !== undefined) {
    return a.field !== b.field && Array.isArray(policy.disjointFields) &&
      policy.disjointFields.some(g =>
        groupMatches(g, policy.owner, parent, a.field, b.field, 'nominal-fields'));
  }
  if (a.index !== undefined && b.index !== undefined) {
    return a.index !== '*' && b.index !== '*' && a.index !== b.index &&
      Array.isArray(policy.disjointIndices) &&
      policy.disjointIndices.some(g => {
        if (!isObject(g) || g.kind !== 'independent-elements' ||
            !Array.isArray(g.parent)) return false;
        let claimed;
        try { claimed = normalizePlace({owner: policy.owner, path:g.parent}); }
        catch { return false; }
        return samePath(claimed, {owner:policy.owner,path:parent});
      });
  }
  return false;
}

// By default all paths under the same owner may alias. Disjoint fields or
// indices are accepted only when a frontend-provided layout CLAIM supplies
// a matching non-overlap group. This helper does not authenticate that claim.
export function placesOverlap(rawA, rawB, layoutClaims = {}) {
  const a = normalizePlace(rawA), b = normalizePlace(rawB);
  if (a.owner !== b.owner) return false; // requires canonical owner IDs
  const policies = isObject(layoutClaims) ? layoutClaims : {};
  const policy = policies[a.owner];
  // A claim under another root must not authorize disjointness here.
  const scopedPolicy = isObject(policy) && policy.owner === a.owner ? policy : null;
  for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
    const x = a.path[i], y = b.path[i];
    if (stepsEqual(x, y)) continue;
    if (certifiedDisjoint(x, y, a.path.slice(0, i), scopedPolicy)) return false;
    return true;
  }
  return true; // identical places or an owner/ancestor and its projection
}
const canonical = x => JSON.stringify(normalizePlace(x));
const exactSame = (a, b) => canonical(a) === canonical(b);

function clone(state) {
  return {
    moved: state.moved.map(x => normalizePlace(x)),
    loans: new Map([...state.loans].map(([k, v]) => [k, {
      place: normalizePlace(v.place), mutable: v.mutable
    }]))
  };
}
function loanEquivalent(a, b) {
  if (a.loans.size !== b.loans.size) return false;
  for (const [token, loan] of a.loans) {
    const other = b.loans.get(token);
    if (!other || loan.mutable !== other.mutable || !exactSame(loan.place, other.place))
      return false;
  }
  return true;
}
function overlap(a, b, layouts) {
  return placesOverlap(a, b, layouts);
}
function liveLoan(state, place, layouts, mutable = true) {
  return [...state.loans.values()].some(loan =>
    overlap(loan.place, place, layouts) && (mutable || loan.mutable));
}
function movedOverlap(state, place, layouts) {
  return state.moved.some(m => overlap(m, place, layouts));
}
function effects(operations, state, layouts, budget, path = '') {
  assert(Array.isArray(operations), 'INVALID_CFG_BLOCK');
  for (let i = 0; i < operations.length; i++) {
    assert(++budget.count <= MAX_EVENTS, 'CFG_BUDGET_EXCEEDED');
    const event = operations[i], site = path + '/' + i;
    assert(isObject(event) && typeof event.op === 'string', 'INVALID_CFG_EVENT');
    if (event.op === 'branch') {
      assert(Array.isArray(event.then) && Array.isArray(event.else),
        'INVALID_CFG_BRANCH');
      const left = effects(event.then, clone(state), layouts, budget, site + ':then');
      const right = effects(event.else, clone(state), layouts, budget, site + ':else');
      assert(loanEquivalent(left, right), 'LOAN_JOIN_MISMATCH');
      state.loans = left.loans;
      // A move in EITHER predecessor is considered possibly moved at the
      // join; never silently resurrect a place when only one arm moved it.
      state.moved = [...left.moved];
      for (const p of right.moved)
        if (!state.moved.some(existing => exactSame(existing, p))) state.moved.push(p);
      continue;
    }
    if (event.op === 'suspend') {
      assert(state.loans.size === 0, 'LIVE_LOAN_CROSSES_SUSPENSION');
      continue;
    }
    if (event.op === 'release') {
      assert(identifier(event.loan) && state.loans.delete(event.loan),
        'UNKNOWN_OR_DUPLICATE_LOAN_RELEASE');
      continue;
    }
    if (event.op === 'send') {
      assert(event.payloadMode !== 'borrowed', 'BORROW_ESCAPES_TRANSPORT');
      assert(event.payloadMode === 'owned-copy' || event.payloadMode === 'owned-take',
        'UNKNOWN_TRANSPORT_PROVENANCE');
      const sent = normalizePlace(event.place);
      assert(!movedOverlap(state, sent, layouts), 'SEND_OF_MOVED_PLACE');
      if (event.payloadMode === 'owned-take') {
        assert(!liveLoan(state, sent, layouts), 'SEND_TAKE_DURING_ACTIVE_LOAN');
        // An actor transfer of an owned place is a consuming move, not
        // an advisory tag. Future reads must see that owner as moved.
        state.moved.push(sent);
      } else {
        assert(!liveLoan(state, sent, layouts, false),
          'SEND_COPY_CONFLICTS_EXCLUSIVE_LOAN');
      }
      // The origin's true Copy/Send and tenant-generation capabilities must
      // be independently proved by the backend; no such authority is
      // established by this untrusted candidate event's payloadMode string.
      continue;
    }
    const place = normalizePlace(event.place);
    if (event.op === 'read') {
      assert(!movedOverlap(state, place, layouts), 'READ_OF_MOVED_PLACE');
      assert(!liveLoan(state, place, layouts, false), 'READ_CONFLICTS_EXCLUSIVE_LOAN');
    } else if (event.op === 'take') {
      assert(!movedOverlap(state, place, layouts), 'TAKE_OF_MOVED_PLACE');
      assert(!liveLoan(state, place, layouts), 'TAKE_DURING_ACTIVE_LOAN');
      state.moved.push(place);
    } else if (event.op === 'borrow') {
      assert(!movedOverlap(state, place, layouts), 'BORROW_OF_MOVED_PLACE');
      assert(identifier(event.loan) && !state.loans.has(event.loan), 'DUPLICATE_LOAN_ID');
      assert(typeof event.mutable === 'boolean', 'INVALID_LOAN_MODE');
      assert(!liveLoan(state, place, layouts, event.mutable),
        'OVERLAPPING_LOAN_CONFLICT');
      state.loans.set(event.loan, {place, mutable:event.mutable});
    } else if (event.op === 'write') {
      assert(!liveLoan(state, place, layouts), 'WRITE_DURING_ACTIVE_LOAN');
      // An assignment to exactly a partially moved slot restores that slot;
      // it must NEVER resurrect an ancestor, a moved root, or an unrelated
      // field. Root replacement requires an explicit rebind.
      assert(!state.moved.some(m => overlap(m, place, layouts) && !exactSame(m, place)),
        'WRITE_THROUGH_MOVED_OWNER');
      state.moved = state.moved.filter(m => !exactSame(m, place));
    } else if (event.op === 'rebind') {
      assert(place.path.length === 0, 'REBIND_REQUIRES_WHOLE_OWNER');
      assert(!liveLoan(state, place, layouts), 'REBIND_DURING_ACTIVE_LOAN');
      state.moved = state.moved.filter(m => m.owner !== place.owner);
    } else {
      throw new Error('UNSUPPORTED_CFG_OPERATION');
    }
  }
  return state;
}

// A model/fixture analyzer, NOT an authority to approve a compiler release.
// Always returns verified:false and ok:false regardless of candidate outcome.
export function inspectPlaceFlow(input) {
  try {
    assert(isObject(input), 'INVALID_FLOW');
    const state = effects(input.events, {moved:[], loans:new Map()},
      input.layoutClaims, {count:0});
    assert(state.loans.size === 0, 'LOAN_ESCAPES_LEXICAL_SCOPE');
    return {
      ok:false, verified:false, candidateAdmitted:true,
      status:'CANDIDATE_ACCEPTED_UNATTESTED',
      moved:state.moved.map(canonical), errors:[]
    };
  } catch (e) {
    return {
      ok:false, verified:false, candidateAdmitted:false,
      status:'CANDIDATE_REJECTED_UNATTESTED',
      moved:[], errors:[e.message]
    };
  }
}
