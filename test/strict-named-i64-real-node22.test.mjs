import {readFileSync, statSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
const filename = new URL('../contracts/strict-named-i64-v1.json', import.meta.url);
const bytes=readFileSync(filename);
const min=-(1n<<63n), max=(1n<<63n)-1n;
const manifest=JSON.parse(bytes.toString('utf8'));
const sourceSha='3f65f557f06e8cd0d34a738a0d357d6c2e477665';
const source256='dacca2eaf503f854fd7f60ba135ff31b6c210d90aff8d117d4dedb5b88bedec5';
const sha=b=>createHash('sha256').update(b).digest('hex');
const gitBlob=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const dec=/^(?:0|-?[1-9][0-9]*)$/;
function oracle({operation,left,right}) {
  assert.ok(['rem','mod','pow','bit_xor'].includes(operation));
  assert.match(left, dec);assert.match(right, dec);
  const a=BigInt(left),b=BigInt(right);
  assert.ok(a>=min&&a<=max&&b>=min&&b<=max);
  if(operation==='rem' || operation==='mod'){
    if(b===0n) return {error:'DIVISOR_ZERO'};
    let r=a%b;if(operation==='mod'&&r<0n)r+=(b<0n?-b:b);
    return {value:String(r)};
  }
  if(operation==='bit_xor')return {value:String(BigInt.asIntN(64,a^b))};
  if(b<0n)return {error:'NEGATIVE_EXPONENT'};
  if(a===0n)return {value:b===0n?'1':'0'};
  if(a===1n)return {value:'1'};
  if(a===-1n)return {value:(b&1n)?'-1':'1'};
  let r=1n,base=a,exp=b;
  while(exp>0n){
    if(exp&1n){r*=base;if(r<min||r>max)return {error:'OVERFLOW'};}
    exp >>= 1n;
    if(exp>0n){base*=base;if(base<min||base>max)return {error:'OVERFLOW'};}
  }
  return {value:String(r)};
}
const shaOutput=sha(bytes);
const blobOutput=gitBlob(bytes);
test('canonical signed-i64 contract is byte-for-byte pinned using real Node crypto',()=>{
  const st=lstatSync(filename);assert.equal(st.isFile(),true);assert.equal(st.isSymbolicLink(),false);
  assert.equal(shaOutput,source256);assert.equal(blobOutput,sourceSha);
});
test('the 26 vectors have unique ids and allowed operations',()=>{
  assert.equal(manifest.contract,'oreslang.strict-named-integer-arithmetic.v1');
  assert.equal(manifest.cases.length,26);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,26);
  assert.deepEqual([...new Set(manifest.cases.map(x=>x.operation))],['rem','mod','pow','bit_xor']);
});
test('26/26 named arithmetic results match independent BigInt arithmetic',()=>{
  for(const v of manifest.cases)assert.deepEqual(oracle(v),v.expect,`contract mismatch: ${v.id}`);
});
test('negative error classes represented in the canonical vectors',()=>{
  const errs=manifest.cases.filter(x=>x.expect.error);
  assert.equal(errs.length,4);
  assert.deepEqual([...new Set(errs.map(x=>x.expect.error))].sort(),['DIVISOR_ZERO','NEGATIVE_EXPONENT','OVERFLOW']);
});
test('64-bit endpoints and signed-zero normalization are checked',()=>{
  assert.deepEqual(oracle({operation:'rem',left:String(min),right:'-1'}),{value:'0'});
  assert.deepEqual(oracle({operation:'mod',left:'-1',right:String(min)}),{value:String(max)});
  assert.deepEqual(oracle({operation:'pow',left:'-2',right:'63'}),{value:String(min)});
  assert.deepEqual(oracle({operation:'pow',left:'2',right:'63'}),{error:'OVERFLOW'});
  assert.deepEqual(oracle({operation:'mod',left:'0',right:'-7'}),{value:'0'});
});
test('50,000 seeded full-width rem/mod/xor properties',()=>{
  let x=0x12345678n;
  const rand=()=>{x ^= (x<<13n)&((1n<<64n)-1n);x ^= x>>7n;x ^= (x<<17n)&((1n<<64n)-1n);return BigInt.asIntN(64,x)};
  for(let i=0;i<50_000;i++){
    const a=rand(),b=rand()||1n;
    const rem=BigInt(oracle({operation:'rem',left:String(a),right:String(b)}).value);
    const mod=BigInt(oracle({operation:'mod',left:String(a),right:String(b)}).value);
    assert.equal(rem,a%b);
    assert.equal((a-rem)%b,0n);
    assert.ok(mod>=0n&&mod<(b<0n?-b:b));
    assert.equal((a-mod)%b,0n);
    const xor=BigInt(oracle({operation:'bit_xor',left:String(a),right:String(b)}).value);
    assert.equal(xor,BigInt.asIntN(64,a^b));
    assert.equal(BigInt.asIntN(64,xor^b),a);
  }
});
test('checked exponentiation agrees with independent direct-power oracle',()=>{
  for(let a=-17;a<=17;a++)for(let e=0;e<=31;e++){
    const p=BigInt(a)**BigInt(e);const expected=p<min||p>max?{error:'OVERFLOW'}:{value:String(p)};
    assert.deepEqual(oracle({operation:'pow',left:String(a),right:String(e)}),expected);
  }
});
test('explicit non-promoting evidence boundary',()=>{
  assert.equal(manifest.status,'reference vectors; backends not yet executed');
  assert.ok(!('verifiedBackends' in manifest));
});
console.log(`SOURCE_FREE_NODE22_AUDIT|contract_git_blob=${blobOutput}|sha256=${shaOutput}|vectors=${manifest.cases.length}|backend_execution=NOT_EXECUTED`);
