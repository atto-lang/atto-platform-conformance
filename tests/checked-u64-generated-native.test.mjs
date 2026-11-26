import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const PIN='752d1ad3fb3564eed9067a0a530eb2150d1c14b4';
const mode=process.env.ATTO_U64_GENERATED_NATIVE_REQUIRED;
assert.ok(mode===undefined||mode==='0'||mode==='1','ATTO_U64_GENERATED_NATIVE_REQUIRED must be 0 or 1');
const backend=process.env.ATTO_U64_NATIVE_BACKEND??'llvm';
assert.ok(['llvm','forge'].includes(backend),'invalid native backend');
const path=backend==='llvm'?process.env.ATTO_U64_LLVM_SOURCE:process.env.ATTO_U64_FORGE_SOURCE;
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
// Same deterministic source corpus as JS #230 (cbaa344006d453fb043126303d50d64fff6daa28).
const MAX=(1n<<64n)-1n;
const M=0xffffffffn;
let state=0x9e3779b97f4a7c15n;
function next(){state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;}
const checked=n=>n<0n||n>MAX?null:n;
const cases=[];
for(let i=0;i<256;i++){
  const a=next(),b=next(),c=next();
  const x=a&M,y=b&M;
  cases.push({family:'add',expr:`op(${a},${i%2===0?MAX-a:b})`,op:'+',expected:checked(a+(i%2===0?MAX-a:b))});
  cases.push({family:'subtract',expr:`op(${a},${i%2===0?a:b})`,op:'-',expected:checked(a-(i%2===0?a:b))});
  cases.push({family:'multiply',expr:`op(${i%2===0?x:a},${i%2===0?y:b})`,op:'*',expected:checked((i%2===0?x:a)*(i%2===0?y:b))});
  const p=checked(x*y),q=checked(p+c);
  cases.push({family:'intermediate',expr:`first(42,op(${x},${y})+${c})`,op:'*',expected:q===null?null:42n});
}
const familyFilter=process.env.ATTO_U64_NATIVE_FAMILY;
const families=['add','subtract','multiply','intermediate'];
assert.ok(familyFilter===undefined||families.includes(familyFilter),'invalid generated native family');
const selected=familyFilter===undefined?families:[familyFilter];
test('exact native generated guest corpus',{timeout:300000,skip:!path&&mode!=='1'?'NOT_EXECUTED: exact native compiler source unavailable':false},async t=>{
  assert.ok(path,'exact native compiler source required');const bytes=readFileSync(resolve(path));assert.equal(blob(bytes),PIN);
  const root=mkdtempSync(join(tmpdir(),'atto-generated-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cpp=join(root,'frontend.cpp'),compiler=join(root,'frontend');writeFileSync(cpp,bytes);
  const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{cwd:root,input,timeout:30000,maxBuffer:1024*1024});assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
  run(process.env.CLANGXX??'clang++',['-std=c++20','-O2','-Wall','-Wextra','-Werror',cpp,'-o',compiler]);
  const observer=join(root,'observer.c');
  writeFileSync(observer,'#include <stdint.h>\n#include <inttypes.h>\n#include <stdio.h>\nextern uint64_t atto_guest_main(void);\nint main(void){printf("%" PRIu64 "\\n",atto_guest_main());return 0;}\n');
  const observerObj=join(root,'observer.o');
  if(backend==='llvm')run(process.env.CLANG??'clang',['-c',observer,'-o',observerObj]);
  let total=0;
  for(const family of selected)await t.test(family,async()=>{
    const output=join(root,'guest');let values=0,faults=0;
    for(const [i,row] of cases.filter(x=>x.family===family).entries()){
      const source=`pub fnc main():uint{return ${row.expr};} fnc op(u64 a,uint b):u64{return a${row.op}b;} fnc first(uint a,u64 b):uint{return a;}`;
      const opt=i%2===0?'-O0':'-O2';
      const generated=run(compiler,['--emit='+(backend==='llvm'?'llvm':'cpp')],source);
      if(backend==='llvm')run(process.env.CLANG??'clang',['-Wno-override-module',opt,'-x','ir','-','-x','none',observerObj,'-o',output],generated);
      else run(process.env.CLANGXX??'clang++',['-std=c++20',opt,'-x','c++','-','-o',output],generated);
      const r=spawnSync(output,[],{cwd:root,encoding:'utf8',timeout:3000,maxBuffer:1024*1024});
      assert.ifError(r.error);
      if(row.expected===null){
        assert.equal(r.stdout,'');
        if(backend==='llvm'){assert.equal(r.signal,'SIGILL',`${family} ${i}`);assert.equal(r.status,null);}
        else {assert.equal(r.signal,null);assert.equal(r.status,70,`${family} ${i}`);assert.equal(r.stderr,'E_U64_OVERFLOW\n');}
        faults++;
      }else{assert.equal(r.signal,null);assert.equal(r.status,0,`${family} ${i}`);assert.equal(r.stdout,row.expected+'\n');assert.equal(r.stderr,'');values++;}
    }
    assert.equal(values+faults,256);assert.ok(values>0&&faults>0);console.log(`${family}: ${values} values, ${faults} expected faults`);total+=values+faults;
  });
  assert.equal(total,256*selected.length);assert.equal(blob(readFileSync(resolve(path))),PIN);
});
