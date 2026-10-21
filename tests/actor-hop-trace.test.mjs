import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_ACTOR_HOPS, DEFAULT_ACTOR_HOPS, MAX_ACTOR_HOPS, createActorHopTrace,
  appendActorHop, snapshotActorHops, convertActorHopLayout, ActorTraceComponentIndex,
} from '../lib/actor-hop-trace.mjs';

const layouts = ['aos', 'soa', 'aosoa'];
const hop = (i, extras = {}) => ({actor: `Actor${i}`, handler: 'handle', kind: 'receive',
  source: {unit: 'src/actor.ores', line: i + 1, column: 2}, ...extras});
const build = (n, options = {}) => {
  let trace = createActorHopTrace(options);
  for (let i = 0; i < n; i++) trace = appendActorHop(trace, hop(i));
  return trace;
};

for (const layout of layouts) {
  test(`${layout}: 1,4,5,6,10,16,17,64,100 actor visits keep newest five`, () => {
    for (const n of [1, 4, 5, 6, 10, 16, 17, 64, 100]) {
      const original = build(n, {layout});
      const diagnostic = snapshotActorHops(original);
      const retained = Math.min(n, DEFAULT_ACTOR_HOPS);
      assert.equal(diagnostic.schema, 'oreslang.actor-hops.v1');
      assert.equal(diagnostic.ordering, 'oldest_to_newest');
      assert.equal(diagnostic.total_visits, n);
      assert.equal(diagnostic.retained, retained);
      assert.equal(diagnostic.omitted_prior, n - retained);
      assert.equal(diagnostic.truncated, n > retained);
      assert.deepEqual(diagnostic.entries.map(x => x.actor),
        Array.from({length: retained}, (_, i) => `Actor${n - retained + i}`));
      assert.deepEqual(diagnostic.entries.slice(-Math.min(n, MIN_ACTOR_HOPS)).map(x => x.actor),
        Array.from({length: Math.min(n, MIN_ACTOR_HOPS)}, (_, i) => `Actor${n - Math.min(n, MIN_ACTOR_HOPS) + i}`));
      assert.equal(Object.isFrozen(original), true);
      assert.equal(Object.isFrozen(diagnostic.entries), true);
    }
  });

  test(`${layout}: explicit capacity floor/ceiling and isolation of forks`, () => {
    for (const capacity of [MIN_ACTOR_HOPS, DEFAULT_ACTOR_HOPS, MAX_ACTOR_HOPS]) {
      const root = build(4, {layout, capacity});
      const left = appendActorHop(root, hop(4));
      const right = appendActorHop(root, hop(9));
      assert.equal(snapshotActorHops(root).retained, 4);
      assert.equal(snapshotActorHops(left).entries.at(-1).actor, 'Actor4');
      assert.equal(snapshotActorHops(right).entries.at(-1).actor, 'Actor9');
      const capped = build(100, {layout, capacity});
      assert.equal(snapshotActorHops(capped).retained, capacity);
      assert.equal(snapshotActorHops(capped).entries.at(0).actor, `Actor${100 - capacity}`);
    }
  });

  test(`${layout}: revisits count as visits, not distinct actor names`, () => {
    let ctx = createActorHopTrace({layout, capacity: 5});
    for (const name of ['A','B','A','B','C','D','E']) {
      ctx = appendActorHop(ctx, {actor: name, handler: 'visit', kind: 'forward'});
    }
    assert.deepEqual(snapshotActorHops(ctx).entries.map(x => x.actor), ['A','B','C','D','E']);
    assert.equal(snapshotActorHops(ctx).omitted_prior, 2);
  });
}

test('explicit AoS/SoA/AoSoA conversions preserve semantics and omission count', () => {
  const ctx = build(100);
  const expected = snapshotActorHops(ctx);
  for (const layout of layouts) {
    const converted = convertActorHopLayout(ctx, layout, 3);
    assert.equal(converted.layout, layout);
    assert.deepEqual(snapshotActorHops(converted), expected);
    assert.deepEqual(snapshotActorHops(convertActorHopLayout(converted, 'aos')), expected);
  }
});

test('redacted hops retain position without exposing source, identities, generation', () => {
  const trace = appendActorHop(createActorHopTrace(), hop(1, {
    redacted: true, generation: 'secret-internal-generation', kind: 'rpc-receive',
  }));
  assert.deepEqual(snapshotActorHops(trace).entries[0], {
    actor: '<redacted>', handler: '<redacted>', kind: 'rpc-receive',
    source: null, generation: null, redacted: true,
  });
});

test('fail closed on invalid budgets, spoofed contexts and unapproved message payloads', () => {
  for (const capacity of [0, 4, 65, Infinity, NaN, 5.5]) {
    assert.throws(() => createActorHopTrace({capacity}), RangeError);
  }
  assert.equal(MAX_ACTOR_HOPS, 64);
  assert.throws(() => createActorHopTrace({layout:'unknown'}), TypeError);
  assert.throws(() => appendActorHop({}, hop(1)), TypeError);
  assert.throws(() => appendActorHop(createActorHopTrace(), {...hop(1), payload: 'secret'}), TypeError);
  assert.throws(() => appendActorHop(createActorHopTrace(), {...hop(1), actor: 'A\nB'}), TypeError);
  assert.throws(() => appendActorHop(createActorHopTrace(), {...hop(1), source: {unit:'x', line:0, column:1}}), RangeError);
});

test('ECS-style generational index rejects stale handles and never mutates trace contexts', () => {
  const index = new ActorTraceComponentIndex(1);
  const traceA = build(5);
  const handleA = index.attach(traceA);
  assert.strictEqual(index.resolve(handleA), traceA);
  assert.throws(() => index.attach(traceA), RangeError);
  assert.equal(index.release(handleA), true);
  assert.equal(index.release(handleA), false);
  const traceB = build(8, {layout:'aosoa'});
  const handleB = index.attach(traceB);
  assert.equal(handleB.slot, handleA.slot);
  assert.notEqual(handleB.generation, handleA.generation);
  assert.equal(index.resolve(handleA), null);
  assert.strictEqual(index.resolve(handleB), traceB);
  assert.equal(snapshotActorHops(traceA).retained, 5);
});
