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
