#!/usr/bin/env node
// This checks reference values and receipt SHAPE, not authenticated execution.
// A passing receipt check is NEVER proof of compiler provenance or backend parity.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const CONTRACT=resolve(ROOT,'contracts/strict-named-i64-v1.json');
export const CONTRACT_GIT_BLOB='3f65f557f06e8cd0d34a738a0d357d6c2e477665';
export const REPOS=Object.freeze({
  java:'ores-truffle-oreslang/oreslang-source.java',
  llvm:'ores-truffle-oreslang/oreslang-source.llvm',
  wasm:'ores-truffle-oreslang/oreslang-source.wasm',
  forge:'ores-truffle-oreslang/oreslang-source.forge',
  net:'ores-truffle-oreslang/oreslang-source.net'
});
const operationName={rem:'rem',mod:'mod',pow:'pow',bit_xor:'bitXor'};
const dec=/^(?:0|-?[1-9][0-9]*)$/,sha40=/^[0-9a-f]{40}$/,sha64=/^[0-9a-f]{64}$/;
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const bounded=x=>x>=MIN&&x<=MAX;
const invalid=(name)=>{throw new Error('invalid signed-i64 '+name);};
export function oracle(v){
  if(!object(v)||!Object.hasOwn(operationName,v.operation)||typeof v.left!=='string'||
    typeof v.right!=='string'||!dec.test(v.left)||!dec.test(v.right))invalid('vector');
  const a=BigInt(v.left),b=BigInt(v.right);
  if(!bounded(a)||!bounded(b))invalid('range');
  if(v.operation==='rem'||v.operation==='mod'){
    if(b===0n)return {error:'DIVISOR_ZERO'};
    const rem=a%b;
    return {value:String(v.operation==='mod'&&rem<0n?rem+(b<0n?-b:b):rem)};
  }
  if(v.operation==='bit_xor')return {value:String(BigInt.asIntN(64,a^b))};
  if(b<0n)return {error:'NEGATIVE_EXPONENT'};
  if(a===0n)return {value:b===0n?'1':'0'};
  if(a===1n)return {value:'1'};
  if(a===-1n)return {value:(b&1n)?'-1':'1'};
  let result=1n,base=a,exponent=b;
  while(exponent>0n){
    if(exponent&1n){result*=base;if(!bounded(result))return {error:'OVERFLOW'};}
    exponent>>=1n;
    if(exponent>0n){base*=base;if(!bounded(base))return {error:'OVERFLOW'};}
  }
  return {value:String(result)};
}
export function guestSource(v){
  oracle(v);
  return 'pub fnc main(): void {\n  stdio.println(Integer.'+
    operationName[v.operation]+'('+v.left+', '+v.right+'));\n  return;\n}\n';
}
export function validateContractBytes(raw){
  const errors=[];
  if(!Buffer.isBuffer(raw)||raw.length<10||raw.length>65536)
    return {ok:false,errors:['contract bytes must be a bounded Buffer']};
  const blob=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  if(blob!==CONTRACT_GIT_BLOB)errors.push('canonical contract Git blob mismatch');
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{return {ok:false,errors:[...errors,'invalid contract UTF-8/JSON']};}
  if(!object(data)||data.contract!=='oreslang.strict-named-integer-arithmetic.v1'||
    !Array.isArray(data.cases)||data.cases.length!==26)
    return {ok:false,errors:[...errors,'invalid contract identity/count']};
  const ids=new Set();
  for(const v of data.cases){
    if(!object(v)||typeof v.id!=='string'||ids.has(v.id)){
      errors.push('invalid/duplicate case id');continue;
    }
    ids.add(v.id);
    try{
      if(JSON.stringify(oracle(v))!==JSON.stringify(v.expect))
        errors.push('oracle disagreement: '+v.id);
      guestSource(v);
    }catch{errors.push('invalid case: '+v.id);}
  }
  return {ok:errors.length===0,errors,data,gitBlob:blob,sha256:hash(raw)};
}
export function canonicalContract(){
  const stat=lstatSync(CONTRACT);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)invalid('contract file');
  const c=validateContractBytes(readFileSync(CONTRACT));
  if(!c.ok)throw new Error(c.errors.join('; '));
  return c;
}
const allowed=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
export function verifyReceipt(receipt,contract){
  const errors=[],fail=s=>errors.push(s);
  if(!contract?.ok)return {ok:false,status:'INVALID_CONTRACT',errors:['untrusted contract']};
  if(!object(receipt)||receipt.status!=='EXECUTED')
    return {ok:false,status:'NOT_EXECUTED',errors:['missing executed guest receipt']};
  if(!allowed(receipt,['schema','status','backend','repository','contractGitBlob',
    'contractSha256','sourceCommit','compilerCommit','compilerBinarySha256',
    'guestArtifactSha256','executionMode','evidence','cases']))
    fail('unknown receipt fields');
  if(receipt.schema!=='oreslang.strict-named-i64.receipt/1')fail('unknown schema');
  if(!Object.hasOwn(REPOS,receipt.backend))fail('unknown backend');
  else if(receipt.repository!==REPOS[receipt.backend])fail('repository mismatch');
  if(receipt.contractGitBlob!==contract.gitBlob||receipt.contractSha256!==contract.sha256)
    fail('contract digest mismatch');
  for(const k of ['sourceCommit','compilerCommit'])
    if(!sha40.test(receipt[k]))fail(k+' invalid SHA');
  for(const k of ['compilerBinarySha256','guestArtifactSha256'])
    if(!sha64.test(receipt[k]))fail(k+' invalid SHA');
  if(!['guest-runtime','guest-aot'].includes(receipt.executionMode))
    fail('unsupported guest execution mode');
  const e=receipt.evidence;
  if(!allowed(e,['runId','jobId','runAttempt','runUrl','runnerId','runnerName',
    'executedSteps','steps','workflowConclusion','guestExecuted','hostStub',
    'compilerProduced','logsSha256']))fail('missing/unknown evidence fields');
  if(object(e)){
    for(const k of ['runId','jobId','runAttempt','runnerId','executedSteps'])
      if(!Number.isSafeInteger(e[k])||e[k]<=0)fail(k+' must be a positive safe integer');
    if(typeof e.runnerName!=='string'||!e.runnerName.trim())fail('runnerName missing');
    if(e.workflowConclusion!=='success')fail('workflow not successful');
    if(e.guestExecuted!==true||e.compilerProduced!==true||e.hostStub!==false)
      fail('host stub or unexecuted guest cannot qualify');
    if(!sha64.test(e.logsSha256))fail('logsSha256 missing');
    if(Object.hasOwn(REPOS,receipt.backend)){
      const prefix='https://github.com/'+REPOS[receipt.backend]+'/actions/runs/';
      if(typeof e.runUrl!=='string'||!e.runUrl.startsWith(prefix)||
        !/^[1-9][0-9]*$/.test(e.runUrl.slice(prefix.length)))fail('runUrl repository mismatch');
    }
    if(!Array.isArray(e.steps)||e.steps.length===0||e.steps.length!==e.executedSteps||
      e.steps.some(s=>!allowed(s,['name','conclusion'])||
        typeof s.name!=='string'||!s.name.trim()||s.conclusion!=='success'))
      fail('missing or unsuccessful executed steps');
  }
  if(!Array.isArray(receipt.cases)||receipt.cases.length!==26)
    fail('incomplete guest cases');
  else{
    contract.data.cases.forEach((v,i)=>{
      const caseResult=receipt.cases[i];
      if(!allowed(caseResult,['id','guestSourceSha256','observed'])||caseResult.id!==v.id){
        fail('case identity/order mismatch '+i);return;
      }
      if(caseResult.guestSourceSha256!==hash(Buffer.from(guestSource(v))))
        fail('guest source digest mismatch '+v.id);
      const expected=oracle(v);
      if(!allowed(caseResult.observed,['value','error'])||
        JSON.stringify(caseResult.observed)!==JSON.stringify(expected))
        fail('guest observation mismatch '+v.id);
    });
  }
  return {ok:errors.length===0,status:errors.length?'INVALID':'SHAPE_ONLY_NOT_ATTESTED',errors};
}
export function compareReceipts(receipts,contract){
  if(!Array.isArray(receipts)||receipts.length!==5)
    return {ok:false,status:'NOT_EXECUTED',errors:['exactly five backend receipts required']};
  const errors=[],seen=new Set();
  for(const receipt of receipts){
    const r=verifyReceipt(receipt,contract);
    if(!r.ok)errors.push((receipt?.backend||'unknown')+': '+r.errors.join(', '));
    if(seen.has(receipt?.backend))errors.push('duplicate backend receipt');
    seen.add(receipt?.backend);
  }
  for(const b of Object.keys(REPOS))if(!seen.has(b))errors.push('missing '+b);
  return {ok:errors.length===0,status:errors.length?'NOT_EXECUTED':'SHAPE_ONLY_NOT_ATTESTED',errors};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const c=canonicalContract();
    if(!process.argv[2]){
      console.error('26 vectors pinned; all backends NOT_EXECUTED');
      process.exitCode=2;
    }else{
      const filepath=resolve(process.argv[2]),st=lstatSync(filepath);
      if(!st.isFile()||st.isSymbolicLink()||st.size>262144)throw new Error('invalid receipt path');
      const receipt=JSON.parse(readFileSync(filepath,'utf8'));
      const r=Array.isArray(receipt)?compareReceipts(receipt,c):verifyReceipt(receipt,c);
      if(!r.ok){for(const error of r.errors)console.error(error);process.exitCode=1;}
      else console.log('RECEIPT_SHAPE_ONLY: structurally consistent, NOT independently attested');
    }
  }catch(e){console.error('strict-named-i64: '+String(e.message||e));process.exitCode=1;}
}