#!/usr/bin/env node
// Explicitly configured real-compiler guest execution; no host model or shell.
import {readFile,writeFile,mkdtemp,rm,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSuite,selectCases,classifyReceipt,summarize} from '../lib/portable-task-v1.mjs';

const here=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha40=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const isPath=x=>typeof x==='string'&&isAbsolute(x)&&!x.includes('\0');
const required=(cond,message)=>{if(!cond)throw Error(message);};
function command(argv,variables){
 required(Array.isArray(argv)&&argv.length>0,'command argv is required');
 const result=argv.map(token=>{
  required(typeof token==='string'&&token.length>0&&!token.includes('\0'),'invalid argv token');
  if(token==='{file}'||token==='{out}')return variables[token];
  required(!token.includes('{file}')&&!token.includes('{out}'),'embedded substitutions forbidden');
  return token;
 });
 required(isPath(result[0]),'command executable must be an absolute path');
 return result;
}
function invoke(argv,cwd){
 const output=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:60000,maxBuffer:131072,shell:false,windowsHide:true});
 return {exit:output.status,signal:output.signal,error:output.error?.message||null,
         stdout:output.stdout||'',stderr:output.stderr||''};
}
function git(root,...args){
 const result=invoke(['git','-C',root,...args],root);
 required(result.exit===0&&!result.signal&&!result.error,'unable to resolve exact Git source identity');
 return result.stdout.trim();
}
async function digest(path){
 required(isPath(path),'expected an absolute identity/artifact path');
 const resolved=await realpath(path),s=await stat(resolved);
 required(s.isFile()&&s.size>0&&s.size<=256*1024*1024,'missing or oversized compiler/guest artifact');
 return createHash('sha256').update(await readFile(resolved)).digest('hex');
}
async function run(cfg){
 required(cfg&&typeof cfg==='object'&&!Array.isArray(cfg),'invalid run configuration');
 required(['java','llvm','wasm','rs','forge','net'].includes(cfg.backend),'invalid backend');
 required(isPath(cfg.compilerRoot)&&sha40(cfg.compilerCommit),'pinned absolute compiler checkout and full SHA required');
 required(sha40(cfg.fixtureCommit),'pinned fixture checkout SHA required');
 required(isPath(cfg.compilerIdentity),'compiled compiler identity file required');
 required(isPath(cfg.artifactPath)||cfg.artifactPath==='{out}','guest runtime or executable artifact identity required');
 required(Array.isArray(cfg.compileArgv)&&Array.isArray(cfg.guestArgv),'explicit compiler and guest argv required');
 required(cfg.compileArgv.includes('{file}')&&cfg.guestArgv.length>0,'compile/guest command must use the fixture');
 const head=git(cfg.compilerRoot,'rev-parse','HEAD');
 required(head===cfg.compilerCommit,'compiler source HEAD differs from pinned commit');
 required(git(here,'rev-parse','HEAD')===cfg.fixtureCommit,'fixture source HEAD differs from pinned commit');
 const compilerSha256=await digest(cfg.compilerIdentity);
 const suite=await loadSuite();
 const allIds=suite.cases.map(c=>c.id);
 const cases=selectCases(suite.cases,cfg.caseIds===undefined?allIds:cfg.caseIds);
 const receipts={[cfg.backend]:{}},trace=[];
 const scratch=await mkdtemp(join(tmpdir(),'atto-task-parity-'));
 try{
  for(const c of cases){
   required(git(here,'rev-parse',cfg.fixtureCommit+':fixtures/portable-task-v1/'+c.file)===c.fixtureBlobSha,
      'fixture blob is not at pinned tree: '+c.id);
   const file=join(scratch,c.file),out=join(scratch,c.id+'.guest');
   const bytes=await readFile(new URL('../fixtures/portable-task-v1/'+c.file,import.meta.url));
   required(createHash('sha256').update(bytes).digest('hex')===c.fixtureSha256,'fixture content changed');
   await writeFile(file,bytes,{flag:'wx',mode:0o400});
   const vars={'{file}':file,'{out}':out};
   const compileArgv=command(cfg.compileArgv,vars),compiled=invoke(compileArgv,cfg.compilerRoot);
   const compilerOutput=(compiled.stdout+'\n'+compiled.stderr).slice(0,131072);
   // Negative admissions must not leave a linked guest artifact. An unexpected
   // compiler output file is a failure even when the diagnostic looks correct.
   let artifactFileExists=false;
   try{await stat(out);artifactFileExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
   let status='failed',guestExecuted=false,guestArgv=[],guestExit=null,guestOutput='',artifactSha256=null;
   const stepNames=['compile'];
   const safeCompile=compiled.error===null&&compiled.signal===null&&Number.isSafeInteger(compiled.exit);
   if(safeCompile&&compiled.exit!==0&&!artifactFileExists){
    if(/(?:^|\n)\s*error:.*\b(?:unsupported|unimplemented)\b/i.test(compilerOutput))status='unsupported';
    // Negative semantic rejection is distinct from an unsupported negative fixture.
    else if(c.expect==='negative')status='passed';
   }else if(safeCompile&&compiled.exit===0&&c.expect==='positive'){
    guestArgv=command(cfg.guestArgv,vars);
    const guest=invoke(guestArgv,cfg.compilerRoot);
    stepNames.push('guest');
    guestExecuted=guest.error===null&&guest.signal===null&&Number.isSafeInteger(guest.exit);
    guestExit=guest.exit;
    guestOutput=guest.stdout.slice(0,131072);
    if(guestExecuted){
     try{artifactSha256=await digest(cfg.artifactPath==='{out}'?out:cfg.artifactPath)}catch{}
    }
    status='passed';
   }
   const baseUrl=typeof process.env.GITHUB_SERVER_URL==='string'&&typeof process.env.GITHUB_REPOSITORY==='string'&&/^\d+$/.test(process.env.GITHUB_RUN_ID||'')
    ?process.env.GITHUB_SERVER_URL+'/'+process.env.GITHUB_REPOSITORY+'/actions/runs/'+process.env.GITHUB_RUN_ID
    :null;
   const receipt={status,backend:cfg.backend,caseId:c.id,compilerCommit:cfg.compilerCommit,fixtureCommit:cfg.fixtureCommit,
     fixtureBlobSha:c.fixtureBlobSha,fixtureSha256:c.fixtureSha256,compilerSha256,compileArgv,completedSteps:stepNames.length,
     stepNames,runnerJobUrl:baseUrl,compilerExit:compiled.exit,compilerOutput,rejectedEmittedArtifact:(compiled.exit!==0&&artifactFileExists),
     guestExecuted,guestArgv,guestExit,guestOutput,artifactSha256};
   receipts[cfg.backend][c.id]=receipt;
   trace.push({id:c.id,...classifyReceipt(c,cfg.backend,receipt),compilerCommit:cfg.compilerCommit,
     fixtureCommit:cfg.fixtureCommit,compilerExit:compiled.exit,compilerOutput,compileArgv,
     guestExit,guestExecuted,guestOutput,guestArgv,artifactSha256,rejectedEmittedArtifact:(compiled.exit!==0&&artifactFileExists),runnerJobUrl:baseUrl,
     stepNames,fixtureBlobSha:c.fixtureBlobSha,fixtureSha256:c.fixtureSha256,compilerSha256,
     artifactKind:cfg.backend==='java'?'jvm-launcher-identity':cfg.backend==='llvm'?'native-guest-executable':'backend-declared'});
  }
  const summary=summarize(cases,receipts);
  console.log(JSON.stringify({schema:'atto.portable-task-v1-run-candidate',compilerCommit:cfg.compilerCommit,
   fixtureCommit:cfg.fixtureCommit,backend:cfg.backend,compilerSha256,selectedCaseIds:cases.map(c=>c.id),trace,summary},null,2));
  // No candidate status is release-qualified; source-local Actions + independent review still required.
  // Exit 3 distinguishes complete candidate execution from release-qualified proof.
  return summary[cfg.backend].passed===cases.length?3:1;
 }finally{await rm(scratch,{recursive:true,force:true});}
}
try{
 const args=process.argv.slice(2);
 required(args.length===1&&args[0].startsWith('--config='),'usage: node bin/portable-task-v1-run.mjs --config=/absolute/config.json');
 const path=args[0].slice('--config='.length);
 required(isPath(path),'config path must be absolute');
 const config=JSON.parse(await readFile(path,'utf8'));
 process.exitCode=await run(config);
}catch(error){console.error('TASK_GUEST_RUNNER_DENIED: '+error.message);process.exitCode=2;}
