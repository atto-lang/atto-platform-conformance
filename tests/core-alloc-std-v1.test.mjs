import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural/source-only evidence. This harness does not execute Atto guests.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const c = JSON.parse(read('contracts/core-alloc-std-v1.json'));
const ids = ['java','llvm','wasm','rs','net','forge','cranelift','js','atto','hdl'];
const expected = ['EXIT_1','EXIT_1','EXIT_1','COMPILE_IMMUTABLE',
                  'THROWS_BUFFER_BOUNDS','EXIT_1','EXIT_1'];

test('register all backends without inventing guest evidence', () => {
  assert.equal(c.schema, 'atto.core-alloc-std.v1');
  assert.equal(c.status, 'TARGET_NOT_EXECUTED');
  assert.equal(c.source_policy, 'CANONICAL_ATTO_BYTES_ONLY');
  assert.equal(c.release_authorized, false);
  assert.deepEqual(c.layers, ['core','alloc','std']);
  assert.deepEqual(c.backends.map(x=>x.backend), ids);
  for(const b of c.backends){
    assert.equal(b.execution, 'NOT_EXECUTED');
    assert.equal(b.receipt, null);
  }
  assert.equal(c.required_guest_gates.length, 9);
});

test('all seven guest targets are distinct and have declared outcomes', () => {
  assert.equal(c.cases.length, 7);
  const paths = new Set();
  for(let i=0;i<c.cases.length;i++){
    const entry=c.cases[i];
    assert.equal(entry.id,'CAS-'+String(i+1).padStart(3,'0'));
    assert.equal(entry.expected,expected[i]);
    assert.match(entry.source,/^fixtures\/core-alloc-std-v1\/\d\d-[a-z-]+\.atto$/);
    assert.equal(paths.has(entry.source),false);
    paths.add(entry.source);
    const source=read(entry.source);
    assert.ok(source.endsWith('\n') && !source.includes('\r') && !source.startsWith('\uFEFF'));
    assert.match(source,/pub fnc main\(\): int(?: throws Error)? \{/);
    assert.match(source,/import module [a-z]+ from pkg "(?:core|alloc|std)\.[a-z_]+";/);
  }
  assert.match(read(c.cases[2].source),/val mut bytes = region\\.ByteRegion\\.allocate_zeroed\\(4\\);/);
  assert.match(read(c.cases[3].source),/val bytes = region\.ByteRegion\.allocate_zeroed\(2\);/);
  assert.match(read(c.cases[3].source),/bytes\.write_byte\(0, 1\);/);
  assert.match(read(c.cases[4].source),/bytes\.read_byte\(2\)/);
  for(const i of [5,6])assert.match(read(c.cases[i].source),/bytes\.bytes_equal\(left, right\)/);
});

test('independent host BigInt oracle for bounded signed size math (NOT Atto execution)', () => {
  const candidateAdd=(a,b,max)=> a>=0n && b>=0n && max>=0n && a<=max && b<=max-a;
  const candidateMul=(a,b,max)=> a>=0n && b>=0n && max>=0n &&
    (a===0n || b===0n || a<=max/b);
  const refAdd=(a,b,max)=>a>=0n && b>=0n && max>=0n && a+b<=max;
  const refMul=(a,b,max)=>a>=0n && b>=0n && max>=0n && a*b<=max;
  let seed=0x724bf60an;
  const mask=(1n<<63n)-1n;
  for(let i=0;i<40000;i++){
    seed=(seed*6364136223846793005n+1442695040888963407n)&mask;
    const a=seed % 1000000000000n;
    seed=(seed*6364136223846793005n+1442695040888963407n)&mask;
    const b=seed % 1000000000000n;
    seed=(seed*6364136223846793005n+1442695040888963407n)&mask;
    const max=seed % 1000000000000n;
    assert.equal(candidateAdd(a,b,max),refAdd(a,b,max));
    assert.equal(candidateMul(a,b,max),refMul(a,b,max));
  }
  const max=9223372036854775807n;
  assert.equal(candidateAdd(max,1n,max),false);
  assert.equal(candidateMul(max,max,max),false);
  assert.equal(candidateMul(0n,max,max),true);
});
