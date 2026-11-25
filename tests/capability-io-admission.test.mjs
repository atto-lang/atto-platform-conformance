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

test('single dispatch token cannot start the same host operation twice', () => {
  const broker = fixture();
  const actor = broker.registerActor();
  const bound = target(broker);
  const ticket = admission(broker, actor, bound);
  assert.equal(broker.dispatch(actor, ticket, bound), true);
  assert.equal(broker.dispatch(actor, ticket, bound), false);
  assert.equal(broker.cancel(actor, ticket), true);
  assert.equal(broker.complete(actor, ticket), true);
  assert.equal(broker.retire(actor, ticket, true), true);
  assert.equal(broker.snapshot().inFlight, 0);
});

test('approved hostname cannot launder a denied actual network destination', () => {
  const broker = fixture();
  const actor = broker.registerActor();
  const forged = broker.bindTarget({permission: 'net',resource:'203.0.113.5:443',
    transport:'tcp',destination:'169.254.169.254:80'});
  assert.equal(broker.admit(actor, forged).status, 'DENIED_PERMISSION');
  assert.equal(broker.snapshot().inFlight, 0);
});

test('a separately authorized destination can be bound without equating hostname and address', () => {
  const all = allow();
  all.net.allow.push('198.51.100.99:443');
  const broker = fixture({layers: {host:all,artifact:all,runtime:all,actor:all,delegated:all}});
  const actor = broker.registerActor();
  const bound = broker.bindTarget({permission:'net',resource:'203.0.113.5:443',
    transport:'tcp',destination:'198.51.100.99:443'});
  const ticket = admission(broker,actor,bound);
  assert.equal(broker.dispatch(actor,ticket,bound),true);
  assert.equal(broker.dispatch(actor,ticket,bound),false);
  assert.equal(broker.complete(actor,ticket),true);
  assert.equal(broker.retire(actor,ticket,true),true);
});

test('per-actor grants remain attenuated by all ancestors even if child broadens requests', () => {
  const shared = denyAllPolicy();
  shared.net.allow.push('*');
  const broker = fixture({layers:{host:shared,artifact:shared,runtime:shared,
    actor:shared,delegated:shared},maxInFlight:3});
  const rootPolicy = denyAllPolicy();
  rootPolicy.net.allow.push('203.0.113.5:443');
  const childPolicy = denyAllPolicy();
  childPolicy.net.allow.push('*');
  const parent = broker.registerActor(null,rootPolicy);
  const child = broker.registerActor(parent,childPolicy);
  const other = target(broker,'198.51.100.12:443');
  assert.equal(broker.admit(parent,other).status,'DENIED_PERMISSION');
  assert.equal(broker.admit(child,other).status,'DENIED_PERMISSION');
  assert.equal(broker.admit(child,target(broker)).status,'ADMITTED');
  assert.equal(broker.admit(broker.registerActor(),other).status,'ADMITTED');
});

test('actor policy snapshots cannot be relaxed after registration', () => {
  const shared = denyAllPolicy(); shared.net.allow.push('*');
  const broker = fixture({layers:{host:shared,artifact:shared,runtime:shared,
    actor:shared,delegated:shared}});
  const policy = denyAllPolicy(); policy.net.allow.push('203.0.113.5:443');
  const actor = broker.registerActor(null,policy);
  policy.net.allow.push('198.51.100.12:443');
  assert.equal(broker.admit(actor,target(broker,'198.51.100.12:443')).status,
    'DENIED_PERMISSION');
  assert.equal(broker.admit(actor,target(broker)).status,'ADMITTED');
});
test('transport/permission confusion cannot turn filesystem grants into network I/O', () => {
  const broker = fixture();
  for (const [permission, transport] of [['read','tcp'],['write','http'],['net','file']]) {
    assert.throws(() => broker.bindTarget({permission,resource:'203.0.113.5:443',
      destination:'203.0.113.5:443',transport}), /complete normalized identity/);
  }
});

