#!/usr/bin/env node
// Real-subprocess Java/LLVM AttoLang smoke. This is NOT an authenticated CI receipt.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const FIXTURE=fileURLToPath(new URL('../fixtures/atto-java-llvm-guest-gate/literal-42.atto',import.meta.url));
const SHA=/^[a-f0-9]{40}$/;
const OPTIONS=['java-head','java-tree','llvm-head','llvm-tree','java-check','java-run','llvm-compile','llvm-run','report','timeout-ms'];
const TEMPLATES=['java-check','java-run','llvm-compile','llvm-run'];
const MAX_OUTPUT=1024*1024,MAX_EXECUTABLE=512*1024*1024;

export function parseArguments(argv){
  const options={};
  for(const arg of argv){
    const match=/^--([a-z-]+)=(.*)$/s.exec(arg);
    if(!match || !OPTIONS.includes(match[1]) || Object.hasOwn(options,match[1]))
      throw Error('unknown or repeated argument');
    options[match[1]]=match[2];
  }
  for(const key of ['java-head','java-tree','llvm-head','llvm-tree'])
    if(options[key]!==undefined&&!SHA.test(options[key]))throw Error('invalid '+key+' (40 lowercase hex required)');
  if(options['timeout-ms']!==undefined){
    if(!/^[1-9][0-9]*$/.test(options['timeout-ms']))throw Error('invalid timeout-ms');
    const ms=Number(options['timeout-ms']);
    if(!Number.isSafeInteger(ms)||ms<100||ms>120000)throw Error('timeout-ms out of range');
  }
  if(options.report!==undefined&&!isAbsolute(options.report))throw Error('report path must be absolute');
  for(const key of TEMPLATES){
    if(options[key]===undefined)continue;
    let tokens;
    try{tokens=JSON.parse(options[key]);}catch{throw Error('invalid argv JSON for '+key);}
    if(!Array.isArray(tokens)||tokens.length===0||tokens.length>64||
       tokens.some(x=>typeof x!=='string'||x.length===0||x.length>4096))
      throw Error('invalid argv array for '+key);
    const required=key==='llvm-run'?'{artifact}':'{source}';
    if(tokens.filter(x=>x.includes(required)).length!==1)
      throw Error(key+' must contain exactly one '+required);
    if(key==='llvm-compile'&&tokens.filter(x=>x.includes('{artifact}')).length!==1)
      throw Error('llvm-compile must contain exactly one {artifact}');
    if(key!=='llvm-run'&&key!=='llvm-compile'&&tokens.some(x=>x.includes('{artifact}')))
      throw Error('unexpected {artifact}');
    if(key==='llvm-run'&&tokens[0]!=='{artifact}')
      throw Error('llvm-run must execute {artifact} directly');
    if(key!=='llvm-run'&&!isAbsolute(tokens[0]))
      throw Error(key+' executable must be an absolute path');
    if(tokens.some(x=>/\{(?!source\}|artifact\})[^{}]*\}|\$\{/.test(x)))
      throw Error('unsupported template interpolation');
    options[key]=tokens;
  }
  return options;
}

function sha(bytes){return createHash('sha256').update(bytes).digest('hex');}
async function digestBoundedFile(path){
  const target=await realpath(path),info=await stat(target);
  if(!info.isFile()||info.size>MAX_EXECUTABLE||info.size<=0)throw Error('not a bounded regular executable/artifact');
  return {path:target,sha256:sha(await readFile(target))};
}
function expand(argv,source,artifact){
  const replaced=argv.map(x=>x.replaceAll('{source}',source).replaceAll('{artifact}',artifact));
  if(replaced.some(x=>x.includes('{source}')||x.includes('{artifact}')))throw Error('unexpanded placeholder');
  return replaced;
}
async function execute(label,argv,timeoutMs){
  const observed={stage:label,status:'NOT_EXECUTED',exit_code:null,stdout_sha256:null,stderr_sha256:null,
    executable_sha256:null,meaningful_step_completed:false,error:null};
  try{
    const binary=await digestBoundedFile(argv[0]);
    observed.executable_sha256=binary.sha256;
    const args=[binary.path,...argv.slice(1)],started=Date.now();
    const result=await new Promise(done=>{
      let proc,settled=false,timedOut=false,oversized=false,stdout=[],stderr=[],outCount=0,errCount=0,spawnError=null;
      const finish=(code,signal)=>{
        if(settled)return;settled=true;clearTimeout(timer);
        done({code,signal,timedOut,oversized,spawnError,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),duration_ms:Date.now()-started});
      };
      try{proc=spawn(args[0],args.slice(1),{shell:false,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',
          env:{PATH:process.env.PATH||'',HOME:process.env.HOME||'',TMPDIR:process.env.TMPDIR||''}});}
      catch(e){spawnError=String(e);done({spawnError});return;}
      const stop=()=>{try{if(process.platform!=='win32'&&proc.pid)process.kill(-proc.pid,'SIGKILL');else proc.kill('SIGKILL');}catch{}};
      const collect=(chunks,side,data)=>{
        const prev=side==='out'?outCount:errCount,remaining=Math.max(0,MAX_OUTPUT-prev);
        if(remaining)chunks.push(data.subarray(0,remaining));
        if(side==='out')outCount+=data.length;else errCount+=data.length;
        if(prev+data.length>MAX_OUTPUT){oversized=true;stop();}
      };
      proc.stdout?.on('data',b=>collect(stdout,'out',b));
      proc.stderr?.on('data',b=>collect(stderr,'err',b));
      proc.on('error',e=>{spawnError=String(e);});
      proc.on('close',(code,signal)=>finish(code,signal));
      var timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    });
    observed.duration_ms=result.duration_ms??0;
    if(result.stdout)observed.stdout_sha256=sha(result.stdout);
    if(result.stderr)observed.stderr_sha256=sha(result.stderr);
    observed.exit_code=result.code??null;
    observed.meaningful_step_completed=!(result.spawnError||result.timedOut||result.oversized||result.signal);
    observed.status=result.spawnError?'SPAWN_FAILURE':result.timedOut?'TIMEOUT':result.oversized?'OUTPUT_LIMIT':result.signal?'SIGNALED':'EXECUTED';
    observed.error=result.spawnError??(result.timedOut?'timeout':result.oversized?'output exceeded limit':result.signal??null);
  }catch(e){observed.status='INFRA_FAILURE';observed.error=String(e.message||e);}
  return observed;
}

