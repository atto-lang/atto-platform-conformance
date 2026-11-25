import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReplayWindow } from '../lib/media-replay-v1.mjs';

const data = JSON.parse(readFileSync(new URL('../contracts/media-replay-v1-vectors.json', import.meta.url), 'utf8'));
assert.equal(data.contract, 'oreslang.media-replay.vectors/1');
for (const fixture of data.cases) {
  test(`portable media replay vector: ${fixture.name}`, () => {
    const window = new ReplayWindow({ streamId: 'vector-stream', generation: 1, capacityBytes: fixture.capacityBytes });
    for (const action of fixture.operations) {
      let result;
      if (action.op === 'append') {
        result = window.append({ sequence: action.sequence, offset: action.offset,
          bytes: Uint8Array.from(action.bytes), codecConfigId: action.codecConfigId ?? 'codec-1',
          randomAccess: action.randomAccess ?? false });
      } else if (action.op === 'ack') {
        result = window.acknowledge({ streamId: 'vector-stream', generation: action.generation ?? 1,
          sequence: action.sequence, endOffset: action.endOffset });
      } else if (action.op === 'resume') {
        result = window.resume({ streamId: 'vector-stream', generation: action.generation ?? 1,
          lastAppliedSequence: action.lastAppliedSequence, lastAppliedEndOffset: action.lastAppliedEndOffset,
          codecConfigId: action.codecConfigId ?? 'codec-1' });
      } else if (action.op === 'fence') {
        result = window.fence(action.newGeneration);
      } else {
        assert.fail(`unknown operation ${action.op}`);
      }
      if (action.expect.ok === true) {
        assert.equal(result.ok, true, JSON.stringify(action));
        if (action.expect.mode) {
          assert.equal(result.value.mode, action.expect.mode);
          assert.deepEqual(result.value.chunks.map(item => item.sequence), action.expect.sequences);
        }
      } else {
        assert.deepEqual(result, { ok: false, error: { code: action.expect.code } });
      }
    }
  });
}
