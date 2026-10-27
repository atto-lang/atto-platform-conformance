// Bounded explicit-state reference explorer. NOT proof of actual Oreslang guest code.
const SESSION_COUNT = 2;
const MAX_IMAGES = 2;
const GENS = 3;
const clone = x => structuredClone(x);
const init = () => ({
  active: 0, images: [0], staged: -1, validated: [0],
  sessions: Array.from({length: SESSION_COUNT}, () => ({
    phase: 'idle', generation: -1, token: 'none', admittedEver: false
  }))
});
const key = s => JSON.stringify(s);

export function transitions(s, mutation = 'none') {
  const out = [];
  const add = (name, state) => out.push({name, state});
  for (let i = 0; i < SESSION_COUNT; i++) {
    const se = s.sessions[i];
    if (se.phase === 'idle') {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'created', generation: s.active, token: 'created'});
      add('start_' + i, t);
    }
    if (se.phase === 'created') {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'auth_pending', token: 'none', admittedEver: true});
      add('admit_' + i, t);
    }
    if (se.phase === 'auth_pending') {
      const t = clone(s);
      t.sessions[i].phase = 'auth_uncertain';
      add('timeout_' + i, t);
      if (mutation === 'resurrect') {
        const u = clone(s);
        Object.assign(u.sessions[i], {phase: 'created', token: 'created'});
        add('BAD_timeout_resurrect_' + i, u);
      }
    }
    if (['auth_pending', 'auth_uncertain'].includes(se.phase)) {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'authorized', token: 'authorized'});
      add('settle_auth_' + i, t);
    }
    if (se.phase === 'authorized') {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'capture_pending', token: 'none'});
      add('capture_' + i, t);
    }
    if (se.phase === 'capture_pending') {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'captured', token: 'none'});
      add('settle_capture_' + i, t);
    }
    if (['created', 'authorized', 'captured'].includes(se.phase)) {
      const t = clone(s);
      Object.assign(t.sessions[i], {phase: 'closed', generation: -1, token: 'none'});
      add('close_' + i, t);
    }
  }
  if (s.staged === -1 && s.active < GENS - 1 && s.images.length < MAX_IMAGES) {
    const t = clone(s), v = s.active + 1;
    t.images.push(v); t.images.sort(); t.staged = v;
    add('stage_v' + (v + 1), t);
  }
  if (s.staged !== -1) {
    if (!s.validated.includes(s.staged)) {
      const t = clone(s);
      t.validated.push(s.staged);
      t.validated.sort();
      add('validate_v' + (s.staged + 1), t);
      if (mutation === 'publish') {
        const u = clone(s);
        u.active = s.staged; u.staged = -1;
        add('BAD_commit_unvalidated_v' + (u.active + 1), u);
      }
    } else {
      const t = clone(s);
      t.active = s.staged; t.staged = -1;
      add('commit_v' + (t.active + 1), t);
    }
  }
  for (const v of s.images) {
    if (v === s.active || v === s.staged) continue;
    const pinned = s.sessions.some(se => se.generation === v);
    if (!pinned || mutation === 'purge') {
      const t = clone(s);
      t.images = t.images.filter(x => x !== v);
      t.validated = t.validated.filter(x => x !== v);
      add((pinned ? 'BAD_' : '') + 'retire_v' + (v + 1), t);
    }
  }
  return out;
}

export function violation(s) {
  if (!s.images.includes(s.active)) return 'active_image_missing';
  if (!s.validated.includes(s.active)) return 'unvalidated_image_published';
  if (s.validated.some(v => !s.images.includes(v))) return 'validation_outlived_image';
  if (s.images.length > MAX_IMAGES) return 'image_capacity_exceeded';
  if (s.staged !== -1 && !s.images.includes(s.staged)) return 'staged_image_missing';
  for (const [i, se] of s.sessions.entries()) {
    if (se.generation !== -1 && !s.images.includes(se.generation)) return 'dangling_session_pin_' + i;
    if (['idle', 'closed'].includes(se.phase) && se.generation !== -1) return 'terminal_pin_' + i;
    if (se.phase === 'created' && (se.token !== 'created' || se.admittedEver)) return 'old_phase_resurrected_' + i;
    if (se.phase === 'authorized' && se.token !== 'authorized') return 'authorized_token_mismatch_' + i;
    if (['auth_pending', 'auth_uncertain', 'capture_pending', 'captured', 'closed', 'idle'].includes(se.phase)
      && se.token !== 'none') return 'consumed_token_reused_' + i;
  }
  return null;
}

export function explore(mutation = 'none', maxStates = 200000) {
  const initial = init(), queue = [{s: initial, path: []}], seen = new Set([key(initial)]);
  for (let j = 0; j < queue.length; j++) {
    const {s, path} = queue[j], fault = violation(s);
    if (fault) return {status: 'counterexample', fault, path, states: seen.size};
    for (const {name, state} of transitions(s, mutation)) {
      const k = key(state);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push({s: state, path: [...path, name]});
        if (seen.size > maxStates) return {status: 'state_limit', states: seen.size};
      }
    }
  }
  return {status: 'checked_finite_model', states: seen.size};
}

export function rtAdmit({wcet, jitter, interference, blocking, cleanup, activation, deadline, allKnown, certificateMatches}, mutation = 'none') {
  const sum = wcet + jitter + interference + blocking + cleanup + activation;
  const evaluated = mutation === 'omit_cleanup' ? sum - cleanup : sum;
  return allKnown && certificateMatches && evaluated <= deadline;
}

export function checkRealtimeFinite(mutation = 'none') {
  let checked = 0;
  // Exhaustive within this intentionally small bounded abstraction.
  for (let wcet = 0; wcet <= 2; wcet++)
  for (let jitter = 0; jitter <= 2; jitter++)
  for (let interference = 0; interference <= 2; interference++)
  for (let blocking = 0; blocking <= 2; blocking++)
  for (let cleanup = 0; cleanup <= 2; cleanup++)
  for (let activation = 0; activation <= 2; activation++)
  for (let deadline = 0; deadline <= 12; deadline++)
  for (const allKnown of [false, true])
  for (const certificateMatches of [false, true]) {
    const inputs = {wcet, jitter, interference, blocking, cleanup, activation, deadline, allKnown, certificateMatches};
    checked++;
    if (rtAdmit(inputs, mutation) && (!allKnown || !certificateMatches
      || wcet + jitter + interference + blocking + cleanup + activation > deadline)) {
      return {status: 'counterexample', inputs, checked};
    }
  }
  return {status: 'checked_finite_model', checked};
}
