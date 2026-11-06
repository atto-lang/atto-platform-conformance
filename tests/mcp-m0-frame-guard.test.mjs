import test from 'node:test';
import assert from 'node:assert/strict';
import {parseM0Frame, M0FrameError} from '../bin/mcp-m0-frame-guard.mjs';
const enc = new TextEncoder();
const parse = (s, opts) => parseM0Frame(enc.encode(s), opts);
const reject = (payload, reason='MALFORMED', options) => assert.throws(() =>
  parseM0Frame(payload instanceof Uint8Array ? payload : enc.encode(payload), options),
  e => e instanceof M0FrameError && e.reason === reason);
const ok = '{"jsonrpc":"2.0","id":"read-1","method":"resources/read","params":{"uri":"atto-dev://runtime/r/tenant/t/process/summary"}}';
test('valid bounded JSON-RPC envelope parsed',()=>assert.equal(parse(ok).method,'resources/read'));
test('blank input rejected',()=>reject('', 'MALFORMED'));
test('frame over 32KiB rejected before parse',()=>reject(' '.repeat(32769), 'OVERFLOW'));
test('exact 32KiB whitespace padding is permitted',()=>assert.equal(parse(ok+' '.repeat(32768-enc.encode(ok).length)).id,'read-1'));
test('truncated UTF-8 is rejected',()=>reject(Uint8Array.from([0x7b,0x22,0xc3]),'MALFORMED'));
test('invalid UTF-8 continuation rejected',()=>reject(Uint8Array.from([0x7b,0xc0,0xaf,0x7d]),'MALFORMED'));
test('leading BOM rejected',()=>reject(Uint8Array.from([0xef,0xbb,0xbf,...enc.encode(ok)])));
test('duplicate top-level key rejected',()=>reject('{"id":1,"id":2}'));
test('duplicate nested key rejected',()=>reject('{"params":{"uri":"a","uri":"b"}}'));
test('escaped duplicate key rejected',()=>reject('{"params":{"uri":"a","\\u0075ri":"b"}}'));
test('duplicate keys in array object rejected',()=>reject('{"items":[{"x":1,"x":2}]}'));
test('different keys remain distinct',()=>assert.deepEqual(parse('{"a":1,"b":2}'),{a:1,b:2}));
test('array root rejected',()=>reject('[]'));
test('primitive root rejected',()=>reject('true'));
test('extra trailing JSON data rejected',()=>reject('{}{}'));
test('invalid escape rejected',()=>reject('{"x":"\\q"}'));
test('unescaped control rejected',()=>reject('{"x":"\n"}'));
test('trailing comma rejected',()=>reject('{"x":1,}'));
test('missing comma rejected',()=>reject('{"x":1 "y":2}'));
test('missing colon rejected',()=>reject('{"x" 1}'));
test('exponent overflow rejected',()=>reject('{"x":1e9999}'));
test('leading-zero number rejected',()=>reject('{"x":01}'));
test('malformed exponent rejected',()=>reject('{"x":1e+}'));
test('nesting depth >12 rejected',()=>reject('{"x":'+ '['.repeat(12)+'0'+']'.repeat(12)+'}', 'OVERFLOW'));
test('nesting depth exactly 12 accepted',()=>assert.equal(parse('{"x":'+'['.repeat(11)+'0'+']'.repeat(11)+'}').x.length,1));
test('malformed option limits denied',()=>reject(enc.encode(ok),'MALFORMED',{maxBytes:-1}));
test('invalid input type denied',()=>assert.throws(()=>parseM0Frame(ok),e=>e.reason==='MALFORMED'));
test('no parser retention of raw sensitive input',()=>{
 const result=parse('{"nested":{"count":1}}');
 assert.equal(result.nested.count,1);
 assert.ok(!Object.hasOwn(result,'rawFrame'));
});

test('long bounded scalar array stays admissible',()=>assert.equal(parse('{"a":['+Array(5000).fill('1').join(',')+']}').a.length,5000));

