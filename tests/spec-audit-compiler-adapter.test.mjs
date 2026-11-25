import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {runSpecAuditCompilerProbe as probe} from '../lib/spec-audit-compiler-adapter.mjs';
const hash=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
const sha='a'.repeat(40);
const negative='pub fnc main(): int { guard true { return 1; } else { return 2; } return 42; }\n';
const positive='pub fnc main(): int { return 42; }\n';
const control=negative.replace('guard true { return 1; } else { return 2; }','guard true { return 1; }');
function config(){return {schema:'atto.compiler-probe/1',backend:'llvm',compilerHead:sha,compilerTree:sha,conformanceHead:sha,conformanceTree:sha,
  timeoutMs:1000,resultChannel:'process-exit',compileArgv:['/usr/bin/true','{source}','{artifact}'],runArgv:['{artifact}'],caseIds:['positive','negative']};}
function withFixture(fn){const dir=mkdtempSync(join(tmpdir(),'atto-probe-source-'));
 try{
  const records=[['fixtures/guard-v1/positive.atto',positive],['fixtures/guard-v1/negative.atto',negative],['fixtures/spec-audit-v1/control.atto',control]];
  for(const [p,s] of records){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),s);}
  const manifest={schema:'atto.spec-audit-candidates/1',cases:[
    {id:'positive',kind:'positive',source:records[0][0],source_git_blob_sha1:hash(positive),expected_guest_i64:'42',backends:{llvm:'NOT_EXECUTED'}},
    {id:'negative',kind:'negative',source:records[1][0],source_git_blob_sha1:hash(negative),expected_diagnostic_class:'GUARD_ELSE_FORBIDDEN',
     control_source:records[2][0],control_git_blob_sha1:hash(control),control_transform:{from:'guard true { return 1; } else { return 2; }',to:'guard true { return 1; }'},backends:{llvm:'NOT_EXECUTED'}}]};
  return fn(dir,manifest);
 }finally{rmSync(dir,{recursive:true,force:true});}}
function stub({diagnostic='error[GUARD_ELSE_FORBIDDEN]: expected semantic rejection',value=42,failControl=false,omitArtifact=false}={}){
 return (exe,args)=>{
  if(exe.endsWith('.compiled'))return {exit:value,stdout:'',stderr:''};
  const src=readFileSync(args[0],'utf8');
  if(src.includes('else { return 2; }'))return {exit:1,stdout:'',stderr:diagnostic};
  if(failControl && src.includes('guard true'))return {exit:1,stdout:'',stderr:'error[CONTROL_FAILED]: no'};
  if(!omitArtifact){writeFileSync(args[1],'#!/bin/sh\nexit 42\n');chmodSync(args[1],0o700);}
  return {exit:0,stdout:'',stderr:''};
 };
}
function checkFail(name,mutate,error){test('mutation: '+name,()=>withFixture((dir,m)=>{const c=config();const s={spawn:stub(),root:dir};mutate(c,m,s,dir);assert.throws(()=>probe(m,c,s),error);}));}
test('local probe cannot claim authenticated guest parity, even if mock commands match',()=>withFixture((dir,m)=>{
 const r=probe(m,config(),{spawn:stub(),root:dir});
 assert.equal(r.classification,'LOCAL_UNAUTHENTICATED_COMPILER_PROBE');
 assert.equal(r.guestParityCertified,false);assert.equal(r.githubJobStepsVerified,false);
 assert.equal(r.cases.length,2);
 assert.equal(r.cases[1].diagnosticClass,'GUARD_ELSE_FORBIDDEN');
}));
checkFail('unconfigured compiler denied',(c)=>c.compileArgv[0]='/not/installed/atto',/nonregular|ENOENT/);
checkFail('shell invocation denied',(c)=>c.compileArgv=['sh','-c','{source}','{artifact}'],/absolute executable/);
checkFail('interpolated source token denied',(c)=>c.compileArgv[1]='--source={source}',/unrecognized command placeholder/);
checkFail('noncanonical typed result denied',(_c,_m,s)=>s.spawn=stub({value:43}),/typed compiled guest result/);
checkFail('missing compiled artifact denied',(_c,_m,s)=>s.spawn=stub({omitArtifact:true}),/positive not compiled/);
checkFail('negative parser error denied',(_c,_m,s)=>s.spawn=stub({diagnostic:'error[PARSE_ERROR]: syntax'}),/target semantic diagnostic/);
checkFail('negative generic error denied',(_c,_m,s)=>s.spawn=stub({diagnostic:'error: rejected'}),/target semantic diagnostic/);
checkFail('control admission failure denied',(_c,_m,s)=>s.spawn=stub({failControl:true}),/negative control did not compile/);
checkFail('negative source blob tamper denied',(_c,m)=>m.cases[1].source_git_blob_sha1=sha,/Git blob mismatch/);
checkFail('unsettled candidate cannot be promoted',(_c,m)=>m.cases[1].kind='decision-candidate',/unsupported or pre-promoted/);
checkFail('missing control mutation rejected',(_c,m)=>delete m.cases[1].control_transform,/missing paired control/);
checkFail('unrelated control rejected',(_c,m)=>m.cases[1].control_transform.to='not the real control',/one-edit variant/);
checkFail('unsupported backend rejected',(c)=>c.backend='net',/invalid backend/);
checkFail('source with forged path rejected',(_c,m)=>m.cases[0].source='../other.atto',/unsafe fixture path/);

checkFail('compiler executable swap detected', (c,_m,s,dir)=>{
  const binary=join(dir,'compiler');writeFileSync(binary,'compiler version one');
  c.compileArgv[0]=binary;
  const prior=stub();
  s.spawn=(exe,args,...rest)=>{
    const output=prior(exe,args,...rest);
    writeFileSync(binary,'compiler version two');
    return output;
  };
},/compiler executable changed during run/);
checkFail('guest artifact changed while executing', (_c,_m,s)=>{
  const prior=stub();
  s.spawn=(exe,args,...rest)=>{
    const output=prior(exe,args,...rest);
    if(exe.endsWith('.compiled'))writeFileSync(exe,'guest artifact modified after launch');
    return output;
  };
},/guest artifact changed during execution/);
checkFail('compiler with zero exit and emitted error denied', (_c,_m,s)=>{
  const prior=stub();
  s.spawn=(exe,args,...rest)=>{
    const output=prior(exe,args,...rest);
    if(!exe.endsWith('.compiled'))output.stderr='error[MOCK_FAILURE]: did not actually compile';
    return output;
  };
},/positive compiler reported an error/);
checkFail('compiler tampering with its input snapshot denied', (_c,_m,s)=>{
  const prior=stub();
  s.spawn=(exe,args,...rest)=>{
    const output=prior(exe,args,...rest);
    if(!exe.endsWith('.compiled')){
      chmodSync(args[0],0o600);
      writeFileSync(args[0],'tampered fixture contents');
    }
    return output;
  };
},/compiler changed isolated positive source/);
checkFail('symlinked fixture parent is denied',(_c,_m,_s,dir)=>{
  const parent=join(dir,'fixtures','guard-v1');
  const backup=join(dir,'guard-backup');
  renameSync(parent,backup);
  symlinkSync(backup,parent,'dir');
},/symlinked fixture parent/);
