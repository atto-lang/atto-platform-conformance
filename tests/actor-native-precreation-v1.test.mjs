import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePrecreationModel} from '../models/actor-native-precreation-v1.mjs';

const resource = () => Object.freeze(Object.create(null));

test('precreation denies allocation ahead of any registered handle', () => {
  const m = new NativePrecreationModel(1, 5);
  const first = m.reserve(m.root, 0);
  assert.equal(m.snapshot().registered, 0);
  assert.throws(() => m.reserve(m.root, 0), {code:'CONTEXT_QUOTA'});
  m.abort(first, m.root);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('ancestor handle and declared byte ceilings constrain both siblings', () => {
  const m = new NativePrecreationModel(4, 100);
  const parent = m.scope(m.root, 2, 40);
  const a = m.scope(parent, 1, 40);
  const b = m.scope(parent, 2, 40);
  const unrelated = m.scope(m.root, 2, 100);
  const ticketA = m.reserve(a, 30);
  assert.throws(() => m.reserve(a, 0), {code:'SUBTREE_QUOTA'});
  assert.throws(() => m.reserve(b, 11), {code:'SUBTREE_QUOTA'});
  const ticketB = m.reserve(b, 10);
  assert.throws(() => m.reserve(b, 0), {code:'SUBTREE_QUOTA'});
  const separate = m.reserve(unrelated, 0);
  assert.equal(parent.bytes, 40);
  m.abort(ticketA, a); m.abort(ticketB, b); m.abort(separate, unrelated);
  assert.equal(parent.handles, 0);
  assert.equal(parent.bytes, 0);
});

test('constructor failure returns exactly the original credit', () => {
  const m = new NativePrecreationModel(1, 40);
  const ticket = m.reserve(m.root, 33);
  assert.equal(m.snapshot().accountedBytes, 33);
  m.abort(ticket, m.root);
  assert.equal(m.snapshot().accountedBytes, 0);
  assert.throws(() => m.abort(ticket, m.root), {code:'INVALID_OR_CONSUMED_PERMIT'});
  const reused = m.reserve(m.root, 40);
  m.abort(reused, m.root);
});

test('transfer leaves the original handle quota charged until physical close', () => {
  const m = new NativePrecreationModel(1, 12);
  const ticket = m.reserve(m.root, 12);
  const handle = resource();
  assert.equal(m.attach(ticket, handle, m.root), 'PUBLISHED');
  assert.equal(m.snapshot().pending, 0);
  assert.equal(m.snapshot().handles, 1);
  assert.equal(m.snapshot().accountedBytes, 12);
  assert.throws(() => m.reserve(m.root, 0), {code:'CONTEXT_QUOTA'});
  assert.throws(() => m.abort(ticket, m.root), {code:'INVALID_OR_CONSUMED_PERMIT'});
  assert.equal(m.physicalClose(handle), true);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('stopped actor cannot mint credits; created handle is quarantined', () => {
  const m = new NativePrecreationModel(2, 20);
  const actor = m.scope(m.root, 1, 20);
  const sibling = m.scope(m.root, 1, 20);
  const permit = m.reserve(actor, 20);
  m.stopActor(actor);
  assert.throws(() => m.reserve(actor, 0), {code:'REVOKED_OR_STOPPED'});
  const created = resource();
  assert.equal(m.attach(permit, created, actor), 'QUARANTINED');
  assert.equal(m.snapshot().quarantined, 1);
  assert.equal(m.snapshot().physicallyRetired, false);
  const other = m.reserve(sibling, 0);
  m.abort(other, sibling);
  assert.equal(m.physicalClose(created), true);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('revoking an ancestor quarantines a descendant permit but not siblings', () => {
  const m = new NativePrecreationModel(3, 50);
  const parent = m.scope(m.root, 1, 20);
  const actor = m.scope(parent, 1, 20);
  const unrelated = m.scope(m.root, 1, 10);
  const token = m.reserve(actor, 8);
  m.revoke(parent);
  const handle = resource();
  assert.equal(m.attach(token, handle, actor), 'QUARANTINED');
  assert.throws(() => m.reserve(actor, 0), {code:'REVOKED_OR_STOPPED'});
  const good = m.reserve(unrelated, 1);
  m.abort(good, unrelated);
  m.physicalClose(handle);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('shutdown cannot retire with an untransferred construction ticket', () => {
  const m = new NativePrecreationModel(1, 50);
  const ticket = m.reserve(m.root, 0);
  m.shutdown();
  assert.equal(m.snapshot().physicallyRetired, false);
  assert.equal(m.snapshot().pending, 1);
  assert.throws(() => m.reserve(m.root), {code:'SHUTDOWN'});
  m.abort(ticket, m.root);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('handle created after context STOP stays quarantined until host close', () => {
  const m = new NativePrecreationModel(1, 12);
  const ticket = m.reserve(m.root, 12);
  m.shutdown();
  const created = resource();
  assert.equal(m.attach(ticket, created, m.root), 'QUARANTINED');
  assert.equal(m.snapshot().registered, 1);
  assert.equal(m.snapshot().accountedBytes, 12);
  assert.equal(m.physicalClose(created, false), false);
  assert.equal(m.snapshot().physicallyRetired, false);
  assert.equal(m.physicalClose(created, true), true);
  assert.equal(m.snapshot().physicallyRetired, true);
});

test('cross-context and double-use permit attempts do not credit another host', () => {
  const first = new NativePrecreationModel(1, 1);
  const other = new NativePrecreationModel(1, 1);
  const token = first.reserve(first.root, 0);
  const handle = resource();
  assert.throws(() => other.attach(token, handle, other.root),
    {code:'INVALID_OR_CONSUMED_PERMIT'});
  assert.equal(first.attach(token, handle, first.root), 'PUBLISHED');
  assert.throws(() => first.attach(token, resource(), first.root),
    {code:'INVALID_OR_CONSUMED_PERMIT'});
  assert.throws(() => first.abort(token, first.root), {code:'INVALID_OR_CONSUMED_PERMIT'});
  assert.equal(first.physicalClose(handle), true);
  assert.throws(() => first.physicalClose(handle), {code:'INVALID_OR_RETIRED_RESOURCE'});
  assert.equal(first.snapshot().handles, 0);
  assert.equal(other.snapshot().handles, 0);
});


test('a sibling cannot consume another actor\'s precreation ticket', () => {
  const m = new NativePrecreationModel(3, 40);
  const parent = m.scope(m.root, 2, 30);
  const actorA = m.scope(parent, 1, 20);
  const actorB = m.scope(parent, 1, 20);
  const permit = m.reserve(actorA, 16);
  const created = resource();
  assert.throws(() => m.abort(permit, actorB),
    {code:'FOREIGN_ACTOR_INCARNATION'});
  assert.equal(m.snapshot().pending, 1);
  assert.throws(() => m.attach(permit, created, actorB),
    {code:'FOREIGN_ACTOR_INCARNATION'});
  assert.equal(m.snapshot().pending, 0);
  assert.equal(m.snapshot().registered, 1);
  assert.equal(m.snapshot().quarantined, 1);
  assert.equal(actorA.handles, 1);
  assert.equal(actorB.handles, 0);
  assert.throws(() => m.reserve(actorA, 0), {code:'SUBTREE_QUOTA'});
  assert.equal(m.physicalClose(created, true), true);
  assert.equal(m.snapshot().physicallyRetired, true);
  assert.equal(parent.handles, 0);
  assert.equal(parent.bytes, 0);
});

test('invalid sizes and widened child capabilities are rejected', () => {
  const m = new NativePrecreationModel(2, 10);
  const parent = m.scope(m.root, 1, 5);
  assert.throws(() => m.scope(parent, 2, 5), {code:'WIDENING'});
  assert.throws(() => m.scope(parent, 1, 6), {code:'WIDENING'});
  assert.throws(() => m.reserve(parent, -1), {code:'INVALID_BYTES'});
  assert.throws(() => m.reserve(parent, 1.5), {code:'INVALID_BYTES'});
  assert.throws(() => m.reserve({}, 0), {code:'FORGED_SCOPE'});
  assert.equal(m.snapshot().handles, 0);
});
