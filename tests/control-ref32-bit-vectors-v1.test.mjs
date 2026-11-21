import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../contracts/control-ref32-bit-vectors-v1.json', import.meta.url), 'utf8'));
const originalBackends = 'atto net hdl java realtime rs llvm js forge wasm cranelift'.split(' ');
function inspect(m) {
  assert.equal(m.schema, 'atto.control-ref32-bit-vectors.v1');
  assert.equal(m.status, 'HOST_MODEL_ONLY_NO_COMPILED_GUEST');
  assert.equal(m.control_abi, 'control_generation12_slot20_v1');
  assert.equal(m.storage_bits, 32);
  assert.equal(m.slot_bits, 20);
  assert.equal(m.generation_bits, 12);
  assert.equal(m.slot_bits + m.generation_bits, m.storage_bits);
  assert.equal(m.slot_plus_one_limit, 1048575);
  assert.equal(m.maximum_generation, 4095);
  assert.equal(m.null_word, '0');
  assert.equal(m.numeric_words_are_not_authority, true);
  assert.deepEqual(m.backends_not_compiled_guest_verified, originalBackends);
  assert.deepEqual(m.actor_abi_nonaliases, ['offset8_plus_one', 'generation20_slot12',
    'generation16_slot16', 'control_generation20_slot12_v1']);
  const seen = new Set();
  assert.equal(m.positive.length, 6);
  for (const v of m.positive) {
    assert(Number.isSafeInteger(v.slot_index) && v.slot_index >= 0 && v.slot_index < 1048575);
    assert(Number.isSafeInteger(v.generation) && v.generation >= 1 && v.generation <= 4095);
    const value = Number(v.word);
    assert(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff);
    assert.equal(value, v.generation * 1048576 + v.slot_index + 1);
    assert.equal(value % 1048576, v.slot_index + 1);
    assert.equal(Math.floor(value / 1048576), v.generation);
    assert(!seen.has(value)); seen.add(value);
  }
  assert.deepEqual(m.positive.map(v => v.word), [
    '1048577','1048578','2147483649','4294967295','2097151','4293918721']);
  assert.deepEqual(m.invalid_words, ['1','1048576','2147483648','4294967296','-1','1.5']);
  for (const word of m.invalid_words) {
    const n = Number(word);
    assert(!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff ||
      n % 1048576 === 0 || n < 1048576);
  }
  assert.deepEqual(m.invalid_fields, [
    {slot_index:1048575,generation:1}, {slot_index:-1,generation:1},
    {slot_index:0,generation:0}, {slot_index:0,generation:4096}]);
}
test('six canonical unsigned control words match all 11 tracked backend ABIs',()=>inspect(manifest));
test('cannot claim guest pass, change ABI name, or omit bootstrap backends',()=>{
  for (const [key,value] of [
    ['status','PASSED'], ['control_abi','generation16_slot16'],
    ['numeric_words_are_not_authority',false]]) {
    const m=structuredClone(manifest);m[key]=value;assert.throws(()=>inspect(m));
  }
  const m=structuredClone(manifest);m.backends_not_compiled_guest_verified.pop();assert.throws(()=>inspect(m));
});
test('cannot silently widen slot/generation or change high-bit vectors',()=>{
  for (const [key,value] of [['slot_bits',16],['generation_bits',16],['slot_plus_one_limit',65535]]) {
    const m=structuredClone(manifest);m[key]=value;assert.throws(()=>inspect(m));
  }
  const changed=structuredClone(manifest);changed.positive[2].word='2147483648';assert.throws(()=>inspect(changed));
});