test('filesystem path alias is separately checked before authorization', () => {
  const read = denyAllPolicy(); read.read.allow.push('/allowed/file');
  const broker = fixture({layers:{host:read,artifact:read,runtime:read,actor:read,delegated:read}});
  const actor = broker.registerActor();
  const original = broker.bindTarget({permission:'read',transport:'file',
    resource:'/allowed/file',destination:'/other/file'});
  assert.equal(broker.admit(actor,original).status,'DENIED_PERMISSION');
});

test('global shutdown fences all dispatch, keeps credits until host quiescence', () => {
  const broker = fixture({maxInFlight:2});
  const a = broker.registerActor();
  const b = broker.registerActor();
  const bound = target(broker);
  const first = admission(broker,a,bound);
  const second = admission(broker,b,bound);
  assert.equal(broker.dispatch(a,first,bound),true);
  assert.equal(broker.shutdown(),true);
  assert.equal(broker.shutdown(),false);
  assert.equal(broker.snapshot().closed,true);
  assert.equal(broker.snapshot().inFlight,2);
  assert.equal(broker.dispatch(b,second,bound),false);
  assert.equal(broker.admit(a,bound).status,'DENIED_SHUTDOWN');
  assert.throws(()=>broker.registerActor(),/shut down/);
  assert.throws(()=>target(broker),/shut down/);
  assert.equal(broker.retire(a,first,false),false);
  assert.equal(broker.complete(a,first),true);
  assert.equal(broker.retire(a,first,true),true);
  assert.equal(broker.retire(b,second,true),true);
  assert.equal(broker.snapshot().inFlight,0);
});

test('authorization callback cannot commit admission after global shutdown', () => {
  const open=allow();
  let broker;
  broker = new ReferenceCapabilityIoBroker({
    layers:{host:open,artifact:open,runtime:open,actor:open,delegated:open},
    maxInFlight:1,
    scopeMatches(_permission,resource,scope) {
      broker.shutdown();
      return resource===scope;
    }
  });
  const actor=broker.registerActor();
  const bound=target(broker);
  assert.equal(broker.admit(actor,bound).status,'DENIED_SHUTDOWN');
  assert.equal(broker.snapshot().inFlight,0);
});

test('subtree budgets prevent one actor family from exhausting an unrelated sibling', () => {
  const broker = fixture({maxInFlight:4});
  const parent = broker.registerActor(null,null,{maxSubtreeInFlight:2});
  const narrow = broker.registerActor(parent,null,{maxSubtreeInFlight:1});
  const grandchild = broker.registerActor(narrow);
  const sibling = broker.registerActor(parent);
  const unrelated = broker.registerActor();
  const bound = target(broker);
  const n = admission(broker,narrow,bound);
  assert.equal(broker.admit(grandchild,bound).status,'BACKPRESSURE_SUBTREE');
  const s = admission(broker,sibling,bound);
  assert.equal(broker.admit(sibling,bound).status,'BACKPRESSURE_SUBTREE');
  const u = admission(broker,unrelated,bound);
  assert.equal(broker.snapshot().inFlight,3);
  assert.equal(broker.complete(sibling,n),false); // cross-actor settlement forbidden
  assert.equal(broker.complete(narrow,n),true);
  assert.equal(broker.retire(narrow,n,true),true);
  const g = admission(broker,grandchild,bound);
  for (const [actor,ticket] of [[sibling,s],[unrelated,u],[grandchild,g]]) {
    assert.equal(broker.complete(actor,ticket),true);
    assert.equal(broker.retire(actor,ticket,true),true);
  }
  assert.equal(broker.snapshot().inFlight,0);
});

test('cancellation and revocation retain every ancestor budget until physical retirement', () => {
  const broker = fixture({maxInFlight:3});
  const parent = broker.registerActor(null,null,{maxSubtreeInFlight:1});
  const first = broker.registerActor(parent);
  const sibling = broker.registerActor(parent);
  const unrelated = broker.registerActor();
  const bound = target(broker);
  const ticket = admission(broker,first,bound);
  assert.equal(broker.cancel(first,ticket),true);
  assert.equal(broker.admit(sibling,bound).status,'BACKPRESSURE_SUBTREE');
  assert.equal(broker.retire(first,ticket,false),false);
  assert.equal(broker.admit(sibling,bound).status,'BACKPRESSURE_SUBTREE');
  assert.equal(broker.revoke(first),true);
  assert.equal(broker.admit(sibling,bound).status,'BACKPRESSURE_SUBTREE');
  assert.equal(broker.snapshot().inFlight,1);
  const other = admission(broker,unrelated,bound);
  assert.equal(broker.retire(first,ticket,true),true);
  assert.equal(broker.retire(first,ticket,true),false);
  const next = admission(broker,sibling,bound);
  assert.equal(broker.complete(unrelated,other),true);
  assert.equal(broker.retire(unrelated,other,true),true);
  assert.equal(broker.complete(sibling,next),true);
  assert.equal(broker.retire(sibling,next,true),true);
  assert.equal(broker.snapshot().inFlight,0);
});

