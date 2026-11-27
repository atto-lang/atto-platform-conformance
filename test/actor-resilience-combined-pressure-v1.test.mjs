import test from 'node:test';
import assert from 'node:assert/strict';
import {model} from '../src/actor-resilience-lifecycle-v1.mjs';

function* permutations(items) {
  if (items.length === 0) { yield []; return; }
  for (let i = 0; i < items.length; i++) {
    for (const tail of permutations(items.filter((_, j) => j !== i))) {
      yield [items[i], ...tail];
    }
  }
}

// This is a sequential oracle only, not a backend executor or physical proof.
for (const primary of ['stack_quota', 'arena_quota']) {
  test(`combined pressure preserves retirement order: ${primary}`, () => {
    let sequences = 0;
    for (const order of permutations(['cleanup', 'io', 'receive', 'retire', 'notice', 'restart'])) {
      const a = model({limit: 8, arenaLimit: 8, unwindReserve: 2, restarts: 1});
      const b = model();
      assert.equal(a.admit('receive', 6, 1), true);
      assert.equal(a.suspend('receive'), true);
      assert.equal(a.startIo('native_io', 'receive', 1), true);
      assert.equal(a.allocate(8), true);
      a.fillData();
      assert.equal(a.admit('over_stack', 1, 1), false);
      assert.equal(a.allocate(1), false);
      assert.equal(a.fault(primary), true);
      assert.equal(a.fault('secondary'), false);
      let ioDone = false, receiveDone = false, retired = false, notified = false, restarted = false;
      for (const operation of order) {
        switch (operation) {
          case 'cleanup':
            assert.equal(a.cleanup(3), false);
            if (!retired) assert.equal(a.snapshot().incomplete, true);
            break;
          case 'io':
            assert.equal(a.finishIo('native_io', 1), true);
            ioDone = true;
            break;
          case 'receive':
            assert.equal(a.finish('receive', 1), ioDone);
            receiveDone = ioDone;
            break;
          case 'retire':
            assert.equal(a.retire(), receiveDone);
            retired = receiveDone;
            break;
          case 'notice':
            assert.equal(a.notice(), retired);
            notified = retired;
            break;
          case 'restart':
            assert.equal(a.restart(), notified);
            restarted = notified;
            break;
        }
        const s = a.snapshot();
        assert.equal(s.certified, false);
        assert.equal(s.dataFull, true);
        assert.equal(s.primary, restarted ? null : primary);
        assert.equal(s.generation, restarted ? 2 : 1);
        assert.equal(s.arena, retired ? 0 : 8);
        if (!restarted) assert.equal(a.admit('forbidden', 1, 1), false);
      }
      // Complete any operations that were attempted too early.
      if (!receiveDone) assert.equal(a.finish('receive', 1), true);
      if (!retired) assert.equal(a.retire(), true);
      if (!notified) assert.equal(a.notice(), true);
      if (!restarted) assert.equal(a.restart(), true);
      assert.equal(a.admit('receive', 6, 2), true);
      assert.equal(a.startIo('native_io', 'receive', 2), true);
      assert.equal(a.finishIo('native_io', 1), false);
      assert.equal(a.finish('receive', 1), false);
      assert.equal(a.finish('receive', 2), false);
      assert.equal(a.finishIo('native_io', 2), true);
      assert.equal(a.finish('receive', 2), true);
      assert.equal(a.fault(primary), true);
      assert.equal(a.retire(), true);
      assert.equal(a.notice(), true);
      assert.equal(a.restart(), false);
      // Sibling probe occurs AFTER second retirement and budget exhaustion.
      assert.equal(b.admit('sibling_post_fault', 1, 1), true);
      assert.equal(b.finish('sibling_post_fault', 1), true);
      assert.equal(b.snapshot().state, 'running');
      sequences++;
    }
    assert.equal(sequences, 720);
  });
}
