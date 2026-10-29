import test from 'node:test';
import assert from 'node:assert/strict';
import { denyAllPolicy } from '../src/permission-manifest.mjs';
import { ReferenceCapabilityIoBroker } from '../src/capability-io-admission.mjs';

const matching = (_permission, resource, scope) => resource === scope;
function allow(resource = '203.0.113.5:443') {
  const policy = denyAllPolicy();
  policy.net.allow.push(resource);
  return policy;
}
function fixture({ maxInFlight = 1, layers = null } = {}) {
  const open = allow();
  return new ReferenceCapabilityIoBroker({
    maxInFlight,
    layers: layers ?? { host: open, artifact: open, runtime: open, actor: open, delegated: open },
    scopeMatches: matching,
  });
}
function target(broker, destination = '203.0.113.5:443') {
  return broker.bindTarget({ permission: 'net', resource: destination,
    transport: 'tcp', destination });
}
function admission(broker, actor, bound) {
  const result = broker.admit(actor, bound);
  assert.equal(result.status, 'ADMITTED');
  return result.ticket;
}

test('all five authority layers must allow and every explicit deny overrides allow', () => {
  for (const name of ['host', 'artifact', 'runtime', 'actor', 'delegated']) {
    const layers = Object.fromEntries(['host', 'artifact', 'runtime', 'actor', 'delegated']
      .map(layer => [layer, allow()]));
    layers[name].net.deny.push('203.0.113.5:443');
    const broker = fixture({layers});
    assert.equal(broker.admit(broker.registerActor(), target(broker)).status,
      'DENIED_PERMISSION', name);
    assert.equal(broker.snapshot().inFlight, 0);
  }
});

test('authority is immutable after broker creation and missing layers fail closed', () => {
  const all = allow();
  const layers = { host: all, artifact: all, runtime: all, actor: all, delegated: all };
  const broker = fixture({layers});
  layers.host.net.allow.length = 0;
  assert.equal(broker.admit(broker.registerActor(), target(broker)).status, 'ADMITTED');
  assert.throws(() => fixture({layers: {host: all}}), /five trusted/);
  assert.throws(() => fixture({maxInFlight: 0}), /bounded integer/);
});

test('unknown actor, unknown target and forged target cannot invoke host dispatch', () => {
  const broker = fixture();
  const actor = broker.registerActor();
  const bound = target(broker);
  assert.equal(broker.admit(Object.freeze({}), bound).status, 'DENIED_ACTOR');
  assert.equal(broker.admit(actor, Object.freeze({})).status, 'DENIED_TARGET');
  const ticket = admission(broker, actor, bound);
  assert.equal(broker.dispatch(Object.freeze({}), ticket, bound), false);
  assert.equal(broker.dispatch(actor, Object.freeze({}), bound), false);
  assert.equal(broker.dispatch(actor, ticket, Object.freeze({})), false);
  assert.equal(broker.dispatch(actor, ticket, bound), true);
});

test('bound destination change, redirect and policy-denied endpoint require reauthorization', () => {
  const broker = fixture({maxInFlight: 2});
  const actor = broker.registerActor();
  const original = target(broker);
  const redirected = target(broker, '10.0.0.8:443');
  const ticket = admission(broker, actor, original);
  assert.equal(broker.dispatch(actor, ticket, redirected), false);
  assert.equal(broker.admit(actor, redirected).status, 'DENIED_PERMISSION');
  assert.equal(broker.snapshot().inFlight, 1);
});

test('saturation bounds admissions and cancellation never refunds before physical retirement', () => {
  const broker = fixture();
  const actor = broker.registerActor();
  const bound = target(broker);
  const ticket = admission(broker, actor, bound);
  assert.equal(broker.admit(actor, bound).status, 'BACKPRESSURE');
  assert.equal(broker.cancel(actor, ticket), true);
  assert.equal(broker.cancel(actor, ticket), false);
  assert.equal(broker.dispatch(actor, ticket, bound), false);
  assert.equal(broker.admit(actor, bound).status, 'BACKPRESSURE');
  assert.equal(broker.retire(actor, ticket, false), false);
  assert.equal(broker.retire(actor, ticket, true), true);
  assert.equal(broker.retire(actor, ticket, true), false);
  assert.equal(broker.snapshot().inFlight, 0);
  assert.equal(broker.admit(actor, bound).status, 'ADMITTED');
});

