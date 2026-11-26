import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const m=JSON.parse(readFileSync('contracts/copy-readonly-sharing-v1.json','utf8'));
const files=new Map(m.fixtures.map(f=>[f.id,f]));
const source=f=>readFileSync(f.path,'utf8');
test('all eleven compiler repositories, no premature certification',()=>{
  assert.equal(m.backend_count,11);
  assert.deepEqual(m.backends.map(b=>b.repo.split('.').at(-1)).sort(),['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm']);
  assert.equal(m.full_parity,false);
  for(const b of m.backends){assert.equal(b.guest_status,'NOT_EXECUTED');assert.equal(b.receipt,null);}
});
test('exact fixture registry and matched rejection controls',()=>{
  assert.equal(files.size,m.fixtures.length);
  assert.deepEqual(m.fixtures.map(f=>f.path.split('/').at(-1)).sort(),readdirSync('fixtures/copy-readonly-sharing-v1').sort());
  for(const f of m.fixtures){
    assert.equal(f.status,'NOT_EXECUTED');
    const s=source(f);
    assert.match(s,/copy! a;/);
    if(!f.expect.compile_reject){assert.ok(Number.isSafeInteger(f.expect.main_result));assert.match(s,/pub fnc main\(\): int/);assert.doesNotMatch(s,/stdio\./);continue;}
    const p=files.get(f.paired_positive);
    assert.ok(p&&Object.hasOwn(p.expect,'main_result'));
    const a=s.split('\n'),b=source(p).split('\n');
    assert.equal(a.length,b.length);
    assert.deepEqual(a.flatMap((line,i)=>line!==b[i]?[i+1]:[]),[f.diagnostic_line]);
    assert.equal(a[f.diagnostic_line-1].trim(),f.forbidden_statement);
    assert.match(f.expect.compile_reject,/^E_COPY_READONLY(?:_SLOT)?$/);
  }
});

test('separate replacement from loan recovery and cover additions symmetrically',()=>{
  for(const [id,owner,other] of [['replace-copy','b','a'],['replace-original','a','b']]){
    const s=source(files.get(id));
    assert.ok(s.includes(owner+'.scores = new Scores();'));
    assert.ok(s.includes(owner+'.scores.n = 22;'));
    assert.ok(!s.includes(other+'.scores.n ='));
    assert.equal(files.get(id).expect.main_result,42);
  }
  const fresh=source(files.get('fresh-map-entries'));
  for(const [root,key,foreign] of [['a','left','right'],['b','right','left']]){
    assert.equal(fresh.split(root+'["'+key+'"] =').length-1,2);
    assert.ok(fresh.includes(root+'.get("'+foreign+'").is_some()'));
    const reject=files.get('reject-shared-map-insert-'+root);
    assert.equal(reject.paired_positive,'shared-map-control');
    assert.equal(reject.forbidden_statement,root+'.scores["new"] = 99;');
  }
});
