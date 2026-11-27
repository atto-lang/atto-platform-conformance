// Shared exact-source observer. No source rewriting or reference evaluator.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,stat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [target,compilerArg]=process.argv.slice(2);
assert.ok(['wasm','js','clang','cranelift'].includes(target));
const compiler=resolve(compilerArg);
const root=fileURLToPath(new URL('../fixtures/attached-struct-seven-target-v1/',import.meta.url));
const cases=(await readFile(join(root,'manifest.tsv'),'utf8')).trim().split('\n').map(l=>l.split('\t'));
assert.equal(cases.length,15);
const names=new Set();
for(const row of cases){
  assert.equal(row.length,2,'malformed manifest row');
  const [name,expected]=row;
  assert.match(name,/^[a-z-]+\.atto$/);
  assert.ok(!names.has(name),'duplicate fixture: '+name);
  assert.match(expected,/^(reject|overflow|-?(0|[1-9][0-9]*))$/);
  names.add(name);
}
assert.deepEqual([...names].sort(),(await readdir(root)).filter(n=>n.endsWith('.atto')).sort(),'manifest must cover every source fixture exactly once');
const work=await mkdtemp(join(tmpdir(),'atto-seven-'));
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{timeout:60000,maxBuffer:8*1024*1024});assert.ifError(r.error);assert.equal(r.signal,null);return r;};
const host=join(work,'host.c');
const receipt={target,positive:0,reject:0,overflow:0,native_executions:0};
try {
  for(const [name,expected] of cases){
    assert.match(name,/^[a-z-]+\.atto$/);
    const input=join(root,name),out=join(work,name+(target==='js'?'.mjs':target==='wasm'?'.wasm':target==='clang'?'.c':'.o'));
    let args=target==='cranelift'?['emit-attached-struct-object',input]:[...(target==='js'?['--emit=js']:target==='clang'?['--emit=struct-native-c']:[]),input,'-o',out];
    const b=run(compiler,args);
    if(expected==='reject'){
      assert.notEqual(b.status,0,name);
      assert.equal(b.stdout.length,0,name);
      assert.ok(b.stderr.length>0,name);
      await assert.rejects(stat(out),{code:'ENOENT'});
      receipt.reject++;continue;
    }
    assert.equal(b.status,0,name+': '+b.stderr);
    if(target==='cranelift'){assert.ok(b.stdout.length>0);await writeFile(out,b.stdout);}
    const overflow=expected==='overflow';
    if(target==='wasm'||target==='js'){
      let printed='';
      const observer={print_i64:n=>printed+=String(n),print_bool:n=>printed+=String(n),print_newline:()=>printed+='\n'};
      const guest=target==='wasm'?new WebAssembly.Instance(new WebAssembly.Module(await readFile(out)),{atto:observer}):(await import(pathToFileURL(out).href)).instantiate(observer);
      if(overflow){
        assert.throws(()=>guest.exports.main(),target==='wasm'?WebAssembly.RuntimeError:/E_PANIC:1/,name);
        assert.equal(guest.exports.panic_code.value,1,name);
      }else{
        assert.equal(guest.exports.main(),BigInt(expected),name);
        assert.equal(guest.exports.panic_code.value,0,name);
      }
      assert.equal(printed,'');
    }else{
      const isClang=target==='clang';
      await writeFile(host,isClang?
        '#include <stdint.h>\n#include <stdlib.h>\nextern int64_t atto_guest_main(void);\nvoid atto_print_i64(int64_t n){(void)n;exit(7);}\nvoid atto_print_bool(int32_t n){(void)n;exit(7);}\nvoid atto_print_newline(void){exit(7);}\n_Noreturn void atto_panic(int32_t n){exit(n==1?101:102);}\nint main(void){return atto_guest_main()==EXPECTED?0:99;}\n':
        '#include <stdint.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);\nint main(void){int64_t out=17;int32_t status=oreslang_scalar_entry(0,0,0,0,&out);return EXPECT_OVERFLOW?(status==1&&out==17?0:99):(status==0&&out==EXPECTED?0:99);}\n');
      for(const opt of ['-O0','-O2']){
        const bin=join(work,'native');
        const l=run(isClang?'clang':'cc',[opt,'-DEXPECTED='+(overflow?'0':expected),'-DEXPECT_OVERFLOW='+(overflow?'1':'0'),...(isClang?['-std=gnu11','-fsanitize=undefined','-fno-sanitize-recover=all']:[]),out,host,'-o',bin]);
        assert.equal(l.status,0,name+': '+l.stderr);
        assert.equal(run(bin,[]).status,overflow&&isClang?101:0,name+opt);
        receipt.native_executions++;
      }
    }
    if(overflow)receipt.overflow++;else receipt.positive++;
  }
  assert.equal(receipt.positive,4);assert.equal(receipt.reject,9);assert.equal(receipt.overflow,2);
  console.log('SEVEN_TARGET_RECEIPT',JSON.stringify(receipt));
}finally{await rm(work,{recursive:true,force:true});}