export async function runGate(options,{fixture=FIXTURE}={}){
  const missing=[...TEMPLATES,'java-head','java-tree','llvm-head','llvm-tree'].filter(k=>options[k]===undefined);
  const report={schema:'atto.java-llvm.local-guest-smoke.v1',status:'NOT_EXECUTED',
    evidence_class:'LOCAL_UNATTESTED',promotable:false,authenticated_ci:false,
    source_commit_provenance:'DECLARED_UNVERIFIED',
    fixture:{name:'literal-42.atto',sha256:null,expected_guest_exit_code:42},
    compiler_sources:{java:{head:options['java-head']??null,tree:options['java-tree']??null},
      llvm:{head:options['llvm-head']??null,tree:options['llvm-tree']??null}},
    stages:[],missing,blockers:[]};
  const source=await readFile(fixture);
  if(source.length>16384||!source.length)throw Error('invalid fixture size');
  report.fixture.sha256=sha(source);
  if(missing.length){report.blockers.push('Required real executable commands and declared full Git identities are missing');return report;}
  const scratch=await mkdtemp(join(tmpdir(),'atto-java-llvm-'));
  try{
    const sealed=join(scratch,'literal-42.atto');
    const artifact=join(scratch,process.platform==='win32'?'llvm-guest.exe':'llvm-guest');
    await writeFile(sealed,source,{mode:0o400,flag:'wx'});
    await mkdir(join(scratch,'work'),{mode:0o700});
    const timeoutMs=options['timeout-ms']?Number(options['timeout-ms']):30000;
    const tasks=[['java-check',0],['java-run',42],['llvm-compile',0],['llvm-run',42]];
    for(const [stage,expected] of tasks){
      let preRunArtifactSha=null;
      if(stage==='llvm-run'){
        try{preRunArtifactSha=(await digestBoundedFile(artifact)).sha256;}
        catch(e){report.blockers.push('Missing bounded LLVM native artifact: '+e.message);break;}
      }
      const args=expand(options[stage],sealed,artifact);
      const result=await execute(stage,args,timeoutMs);
      result.expected_exit_code=expected;
      result.oracle_match=result.status==='EXECUTED'&&result.exit_code===expected;
      if(stage==='llvm-run'&&result.oracle_match){
        try{
          const after=(await digestBoundedFile(artifact)).sha256;
          result.guest_artifact_sha256=after;
          if(after!==preRunArtifactSha){result.oracle_match=false;result.status='ARTIFACT_MUTATED';}
        }catch{result.oracle_match=false;result.status='ARTIFACT_MISSING';}
      }
      report.stages.push(result);
      if(sha(await readFile(sealed))!==report.fixture.sha256){report.blockers.push('Sealed source modified by child process');break;}
      if(!result.oracle_match){report.blockers.push(stage+' '+result.status+': expected exit '+expected+', got '+result.exit_code);break;}
    }
    report.status=report.stages.length===4&&report.stages.every(s=>s.oracle_match)
      ?'LOCAL_ORACLES_MATCHED_UNATTESTED':'INCOMPLETE_OR_FAILED';
    report.blockers.push('No authenticated CI run, compiler build provenance or native artifact attestation; not a parity promotion');
    return report;
  }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function main(argv){
  let opts;
  try{opts=parseArguments(argv);}catch(e){console.error('CONFIG_ERROR:',e.message);return 2;}
  let report;
  try{report=await runGate(opts);}catch(e){console.error('INFRA_ERROR:',e.message);return 2;}
  const serialized=JSON.stringify(report,null,2)+'\n';
  if(opts.report)await writeFile(opts.report,serialized,{flag:'wx',mode:0o600});
  else process.stdout.write(serialized);
  return report.status==='LOCAL_ORACLES_MATCHED_UNATTESTED'?0:3;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).then(code=>process.exitCode=code).catch(e=>{
    console.error('INFRA_ERROR:',e.message);process.exitCode=2;
  });
}
