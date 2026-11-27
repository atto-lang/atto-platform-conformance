// Execute the exact portable Atto fixtures via the LLVM checked scalar
// frontend's explicit native C -> Clang LLVM IR -> executable target.
// This is not a certificate for the independent C++ frontend or ABI.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, stat, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';

assert.ok(process.env.ATTOC, 'ATTOC must be the real built compiler');
const compiler = resolve(process.env.ATTOC);
const clang = process.env.CLANG || 'clang';
const registry = JSON.parse(await readFile(new URL('../contracts/struct-with-members-conformance-v1.json',import.meta.url),'utf8'));
assert.equal(registry.schema,'atto.struct.with.members.conformance.v1');
assert.equal(registry.cases.length,40);
const work = await mkdtemp(join(tmpdir(),'atto-portable-native-'));
const host=join(work,'observer.c');
const receipt={positive:0,native_executions:0,negative_no_artifact:0,category_verified:0,target:'llvm-clang-native'};
function run(cmd,args){
    const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000});
    assert.ifError(r.error);
    assert.equal(r.signal,null,cmd+' terminated');
    return r;
}
try {
    // Observer supplies only stdio, panic and the exact signed i64 return
    // boundary. No struct or source semantics are implemented in this host.
    await writeFile(host, [
        '#include <stdint.h>',
        '#include <inttypes.h>',
        '#include <stdio.h>',
        '#include <stdlib.h>',
        'extern int64_t atto_guest_main(void);',
        'void atto_print_i64(int64_t n){printf("%" PRId64,n);}',
        'void atto_print_bool(int32_t n){fputs(n?"true":"false",stdout);}',
        "void atto_print_newline(void){putchar('\\n');}",
        '_Noreturn void atto_panic(int32_t n){fprintf(stderr,"PANIC:%d\\n",n);exit(101);}',
        'int main(void){int64_t r=atto_guest_main();fprintf(stderr,"RESULT:%" PRId64 "\\n",r);return 0;}'
    ].join('\n'));
    for(const c of registry.cases){
        assert.match(c.id,/^[a-z0-9-]+$/);
        const input=join(work,c.id+'.atto'),output=join(work,c.id+'.c');
        await writeFile(input,c.source,{flag:'wx'});
        const b=run(compiler,['--emit=struct-native-c',input,'-o',output]);
        if(c.expect==='reject'){
            assert.equal(b.status,1,c.id);
            assert.match(b.stderr,/E_[A-Z_]+/,c.id);
            await assert.rejects(stat(output),{code:'ENOENT'},c.id);
            if(c.expected_code){
                const codes=[...b.stderr.matchAll(/(?:^|\s)(E_[A-Z_]+):/gm)].map(m=>m[1]);
                assert.equal(codes[0],c.expected_code,c.id);
                receipt.category_verified++;
            }
            receipt.negative_no_artifact++;
            console.log('PORTABLE_NATIVE_REJECT',c.id);
            continue;
        }
        assert.equal(c.expect,'accept');
        assert.equal(b.status,0,c.id+': '+b.stderr);
        for(const opt of ['-O0','-O2']){
            const ir=join(work,c.id+opt+'.ll'),exe=join(work,c.id+opt);
            const instrument=['-fsanitize=undefined','-fno-sanitize-recover=all'];
            let r=run(clang,['-std=gnu11',opt,...instrument,'-S','-emit-llvm',output,'-o',ir]);
            assert.equal(r.status,0,c.id+': '+r.stderr);
            assert.match(await readFile(ir,'utf8'),/define[^\n]*@atto_guest_main\(/);
            r=run(clang,[opt,...instrument,ir,host,'-o',exe]);
            assert.equal(r.status,0,c.id+': '+r.stderr);
            r=run(exe,[]);
            assert.equal(r.status,0,c.id+': '+r.stderr);
            assert.equal(r.stdout,c.expected_stdout,c.id);
            assert.equal(r.stderr,'RESULT:'+String(c.expected_exit)+'\n',c.id);
            receipt.native_executions++;
        }
        receipt.positive++;
        console.log('PORTABLE_NATIVE_GUEST',c.id);
    }
    assert.equal(receipt.positive,14);
    assert.equal(receipt.native_executions,28);
    assert.equal(receipt.negative_no_artifact,26);
    assert.equal(receipt.category_verified,9);
    console.log('PORTABLE_NATIVE_RECEIPT',JSON.stringify(receipt));
}finally{await rm(work,{recursive:true,force:true});}
