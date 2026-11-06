import test from 'node:test';
import assert from 'node:assert/strict';
import {parseM0Frame, M0FrameError} from '../bin/mcp-m0-frame-guard.mjs';

// Deterministic, source-free policy fuzzing: NOT compiler/guest, transport or
// real Actions evidence. Keep counts modest for regular Node CI execution.
const SEED=0x35e9b6a1;
function prng(seed=SEED) {
  let state=seed;
  return () => { state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0; };
}
const encoder=new TextEncoder();
function corpusValue(random,depth=0) {
  const choose=n=>random()%n;
  const kind=choose(depth>=4?4:6);
  if(kind===0)return null;
  if(kind===1)return choose(2)===1;
  if(kind===2)return choose(1000000)-500000;
  if(kind===3)return `value_${choose(1e8)}_\u00e9_\u6f22`;
  if(kind===4)return Array.from({length:choose(8)},()=>corpusValue(random,depth+1));
  const obj={};for(let i=0,n=choose(8);i<n;i++)obj[`k_${choose(1000)}`]=corpusValue(random,depth+1);
  return obj;
}
test('seeded 1024 within-budget nested JSON envelopes agree with JSON.parse',()=>{
  const random=prng();
  for(let i=0;i<1024;i++) {
    const raw=JSON.stringify({jsonrpc:'2.0',id:i,params:{data:corpusValue(random)}});
    const frame=encoder.encode(raw);
    assert.ok(frame.length<=32768,'fuzz corpus outside bounded frame');
    assert.deepEqual(parseM0Frame(frame),JSON.parse(raw),`seed=${SEED}, case=${i}`);
  }
});
test('seeded 1024 mutated frames fail with stable error or parse identically',()=>{
  const random=prng(SEED^0x7e5b9c21);
  const original=encoder.encode('{"jsonrpc":"2.0","id":1,"params":{"nested":{"ok":true},"data":"text"}}');
  let rejected=0,admitted=0;
  for(let i=0;i<1024;i++) {
    const frame=Uint8Array.from(original);
    frame[random()%frame.length]=random()%256;
    try {
      const got=parseM0Frame(frame);
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(frame);
      assert.deepEqual(got,JSON.parse(raw),`seed=${SEED}, case=${i}`);
      admitted++;
    } catch(e) {
      if(e instanceof M0FrameError) rejected++;
      else throw e;
    }
  }
  assert.equal(admitted+rejected,1024);
  assert.ok(rejected>0,'mutations must exercise the deny path');
});
