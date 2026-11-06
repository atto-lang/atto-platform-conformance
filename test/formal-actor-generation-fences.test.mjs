// HOST-ONLY bounded state-machine for actor incarnation/capability fencing.
// Not a parser, compiler, scheduler, or guest-runtime conformance claim.
import test from 'node:test';
import assert from 'node:assert/strict';

const initial = () => ({
  generation: 1, alive: true, permits: [0, 0],
  writes: 0, staleDenied: [false, false], invalidWrites: 0,
});
const clone = s => ({ ...s, permits: [...s.permits], staleDenied: [...s.staleDenied] });

function transitions(s) {
  const out = [];
  function add(label, update) {
    const n = clone(s);
    update(n);
    out.push([label, n]);
  }
  if (s.alive) {
    for (let i = 0; i < 2; i++) {
      if (s.permits[i] !== s.generation) {
        add('issue:' + i, n => { n.permits[i] = n.generation; });
      }
      if (s.permits[i] === s.generation && s.writes < 2) {
        add('authorized_write:' + i, n => { n.writes++; });
      }
      if (s.permits[i] > 0 && s.permits[i] < s.generation && !s.staleDenied[i]) {
        add('reject_stale:' + i, n => { n.staleDenied[i] = true; });
      }
    }
    add('retire', n => { n.alive = false; });
  } else if (s.generation < 3) {
    // Revocation is by incarnation; previously issued handles stay stale.
    add('reincarnate', n => { n.generation++; n.alive = true; });
  }
  return out;
}
function invariant(s) {
  return Number.isInteger(s.generation) && s.generation >= 1 && s.generation <= 3 &&
    s.permits.every(p => p >= 0 && p <= s.generation) &&
    s.writes >= 0 && s.writes <= 2 && s.invalidWrites === 0;
}
function explore(mutant = null) {
  const queue = [{ state: initial(), trace: [] }];
  const visited = new Set(), witnesses = new Set();
  let edges = 0;
  for (let position = 0; position < queue.length; position++) {
    const { state: s, trace } = queue[position];
    const key = JSON.stringify(s);
    if (visited.has(key)) continue;
    visited.add(key);
    if (!invariant(s)) return { states: visited.size, edges, witnesses, counterexample: trace };
    if (s.permits.every(p => p === s.generation) && s.alive) witnesses.add('two_current_permits');
    if (s.writes === 2) witnesses.add('two_valid_writes');
    if (s.staleDenied.some(Boolean)) witnesses.add('stale_generation_denied');
    if (s.generation === 3) witnesses.add('third_incarnation');
    if (!s.alive && s.permits.some(p => p > 0)) witnesses.add('retired_with_old_handles');
    const next = transitions(s);
    if (mutant === 'stale' && s.alive && s.permits.some(p => p > 0 && p < s.generation)) {
      const bad = clone(s);
      bad.invalidWrites++;
      next.push(['UNSAFE:stale_capability_write', bad]);
    }
    if (mutant === 'retired' && !s.alive && s.permits.some(p => p > 0)) {
      const bad = clone(s);
      bad.invalidWrites++;
      next.push(['UNSAFE:retired_actor_write', bad]);
    }
    for (const [name, state] of next) {
      edges++;
      queue.push({ state, trace: [...trace, name] });
    }
  }
  return { states: visited.size, edges, witnesses, counterexample: null };
}

test('exhaustive actor-incarnation capability fencing', () => {
  const result = explore();
  assert.equal(result.counterexample, null);
  for (const witness of [
    'two_current_permits', 'two_valid_writes', 'stale_generation_denied',
    'third_incarnation', 'retired_with_old_handles',
  ]) assert.ok(result.witnesses.has(witness), 'missing witness ' + witness);
  assert.ok(result.states > 30 && result.edges > 50);
});
test('a previously issued handle does not silently become a new incarnation', () => {
  let current = initial();
  const take = name => {
    const step = transitions(current).find(([label]) => label === name);
    assert.ok(step, 'step not available: ' + name);
    current = step[1];
  };
  take('issue:0');
  const originalPermit = current.permits[0];
  take('retire');
  take('reincarnate');
  assert.equal(originalPermit, 1);
  assert.equal(current.generation, 2);
  assert.ok(!transitions(current).some(([label]) => label === 'authorized_write:0'));
  take('reject_stale:0');
  assert.equal(current.staleDenied[0], true);
  take('issue:0');
  assert.ok(transitions(current).some(([label]) => label === 'authorized_write:0'));
});
test('actor retirement prevents all writes until incarnation changes', () => {
  let s = initial();
  s = transitions(s).find(([label]) => label === 'issue:0')[1];
  s = transitions(s).find(([label]) => label === 'retire')[1];
  assert.equal(s.alive, false);
  assert.ok(transitions(s).every(([label]) => label === 'reincarnate'));
});
test('each actor capability is issued independently', () => {
  const s = transitions(initial()).find(([label]) => label === 'issue:0')[1];
  assert.deepEqual(s.permits, [1, 0]);
  assert.ok(!transitions(s).some(([label]) => label === 'authorized_write:1'));
});
test('mutant: stale generation write must produce a counterexample', () => {
  const r = explore('stale');
  assert.equal(r.counterexample?.at(-1), 'UNSAFE:stale_capability_write');
});
test('mutant: write to retired actor must produce a counterexample', () => {
  const r = explore('retired');
  assert.equal(r.counterexample?.at(-1), 'UNSAFE:retired_actor_write');
});