test('actor subtree budgets reject widening, malformed limits, and stale handles', () => {
  const broker = fixture({maxInFlight:4});
  const parent = broker.registerActor(null,null,{maxSubtreeInFlight:2});
  assert.throws(() => broker.registerActor(parent,null,{maxSubtreeInFlight:3}),/widen/);
  assert.throws(() => broker.registerActor(null,null,{maxSubtreeInFlight:5}),/widen/);
  for (const invalid of [0,-1,1.5,Infinity,'2',null]) {
    if (invalid === null) continue; // null is the inherited default
    assert.throws(() => broker.registerActor(parent,null,{maxSubtreeInFlight:invalid}),
      /positive bounded integer/);
  }
  assert.throws(() => broker.registerActor(parent,null,{maxInFlight:1}),/exact/);
  assert.throws(() => broker.registerActor(parent,null,{}),/exact/);
  const child = broker.registerActor(parent);
  const bound = target(broker);
  const a = admission(broker,child,bound);
  const b = admission(broker,child,bound);
  assert.equal(broker.admit(child,bound).status,'BACKPRESSURE_SUBTREE');
  assert.equal(broker.admit(Object.freeze({}),bound).status,'DENIED_ACTOR');
  assert.equal(broker.complete(child,a),true);
  assert.equal(broker.retire(child,a,true),true);
  assert.equal(broker.complete(child,b),true);
  assert.equal(broker.retire(child,b,true),true);
});

test('all subtree receipts settle exactly once under cancellation/revoke orderings', () => {
  for (const order of [['revoke','cancel'],['cancel','revoke'],
                       ['complete','revoke'],['revoke','complete']]) {
    const broker = fixture({maxInFlight:2});
    const parent = broker.registerActor(null,null,{maxSubtreeInFlight:1});
    const child = broker.registerActor(parent);
    const bound = target(broker);
    const ticket = admission(broker,child,bound);
    for (const action of order) {
      if (action === 'cancel') broker.cancel(child,ticket);
      if (action === 'complete') broker.complete(child,ticket);
      if (action === 'revoke') broker.revoke(child);
      assert.equal(broker.snapshot().inFlight,1);
    }
    assert.equal(broker.retire(child,ticket,false),false);
    assert.equal(broker.retire(child,ticket,true),true);
    assert.equal(broker.retire(child,ticket,true),false);
    assert.equal(broker.snapshot().inFlight,0);
  }
});

test('reentrant authorization cannot overbook an actor subtree quota', () => {
  const open = allow();
  let broker, actor, bound, attempted = false, inner;
  broker = new ReferenceCapabilityIoBroker({
    layers:{host:open,artifact:open,runtime:open,actor:open,delegated:open},
    maxInFlight:3,
    scopeMatches(_permission,resource,scope) {
      if (!attempted) {
        attempted = true;
        inner = broker.admit(actor,bound);
      }
      return resource===scope;
    }
  });
  actor = broker.registerActor(null,null,{maxSubtreeInFlight:1});
  bound = target(broker);
  assert.equal(broker.admit(actor,bound).status,'BACKPRESSURE_SUBTREE');
  assert.equal(inner.status,'ADMITTED');
  assert.equal(broker.snapshot().inFlight,1);
  assert.equal(broker.complete(actor,inner.ticket),true);
  assert.equal(broker.retire(actor,inner.ticket,true),true);
  assert.equal(broker.snapshot().inFlight,0);
});
