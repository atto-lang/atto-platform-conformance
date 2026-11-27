import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {arenaPolicyCases,arenaPolicyBatches} from './arena-policy-differential-v1.mjs';
const MAX=(1n<<63n)-1n, MIN=-(1n<<63n);
function value(s){
 if(s==='true'||s==='false')return s==='true';
 if(s==='(0 - 9223372036854775807 - 1)')return MIN;
 const neg=/^\(0 - ([0-9]+)\)$/.exec(s);
 if(neg)return -BigInt(neg[1]);
 assert.match(s,/^[0-9]+$/);return BigInt(s);
}
test('shared generator identity and nonvacuous independent boundary oracle',()=>{
 const b=readFileSync(new URL('./arena-policy-differential-v1.mjs',import.meta.url));
 assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),'f98055af7bb9b8952664946d2b2a1f3a735dc283');
 const cases=arenaPolicyCases();assert.deepEqual(cases,arenaPolicyCases());
 assert.equal(cases.length,352);
 const counts={quota:0,quota_ok:0,quota_denied:0,retire:0,retire_ok:0,gen:0,gen_ok:0};
 for(const row of cases){
   const call=/^(arena_end_offset|arena_can_free|arena_next_generation)\((.*)\)$/.exec(row.call);
   assert.ok(call);
   const args=call[2].split(', ').map(value),expected=value(row.expected);
   for(const a of args)if(typeof a==='bigint')assert.ok(a>=MIN&&a<=MAX);
   let actual;
   if(call[1]==='arena_end_offset'){
     const [c,n,a,q]=args;
     actual=-1n;
     if(c>=0n&&n>=0n&&q>=c&&a>0n&&(a&(a-1n))===0n){
       const padding=(-c)&(a-1n);
       if(n===0n)actual=c;
       else if(padding<=q-c&&n<=q-c-padding)actual=c+padding+n;
     }
     counts.quota++;counts[actual<0n?'quota_denied':'quota_ok']++;
   }else if(call[1]==='arena_can_free'){
     actual=args[0]===true&&args[1]===true&&args.slice(2).every(n=>n===0n);
     counts.retire++;if(actual)counts.retire_ok++;
   }else{
     const [g,cap]=args;actual=g>0n&&cap>g?g+1n:-1n;
     counts.gen++;if(actual>0n)counts.gen_ok++;
   }
   assert.equal(actual,expected,row.call);
 }
 assert.equal(counts.quota,256);assert.equal(counts.retire,64);assert.equal(counts.gen,32);
 assert.ok(counts.quota_ok>0&&counts.quota_denied>0&&counts.gen_ok>0&&counts.gen_ok<32);
 assert.equal(counts.retire_ok,1);
 const batches=arenaPolicyBatches();
 assert.equal(batches.length,22);assert.equal(batches.reduce((n,x)=>n+x.count,0),352);
 for(const [i,batch] of batches.entries()){assert.equal(batch.start,i*16);assert.equal(batch.count,16);assert.match(batch.source,/return 100;\n}\n$/);}
 console.log('ARENA_DIFFERENTIAL_REFERENCE_COUNTS '+JSON.stringify(counts));
});
