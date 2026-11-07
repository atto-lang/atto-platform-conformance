// First-wave Java/GraalVM and LLVM adapter. Executes configured real commands
// without a shell and records LOCAL_UNAUTHENTICATED probes, NEVER parity proof.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync,statSync,lstatSync,openSync,readSync,closeSync,existsSync,fstatSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,isAbsolute,sep} from 'node:path';

const sha1=/^[a-f0-9]{40}$/;
const allowed=new Set(['java','llvm']);
const codeName=/^[A-Z][A-Z0-9_]{1,127}$/;
const maxFixture=1048576;
function fail(s){throw Error('SPEC_AUDIT_COMPILER_PROBE_REJECTED: '+s);}
function blob(buffer){return createHash('sha1').update(Buffer.from('blob '+buffer.length+'\0')).update(buffer).digest('hex');}
function digest(buffer){return createHash('sha256').update(buffer).digest('hex');}
function readBoundedRegular(file,max){
  const before=lstatSync(file);
  if(!before.isFile()||before.nlink!==1||before.size<=0||before.size>max)fail('nonregular, linked, empty or oversized input: '+file);
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const opened=fstatSync(fd);
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)fail('raced input');
    const buf=Buffer.alloc(opened.size);
    let offset=0;
    while(offset<buf.length){const n=readSync(fd,buf,offset,buf.length-offset,offset);if(n<=0)fail('truncated read');offset+=n;}
    const after=fstatSync(fd);
    const final=lstatSync(file);
    if(after.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||
      final.ino!==opened.ino||final.dev!==opened.dev||final.mtimeMs!==opened.mtimeMs)fail('input changed during read');
    return buf;
  }finally{closeSync(fd);}
}
function command(argv,from,to){
  if(!Array.isArray(argv)||argv.length<2||argv.length>32||
    !argv.every(s=>typeof s==='string'&&s.length>0&&s.length<=2048&&!/[\u0000\r\n]/.test(s)))fail('invalid command array');
  const allowedTokens=new Set([from,to]);
  for(const s of argv){if((s.includes('{')||s.includes('}'))&&!allowedTokens.has(s))fail('unrecognized command placeholder');}
  if(argv.filter(s=>s===from).length!==1)fail('required source/artifact placeholder missing');
  if(argv.filter(s=>s===to).length!==1)fail('required source/artifact destination placeholder missing');
  if(!isAbsolute(argv[0]))fail('compiler command must start with an absolute executable');
  return argv;
}
function assertConfig(config,manifest){
  if(!config||typeof config!=='object'||Array.isArray(config)||config.schema!=='atto.compiler-probe/1'||!allowed.has(config.backend))fail('invalid backend/config schema');
  if(!sha1.test(config.compilerHead)||!sha1.test(config.compilerTree)||!sha1.test(config.conformanceHead)||!sha1.test(config.conformanceTree))fail('missing exact source/tree pins');
  if(!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<100||config.timeoutMs>30000)fail('invalid timeout');
  if(!['stdout','process-exit'].includes(config.resultChannel))fail('typed result channel must be stdout or process-exit');
  command(config.compileArgv,'{source}','{artifact}');
  const argv=config.runArgv;
  if(!Array.isArray(argv)||argv.length<1||argv.length>32||
     !argv.every(s=>typeof s==='string'&&s.length>0&&s.length<=2048&&!/[\u0000\r\n]/.test(s))||
     argv.filter(s=>s==='{artifact}').length!==1||
     argv.some(s=>(s.includes('{')||s.includes('}'))&&s!=='{artifact}')||
     (argv[0]!=='{artifact}'&&!isAbsolute(argv[0])))fail('run command must invoke a compiled artifact');
  if(!Array.isArray(config.caseIds)||config.caseIds.length===0||config.caseIds.length>6||new Set(config.caseIds).size!==config.caseIds.length)fail('invalid case selection');
  const map=new Map(manifest.cases.map(c=>[c.id,c]));
  for(const id of config.caseIds){
    const c=map.get(id);
    if(!c||!['positive','negative'].includes(c.kind)||c.backends[config.backend]!=='NOT_EXECUTED')fail('unsupported or pre-promoted case: '+id);
  }
}
function snapshot(root,relative){
  if(typeof relative!=='string'||!/^fixtures\/[a-z0-9-]+\/[a-z0-9-]+\.atto$/.test(relative))fail('unsafe fixture path');
  const absolute=resolve(root,relative);
  if(!absolute.startsWith(resolve(root)+sep))fail('fixture escaped root');
  return readBoundedRegular(absolute,maxFixture);
}
function capture(program,argv,cwd,timeoutMs){
  const result=spawnSync(program,argv,{cwd,encoding:'utf8',timeout:timeoutMs,maxBuffer:131072,shell:false,windowsHide:true,
    env:{PATH:'/usr/bin:/bin',HOME:cwd,LANG:'C',LC_ALL:'C',...(process.env.JAVA_HOME?{JAVA_HOME:process.env.JAVA_HOME}:{})}});
  if(result.error||result.signal||!Number.isSafeInteger(result.status))fail('command failed to complete without timeout/signal');
  if(typeof result.stdout!=='string'||typeof result.stderr!=='string')fail('unbounded or missing compiler output');
  return {exit:result.status,stdout:result.stdout,stderr:result.stderr};
}
function diagnosticClass(output,expected){
  if(!codeName.test(expected))fail('unrecognized semantic diagnostic class');
  const severities=[];
  for(const line of output.split(/\r?\n/)){
    const m=/^(?:[^:\n]+:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error\[([A-Z][A-Z0-9_]+)\]:/.exec(line);
    if(m)severities.push(m[1]);
    else if(/^(?:[^:\n]+:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error\s*:/.test(line))return false;
  }
  return severities.length>0&&severities.every(x=>x===expected);
}
export function runSpecAuditCompilerProbe(manifest,config,{root=process.cwd(),spawn=capture}={}){
  if(!manifest||manifest.schema!=='atto.spec-audit-candidates/1'||!Array.isArray(manifest.cases))fail('invalid candidate manifest');
  assertConfig(config,manifest);
  const bin=config.compileArgv[0];
  const compiledBinaryHash=digest(readBoundedRegular(bin,512*1024*1024));
  const runnerExe=config.runArgv[0];
  if(runnerExe!=='{artifact}')readBoundedRegular(runnerExe,512*1024*1024);
  const work=mkdtempSync(join(tmpdir(),'atto-compiler-probe-'));
  const cases=[];
  try{
    for(const id of config.caseIds){
      const c=manifest.cases.find(x=>x.id===id);
      const raw=snapshot(root,c.source);
      if(blob(raw)!==c.source_git_blob_sha1)fail('source fixture Git blob mismatch: '+id);
      const sourcePath=join(work,id+'.atto');
      const artifactPath=join(work,id+'.compiled');
      const compiled=argv=>{
        const arguments_ = argv.map(s=>s==='{source}'?sourcePath:s==='{artifact}'?artifactPath:s);
        return spawn(arguments_[0],arguments_.slice(1),work,config.timeoutMs);
      };
      if(c.kind==='negative'){
        if(!c.control_source||!sha1.test(c.control_git_blob_sha1)||!c.control_transform)fail('missing paired control');
        const control=snapshot(root,c.control_source);
        if(blob(control)!==c.control_git_blob_sha1)fail('control Git blob mismatch: '+id);
        const strip=x=>x.toString('utf8').split('\n').filter(s=>!s.trimStart().startsWith('//')).join('\n');
        const original=strip(raw),adjusted=strip(control),{from,to}=c.control_transform;
        if(typeof from!=='string'||!from||typeof to!=='string'||original.indexOf(from)!==original.lastIndexOf(from)||original.replace(from,to)!==adjusted)fail('paired control is not one-edit variant');
        writeFileSync(sourcePath,control,{mode:0o400,flag:'wx'});
        const admitted=compiled(config.compileArgv);
        if(admitted.exit!==0||!existsSync(artifactPath)||!statSync(artifactPath).isFile())fail('negative control did not compile: '+id);
        rmSync(artifactPath);
        rmSync(sourcePath);
        writeFileSync(sourcePath,raw,{mode:0o400,flag:'wx'});
        const rejected=compiled(config.compileArgv);
        if(rejected.exit===0||existsSync(artifactPath)||!diagnosticClass(rejected.stderr+'\n'+rejected.stdout,c.expected_diagnostic_class))fail('negative did not produce target semantic diagnostic: '+id);
        cases.push({id,kind:'negative',sourceBlob:c.source_git_blob_sha1,controlBlob:c.control_git_blob_sha1,
          controlCompileExit:admitted.exit,compileExit:rejected.exit,diagnosticClass:c.expected_diagnostic_class,
          result:'LOCAL_SEMANTIC_REJECTION_OBSERVED_NOT_AUTHENTICATED'});
      }else{
        writeFileSync(sourcePath,raw,{mode:0o400,flag:'wx'});
        const compiledResult=compiled(config.compileArgv);
        if(compiledResult.exit!==0||!existsSync(artifactPath)||!statSync(artifactPath).isFile())fail('positive not compiled: '+id);
        const guestArtifactSha256=digest(readBoundedRegular(artifactPath,512*1024*1024));
        const argv=config.runArgv.map(s=>s==='{artifact}'?artifactPath:s);
        const program=argv.shift();
        const run=spawn(program,argv,work,config.timeoutMs);
        const expected=c.expected_guest_i64;
        const observed=config.resultChannel==='process-exit'?String(run.exit):run.stdout.trim();
        if(observed!==expected||run.stderr!==''||
          (config.resultChannel==='process-exit'&&run.stdout!=='')||
          (config.resultChannel==='stdout'&&run.exit!==0))fail('typed compiled guest result differs from oracle: '+id);
        cases.push({id,kind:'positive',sourceBlob:c.source_git_blob_sha1,compileExit:compiledResult.exit,
          guestArtifactSha256,observedI64:observed,resultChannel:config.resultChannel,
          result:'LOCAL_COMPILED_COMMAND_OBSERVED_NOT_AUTHENTICATED'});
      }
      if(blob(snapshot(root,c.source))!==c.source_git_blob_sha1)fail('source changed during compiler probe');
    }
  }finally{rmSync(work,{recursive:true,force:true});}
  return {classification:'LOCAL_UNAUTHENTICATED_COMPILER_PROBE',authenticated:false,
    githubJobStepsVerified:false,guestParityCertified:false,backend:config.backend,
    compilerHead:config.compilerHead,compilerTree:config.compilerTree,
    conformanceHead:config.conformanceHead,conformanceTree:config.conformanceTree,
    compilerBinarySha256:compiledBinaryHash,cases};
}
