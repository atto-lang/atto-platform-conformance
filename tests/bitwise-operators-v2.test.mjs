import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const m=JSON.parse(readFileSync(new URL('contracts/bitwise-operators-v2.json',root)));
const outcomes={'signed-right':'guest-42','bit-patterns':'guest-42','invalid-literal':'invalid-shift-count','invalid-computed':'runtime-shift-count','invalid-boolean':'compile-type-reject'};
test('canonical bitwise contract pins the five source bytes and all target lanes',()=>{
 assert.equal(m.schema,'atto.bitwise-operators.v2');
 assert.equal(m.supersedes,'contracts/bitwise-operators-v1.json');
 assert.equal(m.spec_blob,'1cd08cbae07da5788735b50d3f1f790ad04a9c48');
 assert.deepEqual(m.semantics,{width_bits:64,binary_xor:'^^',xor_assignment:'^^=',caret:'return-alias',shift_count_min:0,shift_count_max:63,invalid_count:'checked-reject-not-mask',shift_ops:['<<<','>>>','ashr']});
 assert.equal(m.cases.length,5); assert.equal(new Set(m.cases.map(c=>c.id)).size,5);
 for(const c of m.cases){
  assert.equal(c.outcome,outcomes[c.id]);assert.equal(c.path,'fixtures/bitwise-v2/'+c.id+'.atto');
  const b=readFileSync(new URL(c.path,root));
  assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),c.git_blob_sha);
 }
 assert.deepEqual(Object.keys(m.backend_status),['java','llvm','forge','rs','cranelift','net','wasm','js','hdl','realtime','atto']);
 assert.ok(Object.values(m.backend_status).every(x=>x==='NOT_EXECUTED'));
});
function reference(a,n,op){
 if(n<0n||n>63n)throw new RangeError('invalid shift count');
 const factor=2n**n, modulus=2n**64n, wrap=x=>BigInt.asIntN(64,x);
 if(op==='<<<')return wrap(a*factor);
 if(op==='>>>')return wrap(BigInt.asUintN(64,a)/factor);
 const q=a/factor;return a<0n&&a%factor!==0n?q-1n:q;
}
test('independent reference rejects invalid counts and distinguishes sign fill from zero fill',()=>{
 for(const n of [-9223372036854775808n,-1n,64n,65n,9223372036854775807n])for(const op of m.semantics.shift_ops)assert.throws(()=>reference(-9n,n,op),RangeError);
 for(const n of [0n,1n,31n,63n]){assert.equal(reference(-1n,n,'ashr'),-1n);assert.equal(reference(-1n,n,'>>>'),BigInt.asIntN(64,(1n<<(64n-n))-1n));assert.equal(reference(1n,n,'<<<'),BigInt.asIntN(64,1n<<n));}
 assert.equal(reference(-9n,1n,'ashr')+47n,42n);
 assert.equal(reference(-1n,63n,'>>>')+reference(1n,3n,'<<<')+(12n^10n)+27n,42n);
});
