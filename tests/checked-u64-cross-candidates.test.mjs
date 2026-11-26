import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// Local focused evidence. Never download source or count a skipped lane as a pass.
const pins={JS:'f4a354096cf2ae1ca96c1381d2be72bca2425ca8',LLVM:'f7bf08fc2ccd46116fe69359ef047f08068f04bd',FORGE:'f7bf08fc2ccd46116fe69359ef047f08068f04bd',JAVA:'02037fb8fd3b4056fc9eab4d75b51e95d03dd65b'};
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const MAX=(1n<<64n)-1n;
const rows=[
  [MAX,1n,1n<<63n,'-'],[4294967295n,4294967297n,0n,'+'],[MAX,0n,MAX,'+'],
  [4294967296n,4294967296n,0n,'*'],[0n,1n,1n,'-'],[MAX,2n,MAX,'-']
].map(([a,b,c,op])=>{
  const p=a*b,v=op==='+'?p+c:op==='-'?p-c:p*c;
  return {expected:p>MAX||v>MAX||v<0n?'overflow':v.toString(),source:`pub fnc main(): uint {return consume(product(${a},${b}),${c});} fnc consume(uint x,u64 y):u64 {return x${op}y;} fnc product(u64 x,uint y):uint {return x*y;}`};
});
const g=e=>`pub fnc main():u64{return ${e};}`;
const negatives=[g('18446744073709551616'),g('01'),g('-1'),g('1/2'),g('x'),g('main()'),g('f(1)')+'fnc f():u64{return 1;}',g('1')+'fnc f(int x):u64{return 1;}',g('1')+g('2'),g('1')+'\u202e',g('1')+'\0',g('('.repeat(40)+'1'+')'.repeat(40))];
test('new independent boundary inventory',()=>{
  assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.expected==='overflow').length,3);assert.equal(negatives.length,12);
});
const mode=process.env.ATTO_U64_CROSS_REQUIRED;
assert.ok(mode===undefined||mode==='0'||mode==='1','ATTO_U64_CROSS_REQUIRED must be 0 or 1');
const required=mode==='1';
const paths=Object.fromEntries(Object.keys(pins).map(k=>[k,process.env[`ATTO_U64_${k}_SOURCE`]]));
test('exact candidate cross-compiler execution and refusal',{
  skip:!required&&!Object.values(paths).some(Boolean)?'NOT_EXECUTED: source paths unavailable':false,timeout:180000
},async t=>{
  const root=mkdtempSync(join(tmpdir(),'atto-cross-u64-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const files={JS:'compiler.mjs',LLVM:'llvm.cpp',FORGE:'forge.cpp',JAVA:'CheckedU64.java'};
  for(const [role,pin] of Object.entries(pins)){
    assert.ok(paths[role],role+': exact source required');
    const bytes=readFileSync(resolve(paths[role]));assert.equal(blob(bytes),pin,role);writeFileSync(join(root,files[role]),bytes);
  }
  const run=(cmd,args,input)=>spawnSync(cmd,args,{input,encoding:'utf8',cwd:root,timeout:30000,maxBuffer:1024*1024});
  function ok(r){assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout;}
  const clangxx=process.env.CLANGXX??'clang++',clang=process.env.CLANG??'clang';
  for(const role of ['LLVM','FORGE'])ok(run(clangxx,['-std=c++20','-O2','-Wall','-Wextra','-Werror',files[role],'-o',role.toLowerCase()]));
  ok(run('javac',['-Xlint:all','-Werror','CheckedU64.java']));
  writeFileSync(join(root,'observe.c'),'#include <stdint.h>\n#include <inttypes.h>\n#include <stdio.h>\nextern uint64_t atto_guest_main(void);\nint main(void){printf("%" PRIu64 "\\n",atto_guest_main());return 0;}\n');
  const {compileCheckedU64ScalarV1:js}=await import(pathToFileURL(join(root,'compiler.mjs')).href);
  const lower={LLVM:s=>run(join(root,'llvm'),['--emit=llvm'],s),FORGE:s=>run(join(root,'forge'),['--emit=cpp'],s),JAVA:s=>run('java',['-cp',root,'CheckedU64'],s)};
  function observe(r,want,role){
    assert.ifError(r.error);
    if(want!=='overflow'){assert.equal(ok(r),want+'\n');assert.equal(r.stderr,'');return;}
    assert.equal(r.stdout,'');
    if(role==='LLVM')assert.ok(['SIGILL','SIGTRAP'].includes(r.signal));
    else{assert.equal(r.signal,null);assert.equal(r.status,70);assert.equal(r.stderr,'E_U64_OVERFLOW\n');}
  }
  for(const role of Object.keys(pins))await t.test(role,async()=>{
    for(const row of rows){
      if(role==='JS'){
        const main=(await import('data:text/javascript,'+encodeURIComponent(js(row.source)))).main;
        if(row.expected==='overflow')assert.throws(()=>main(),e=>e instanceof RangeError&&e.code==='integer_overflow');
        else assert.equal(main(),BigInt(row.expected));
      }else{
        const output=ok(lower[role](row.source));
        if(role==='LLVM'){
          writeFileSync(join(root,'guest.ll'),output);ok(run(clang,['-Wno-override-module','-O2','guest.ll','observe.c','-o','guest']));
          observe(run(join(root,'guest'),[]),row.expected,role);
        }else if(role==='FORGE'){
          writeFileSync(join(root,'guest.cpp'),output);ok(run(clangxx,['-std=c++20','-O2','-Wall','-Wextra','-Werror','guest.cpp','-o','guest']));
          observe(run(join(root,'guest'),[]),row.expected,role);
        }else{
          writeFileSync(join(root,'AttoGuest.java'),output);ok(run('javac',['-Xlint:all','-Werror','AttoGuest.java']));
          observe(run('java',['-Xint','-cp',root,'AttoGuest']),row.expected,role);
        }
      }
    }
    for(const source of negatives){
      if(role==='JS')assert.throws(()=>js(source),/E_U64_PROFILE/);
      else{const r=lower[role](source);assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.match(r.stderr,/E_U64_PROFILE/);}
    }
    assert.equal(blob(readFileSync(join(root,files[role]))),pins[role]);assert.equal(blob(readFileSync(resolve(paths[role]))),pins[role]);
  });
});
