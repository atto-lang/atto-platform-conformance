import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const root = new URL('../fixtures/named-recursive-fnc-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const source = id => readFileSync(new URL(id + '.atto', root), 'utf8');
const blob = s => createHash('sha1').update('blob ' + Buffer.byteLength(s) + '\0').update(s).digest('hex');
function fib(n) {
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) [a,b] = [b,a+b];
  return a;
}
const max = (1n << 63n) - 1n;
test('exact source identity and unexecuted status', () => {
  assert.equal(manifest.status, 'CANDIDATE_SOURCE_NOT_EXECUTED');
  assert.equal(manifest.cases.length, 9);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, 9);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, 9);
  for (const c of manifest.cases) {
    assert.match(c.path, /^[a-z0-9-]+\.atto$/);
    assert.equal(c.path, c.id + '.atto');
    assert.equal(blob(source(c.id)), c.blob, c.id);
    assert.equal(c.status, 'not_executed');
  }
  assert.deepEqual(Object.keys(manifest.backendResults).sort(), ['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','rs-browser','wasm-independent'].sort());
  for (const s of Object.values(manifest.backendResults)) assert.equal(s, 'not_executed');
});
test('full-width independent Fibonacci oracle and checked overflow boundary', () => {
  const expected = {'fib-55-exact':'139583862445','fib-0':'0','fib-1':'1','fib-10':'55','fib-10-explicit-semicolon':'55','fib-55-linear':'139583862445','fib-92-linear':'7540113804746346429'};
  for (const [id,value] of Object.entries(expected)) {
    const c = manifest.cases.find(c => c.id === id);
    assert.deepEqual(c.expected, {kind:'value',value});
    assert.equal(fib(c.input).toString(), value);
    assert.ok(fib(c.input) <= max);
  }
  const overflow = manifest.cases.find(c => c.id === 'fib-93-overflow');
  assert.equal(overflow.input,93);
  assert.deepEqual(overflow.expected,{kind:'error',code:'ArithmeticOverflowError'});
  assert.ok(fib(92) <= max && fib(93) > max);
  assert.equal(fib(93),12200160415121876738n);
  assert.notEqual(fib(55),fib(55) & 255n);
});
test('exact requested syntax and bounded smoke variants', () => {
  const exact = 'pub fnc main(): int {\n    return 55 |> fnc fib(int v): int {\n        ^ match v over\n            on 0 -> 0,\n            on 1 -> 1,\n            on _ -> fib(v - 2) + fib(v - 1)\n        end\n    };\n}\n';
  assert.equal(source('fib-55-exact'),exact);
  for (const n of [0,1,10]) assert.equal(source('fib-'+n),exact.replace('55 |> ',n+' |> '));
  assert.equal(source('fib-10-explicit-semicolon'),source('fib-10').replace('        end\n','        end;\n'));
  assert.deepEqual(manifest.cases.filter(c=>c.tier==='extended').map(c=>c.id),['fib-55-exact']);
  assert.equal(manifest.cases.filter(c=>c.tier==='smoke').length,8);
  for (const n of [55,92,93]) {
    const s=source(n===93?'fib-93-overflow':'fib-'+n+'-linear');
    assert.ok(s.includes('return '+n+' |> fnc fib(int v): int'));
    assert.ok(s.includes('on 1 -> b,'));
    assert.ok(s.includes('step(n - 1, b, a + b)'));
  }
  assert.deepEqual(manifest.cases.find(c=>c.id==='fib-name-does-not-escape').expected,{kind:'reject',code:'unresolved_callable'});
  assert.match(source('fib-name-does-not-escape'),/};\s*return fib\(value\);/);
});
