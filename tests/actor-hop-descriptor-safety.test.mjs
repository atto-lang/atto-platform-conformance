import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorHopTrace, appendActorHop, snapshotActorHops} from '../lib/actor-hop-trace.mjs';

test('metadata admission uses own data descriptors, never Proxy property getters', () => {
  let reads = 0;
  const onlyDescriptors = value => new Proxy(value, {
    get() {
      reads++;
      throw new Error('untrusted Proxy get trap was executed');
    }
  });
  const source = onlyDescriptors({unit: 'pkg/actor.ores', line: 12, column: 3});
  const hop = onlyDescriptors({
    actor: 'Worker', handler: 'run', kind: 'receive', source, generation: 'v1'
  });
  const options = onlyDescriptors({layout: 'aosoa', capacity: 5, blockSize: 2});
  const ctx = appendActorHop(createActorHopTrace(options), hop);
  assert.equal(reads, 0);
  assert.deepEqual(snapshotActorHops(ctx).entries[0], {
    actor: 'Worker', handler: 'run', kind: 'receive',
    source: {unit: 'pkg/actor.ores', line: 12, column: 3},
    generation: 'v1', redacted: false
  });
});

test('descriptor snapshot resists mutation between field validation and rendering', () => {
  const input = {actor:'Trusted', handler:'handle', kind:'forward'};
  const ctx = createActorHopTrace();
  const captured = appendActorHop(ctx, input);
  input.actor = 'Changed';
  input.handler = 'replaced';
  assert.equal(snapshotActorHops(captured).entries[0].actor, 'Trusted');
  assert.equal(snapshotActorHops(captured).entries[0].handler, 'handle');
  assert.equal(snapshotActorHops(ctx).entries.length, 0);
});

test('accessors and unlisted symbol keys fail closed without invoking getters', () => {
  let invoked = false;
  const malicious = {actor:'A', handler:'B', kind:'receive'};
  Object.defineProperty(malicious, 'actor', {
    enumerable:true, get() {invoked = true; throw Error('must not run');}
  });
  assert.throws(() => appendActorHop(createActorHopTrace(), malicious), TypeError);
  assert.equal(invoked, false);
  assert.throws(() => createActorHopTrace({[Symbol('extra')]:true}), TypeError);
});