test('logical completion requires physical retirement and cannot double settle', () => {
  const broker = fixture();
  const actor = broker.registerActor();
  const bound = target(broker);
  const ticket = admission(broker, actor, bound);
  assert.equal(broker.retire(actor, ticket, true), false);
  assert.equal(broker.complete(actor, ticket), true);
  assert.equal(broker.complete(actor, ticket), false);
  assert.equal(broker.cancel(actor, ticket), false);
  assert.equal(broker.admit(actor, bound).status, 'BACKPRESSURE');
  assert.equal(broker.retire(actor, ticket, true), true);
  assert.equal(broker.dispatch(actor, ticket, bound), false);
});

test('revoke cascades to children, denies late dispatch and retains physical credits', () => {
  const broker = fixture({maxInFlight: 2});
  const parent = broker.registerActor();
  const child = broker.registerActor(parent);
  const bound = target(broker);
  const ticket = admission(broker, child, bound);
  assert.equal(broker.revoke(parent), true);
  assert.equal(broker.revoke(parent), false);
  assert.equal(broker.admit(parent, bound).status, 'DENIED_ACTOR');
  assert.equal(broker.admit(child, bound).status, 'DENIED_ACTOR');
  assert.equal(broker.dispatch(child, ticket, bound), false);
  assert.equal(broker.snapshot().inFlight, 1);
  assert.equal(broker.complete(child, ticket), true);
  assert.equal(broker.retire(child, ticket, true), true);
  assert.equal(broker.snapshot().inFlight, 0);
  assert.throws(() => broker.registerActor(parent), /unavailable/);
});

test('a ticket cannot be completed, cancelled or retired by another actor', () => {
  const broker = fixture();
  const a = broker.registerActor();
  const b = broker.registerActor();
  const ticket = admission(broker, a, target(broker));
  assert.equal(broker.cancel(b, ticket), false);
  assert.equal(broker.complete(b, ticket), false);
  assert.equal(broker.retire(b, ticket, true), false);
  assert.equal(broker.complete(a, ticket), true);
  assert.equal(broker.retire(a, ticket, true), true);
});

test('exhaustive local event orders preserve nonnegative credits and no reuse before retirement', () => {
  const events = ['cancel', 'complete', 'retire', 'revoke'];
  const permutations = (xs) => xs.length === 0 ? [[]] : xs.flatMap((x,i) =>
    permutations(xs.filter((_,j)=>i!==j)).map(rest=>[x,...rest]));
  for (const order of permutations(events)) {
    const broker = fixture();
    const actor = broker.registerActor();
    const bound = target(broker);
    const ticket = admission(broker, actor, bound);
    for (const event of order) {
      if (event === 'cancel') broker.cancel(actor, ticket);
      if (event === 'complete') broker.complete(actor, ticket);
      if (event === 'retire') broker.retire(actor, ticket, true);
      if (event === 'revoke') broker.revoke(actor);
      assert.ok(broker.snapshot().inFlight === 0 || broker.snapshot().inFlight === 1,
        order.join(','));
    }
    const before = broker.snapshot().inFlight;
    const retired = broker.retire(actor, ticket, true);
    assert.equal(broker.snapshot().inFlight, retired ? 0 : before);
  }
});

test('matcher reentrancy cannot publish admission after actor revocation', () => {
  const open = allow();
  let broker;
  let actor;
  broker = new ReferenceCapabilityIoBroker({
    maxInFlight: 1,
    layers: { host: open, artifact: open, runtime: open, actor: open, delegated: open },
    scopeMatches(_permission, resource, scope) {
      broker.revoke(actor);
      return resource === scope;
    },
  });
  actor = broker.registerActor();
  assert.equal(broker.admit(actor, target(broker)).status, 'DENIED_ACTOR');
  assert.equal(broker.snapshot().inFlight, 0);
});
