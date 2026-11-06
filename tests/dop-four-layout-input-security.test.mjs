// Source-free numerical reference regression only: NOT a compiled AttoLang guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FourLayoutOracle} from '../verification/dop-four-layout-reference.mjs';

function create(layout) {
  const options = layout === 'aosoa' ? {tileWidth: 2} :
    layout === 'soaos' ? {groups: [['x'], ['y']]} : {};
  return new FourLayoutOracle({
    owner: 'tenant-a/actor-1', fields: ['x', 'y'], capacity: 4, layout,
    ...options
  });
}

for (const layout of ['aos', 'soa', 'aosoa', 'soaos']) {
  test(layout + ': untrusted row getters cannot bypass loan/retirement checks', () => {
    const store = create(layout);
    const first = store.push({x: 1, y: 2});
    let getterCalls = 0;
    const input = {y: 6};
    Object.defineProperty(input, 'x', {enumerable: true, get() {
      getterCalls++;
      for (const operation of [
        () => store.borrow(['x'], 'write'),
        () => store.push({x: 70, y: 80}),
        () => store.write(first, 'x', 75),
        () => store.read(first, 'x'),
        () => store.convert('soa'),
        () => store.retire()
      ]) assert.throws(operation, /reentrant/);
      return 5;
    }});
    const second = store.push(input);
    assert.equal(getterCalls, 1);
    assert.equal(store.count, 2);
    assert.equal(store.read(first, 'x'), 1);
    assert.equal(store.read(second, 'x'), 5);
    assert.equal(store.read(second, 'y'), 6);

    for (const hidden of ['hidden', Symbol('hidden')]) {
      const extra = {x: 3, y: 4};
      Object.defineProperty(extra, hidden, {value: 99, enumerable: false});
      assert.throws(() => store.push(extra), /record schema mismatch/);
      assert.equal(store.count, 2);
    }
    assert.throws(() => store.push({x: 7, get y() {
      throw new Error('poisoned row getter');
    }}), /poisoned row getter/);
    assert.equal(store.count, 2);
    assert.equal(store.read(first, 'y'), 2);

    const requested = ['x'];
    Object.defineProperty(requested, '0', {enumerable: true, get() {
      assert.throws(() => store.retire(), /reentrant/);
      return 'x';
    }});
    const loan = store.borrow(requested, 'read');
    assert.equal(loan.read(first, 'x'), 1);
    loan.release();

    // A malicious array iterator must not be executed merely to snapshot
    // field names. A bounded indexed read is sufficient for this API.
    const iteratorTrap = ['x'];
    let iteratorCalls = 0;
    Object.defineProperty(iteratorTrap, Symbol.iterator, { value() {
      iteratorCalls++;
      throw new Error('untrusted iterator executed');
    }});
    const indexedLoan = store.borrow(iteratorTrap, 'read');
    assert.equal(indexedLoan.read(first, 'x'), 1);
    indexedLoan.release();
    assert.equal(iteratorCalls, 0);

    store.convert('soaos', {get groups() {
      assert.throws(() => store.borrow(['x'], 'write'), /reentrant/);
      assert.throws(() => store.write(first, 'y', 100), /reentrant/);
      return [['x'], ['y']];
    }});
    assert.equal(store.read(first, 'x'), 1);
    assert.equal(store.read(second, 'y'), 6);
    store.retire();
    assert.throws(() => store.read(first, 'x'), /retired/);
  });
}