test('caller cannot raise the 32 KiB frame cap',()=>reject(enc.encode(ok),'MALFORMED',{maxBytes:32769}));
test('caller cannot raise the 12-level nesting cap',()=>reject(enc.encode(ok),'MALFORMED',{maxDepth:13}));
test('a smaller caller frame budget is enforced',()=>reject(enc.encode(ok),'OVERFLOW',{maxBytes:enc.encode(ok).length-1}));
test('a smaller caller nesting budget is enforced',()=>reject('{"x":{"nested":true}}','OVERFLOW',{maxDepth:1}));
test('escaped isolated high surrogate in a value rejected',()=>reject('{"x":"\\ud800"}'));
test('escaped isolated low surrogate in a value rejected',()=>reject('{"x":"\\udc00"}'));
test('escaped isolated high surrogate in a key rejected',()=>reject('{"\\uD800":"v"}'));
test('escaped high surrogate followed by ordinary character rejected',()=>reject('{"x":"\\uD83Chello"}'));
test('escaped valid surrogate pair accepted',()=>assert.equal(parse('{"x":"\\uD83C\\uDF0D"}').x,'🌍'));
test('escaped valid surrogate pair in a key accepted',()=>assert.equal(parse('{"\\uD83C\\uDF0D":1}')['🌍'],1));

test('forged subclass byteLength cannot hide oversized input',()=>{
 class Forged extends Uint8Array { get byteLength() { return 1; } }
 const raw=enc.encode('{"x":"'+ 'A'.repeat(32768) +'"}');
 const forged=new Forged(raw.length); forged.set(raw);
 reject(forged,'OVERFLOW');
});
test('forged subclass byteLength cannot fabricate overflow on a valid frame',()=>{
 class Forged extends Uint8Array { get byteLength() { return 999999; } }
 const raw=enc.encode(ok), view=new Forged(raw.length); view.set(raw);
 assert.equal(parseM0Frame(view).method,'resources/read');
});
test('zero byteLength override cannot hide an actual valid input',()=>{
 class Forged extends Uint8Array { get byteLength() { return 0; } }
 const raw=enc.encode(ok), view=new Forged(raw.length); view.set(raw);
 assert.equal(parseM0Frame(view).id,'read-1');
});
test('forged backing buffer getter does not control admitted view bytes',()=>{
 class Forged extends Uint8Array { get buffer() { return new ArrayBuffer(1); } }
 const raw=enc.encode(ok), view=new Forged(raw.length); view.set(raw);
 assert.equal(parseM0Frame(view).method,'resources/read');
});
test('proxied byte views fail as MALFORMED rather than throwing TypeError',()=>{
 reject(new Proxy(enc.encode(ok),{}),'MALFORMED');
});
test('shared byte views are rejected to avoid concurrent mutation',()=>{
 if (typeof SharedArrayBuffer === 'undefined') return;
 const raw=enc.encode(ok), shared=new Uint8Array(new SharedArrayBuffer(raw.length));
 shared.set(raw);
 reject(shared,'MALFORMED');
});
test('valid offset subarray parses only admitted window',()=>{
 const raw=enc.encode(ok), backing=new Uint8Array(raw.length+8);
 backing.fill(0xff); backing.set(raw,4);
 assert.equal(parseM0Frame(backing.subarray(4,4+raw.length)).id,'read-1');
});
test('oversized backing buffer does not disqualify a bounded subarray',()=>{
 const raw=enc.encode(ok), backing=new Uint8Array(65536);
 backing.set(raw,32769);
 assert.equal(parseM0Frame(backing.subarray(32769,32769+raw.length)).id,'read-1');
});
test('detached byte view fails closed',()=>{
 const view=enc.encode(ok);
 structuredClone(view.buffer,{transfer:[view.buffer]});
 reject(view,'MALFORMED');
});
