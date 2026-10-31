import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {runSourceAdmission,isolatedCompilerEnvironment} from '../src/actor-ownership-source-gate-v1.mjs';

const sha='b'.repeat(40);
const current=process.execPath;

function syntheticResult(args){
 const file=args.at(-1);
 if(basename(file)==='actor-send-after-stop.ores') return {status:1,stdout:'',stderr:'error: actor message sent after stop'};
 return {status:0,stdout:'',stderr:''};
}

test('fresh source snapshot, restricted cwd/env, real executable and three LLVM classification cases',async()=>{
 const result=await runSourceAdmission({backend:'llvm',argv:['/usr/bin/true','{file}'],sourceSha:sha,
    spawn:(exe,args,options)=>{
      assert.equal(exe,'/usr/bin/true');
      assert.equal(options.shell,false);
      assert.equal(options.env.LD_PRELOAD,undefined);
      assert.equal(options.env.NODE_OPTIONS,undefined);
      assert.equal(options.env.JAVA_TOOL_OPTIONS,undefined);
      assert.equal(options.env.CLASSPATH,undefined);
      assert.equal(options.cwd,options.env.HOME);
      assert.equal(options.cwd,options.env.TMPDIR);
      assert.equal(options.cwd,options.env.TEMP);
      assert.notEqual(options.cwd,process.cwd());
      assert.ok(args[0].startsWith(options.cwd));
      assert.ok(readFileSync(args[0]).byteLength>50);
      return syntheticResult(args);
    }
 });
 assert.equal(result.ok,true);
 assert.equal(result.results.length,3);
 assert.deepEqual(result.results.map(x=>x.status),['SOURCE_ACCEPTED','SOURCE_REJECTED_AS_EXPECTED','SOURCE_ACCEPTED']);
 assert.equal(result.guestExecuted,false);
 assert.equal(result.runtimeTraceVerified,false);
});

test('artifact drift revokes passing source evidence and halts the run',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ores-artifact-mutation-'));
 const artifact=join(dir,'compiler-module.dat');
 await writeFile(artifact,'moduleA');
 let called=0;
 try{
  const result=await runSourceAdmission({backend:'llvm',argv:['/usr/bin/true','{file}'],artifacts:[artifact],sourceSha:sha,
    spawn:(exe,args)=>{
      called++;
      if(called===2) writeFileSync(artifact,'moduleB');
      return syntheticResult(args);
    }
  });
  assert.equal(result.ok,false);
  assert.equal(called,2);
  assert.equal(result.results[0].status,'COMPILER_ARTIFACT_CHANGED');
  assert.equal(result.results[0].priorVerificationRevoked,true);
  assert.equal(result.results[1].status,'COMPILER_ARTIFACT_CHANGED');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('source snapshot modification cannot yield a passing receipt',async()=>{
 const result=await runSourceAdmission({backend:'llvm',argv:['/usr/bin/true','{file}'],sourceSha:sha,
   spawn:(exe,args)=>{
     chmodSync(args.at(-1),0o600); writeFileSync(args.at(-1),'hijacked source');
     return syntheticResult(args);
   }
 });
 assert.equal(result.ok,false);
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].status,'FIXTURE_CHANGED');
});

test('unratified Java cases cannot yield a suite pass even under matching semantic rejections',async()=>{
 const result=await runSourceAdmission({backend:'java',argv:['/usr/bin/true','{file}'],sourceSha:sha,
    spawn:(exe,args)=>({status:1,stdout:'',stderr:basename(args.at(-1)).includes('move-after-take')?'error: moved':
    basename(args.at(-1)).includes('double-mutable-borrow')?'error: borrow':
    basename(args.at(-1)).includes('nested-loan-return')?'error: cannot return a nested borrowed reference':
    basename(args.at(-1)).includes('borrowed-closure-escape')?'error: closure cannot capture borrowed value':
    basename(args.at(-1)).includes('borrowed-suspension')?'error: ordinary borrow is live':
    'error: cannot retain nested borrowed references'})
 });
 assert.equal(result.ok,false);
 assert.equal(result.results.length,6);
 assert.equal(result.results.filter(x=>x.status==='CANDIDATE_UNRATIFIED').length,2);
});

test('real Node process cannot inherit malicious ambient NODE_OPTIONS or JAVA_TOOL_OPTIONS',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ores-run-real-'));
 const program=join(dir,'fake-compiler.mjs');
 await writeFile(program,`import {readFileSync} from 'node:fs';
if (process.env.NODE_OPTIONS || process.env.JAVA_TOOL_OPTIONS || process.env.LD_PRELOAD || process.env.CLASSPATH) process.exit(9);
const src=readFileSync(process.argv.at(-1),'utf8');
if (src.includes('stop worker;\\n  worker.send(1);')) {
 console.error('error: actor message sent after stop'); process.exit(1);
}
process.exit(0);
`);
 const prev=Object.fromEntries(['NODE_OPTIONS','JAVA_TOOL_OPTIONS','CLASSPATH'].map(x=>[x,process.env[x]]));
 try{
  process.env.NODE_OPTIONS='--trace-warnings';
  process.env.JAVA_TOOL_OPTIONS='-Dunsafe=1';
  process.env.CLASSPATH='/tmp/not-pinned.jar';
  const result=await runSourceAdmission({backend:'llvm',argv:[current,program,'{file}'],sourceSha:sha});
  assert.equal(result.ok,true,JSON.stringify(result.results));
  assert.equal(result.results.length,3);
  assert.equal(result.guestExecuted,false);
  assert.equal(result.compilerArtifactSha256.length,1);
 }finally{
  for(const [name,val] of Object.entries(prev)) { if(val===undefined)delete process.env[name]; else process.env[name]=val; }
  await rm(dir,{recursive:true,force:true});
 }
});

test('isolatedCompilerEnvironment rejects relative scratch paths',()=>{
 assert.throws(()=>isolatedCompilerEnvironment('relative'));
 assert.deepEqual(Object.keys(isolatedCompilerEnvironment('/tmp/sandbox')).sort(),['LANG','LC_ALL','TZ','HOME','TMPDIR','TMP','TEMP'].sort());
});
