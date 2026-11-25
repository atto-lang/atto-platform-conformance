import test from 'node:test';
import assert from 'node:assert/strict';
import { FourLayoutOracle } from '../verification/dop-four-layout-reference.mjs';

// Host-only adversarial reference-model tests, not compiler-generated AttoLang.
function newStore() {
  return new FourLayoutOracle({owner:'adversarial-actor',fields:['x','y'],capacity:3,layout:'soa'});
}

test('a reentrant accessor cannot consume capacity or publish a second row', () => {
  const store = newStore();
  const malicious = {y:2};
  Object.defineProperty(malicious,'x', {
    enumerable:true, get() {
      store.push({x:999,y:999});
      return 1;
    }
  });
  assert.throws(() => store.push(malicious), /reentrant row admission mutation/);
  assert.equal(store.count,0);
  const safe = store.push({x:11,y:22});
  assert.equal(store.read(safe,'x'),11);
  assert.equal(store.count,1);
});

test('Proxy ownKeys/descriptor traps cannot retire or migrate a store mid-admission', () => {
  for (const operation of ['retire','convert']) {
    const store = newStore();
    const hostile = new Proxy({x:7,y:8}, {
      ownKeys(target) {
        if (operation === 'retire') store.retire();
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        if (operation === 'convert') store.convert('aosoa',{tileWidth:4});
        return Reflect.getOwnPropertyDescriptor(target,property);
      }
    });
    assert.throws(() => store.push(hostile), /reentrant row admission mutation/);
    assert.equal(store.count,0);
    const row = store.push({x:5,y:6});
    assert.equal(store.read(row,'y'),6);
  }
});

test('getter cannot erase, write, borrow, convert or retire during admission', () => {
  const store = newStore();
  const live = store.push({x:4,y:5});
  const denied = [];
  const attempted = [
    () => store.eraseSwap(live),
    () => store.write(live,'x',999),
    () => store.borrow(['y'],'read'),
    () => store.convert('aosoa',{tileWidth:4}),
    () => store.retire(),
    () => store.push({x:12,y:13}),
  ];
  const row = {y:200};
  Object.defineProperty(row,'x',{
    enumerable:true, get() {
      assert.equal(store.read(live,'x'),4,'read-only introspection remains legal');
      for (const change of attempted) {
        assert.throws(change,/reentrant row admission mutation/);
        denied.push(true);
      }
      return 100;
    }
  });
  const accepted = store.push(row);
  assert.equal(denied.length,attempted.length);
  assert.equal(store.count,2);
  assert.equal(store.read(live,'x'),4);
  assert.equal(store.read(accepted,'x'),100);
  assert.equal(store.read(accepted,'y'),200);
  store.eraseSwap(live);
  assert.equal(store.count,1);
  assert.equal(store.read(accepted,'x'),100);
  store.retire();
  assert.throws(() => store.push({x:1,y:2}),/retired store/);
});

test('accessor exceptions clear the admission guard and leave prior rows unchanged', () => {
  const store = newStore();
  const first = store.push({x:9,y:10});
  const malformed = {y:99};
  Object.defineProperty(malformed,'x',{enumerable:true,get(){throw Error('host getter failure');}});
  assert.throws(() => store.push(malformed),/host getter failure/);
  assert.equal(store.count,1);
  assert.equal(store.read(first,'y'),10);
  const second = store.push({x:20,y:21});
  assert.equal(store.read(second,'x'),20);
  assert.equal(store.count,2);
});
