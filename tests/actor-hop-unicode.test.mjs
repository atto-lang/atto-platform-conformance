import test from 'node:test';
import assert from 'node:assert/strict';
import {createActorHopTrace,appendActorHop,snapshotActorHops} from '../lib/actor-hop-trace.mjs';

const base = {actor:'Worker',handler:'receive',kind:'receive'};
const forbidden = ['\u061c','\u200b','\u200e','\u200f','\u2060','\ufeff','\u202e','\ud800','\udc00','x\ud800y','x\udc00y'];
for (const field of ['actor','handler','generation']) {
  test(`${field} rejects unicode bidi/invisible format marks and lone surrogate code units`,()=>{
    for (const token of forbidden) {
      const input={...base,[field]:`A${token}B`};
      assert.throws(()=>appendActorHop(createActorHopTrace(),input),TypeError);
    }
  });
}

test('logical source unit rejects invalid unicode, retains valid nonascii names',()=>{
  for (const unit of ['src/evil\u200e.ores','src/\ud800.ores','src/evil\ufeff.ores']) {
    assert.throws(()=>appendActorHop(createActorHopTrace(), {...base,source:{unit,line:1,column:1}}),TypeError);
  }
  const trace=appendActorHop(createActorHopTrace(),{
    actor:'Gérant🙂',handler:'répondre',generation:'vØ',kind:'receive',
    source:{unit:'pkg/café.ores',line:5,column:8},
  });
  assert.equal(snapshotActorHops(trace).entries[0].actor,'Gérant🙂');
});
