/** Execute each wave's own pinned guest-source fixture validator; host-only evidence. */
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const deny=s=>{throw Error('wave9-source-validation: '+s)};
export const VALIDATORS=Object.freeze([
 {path:'parity/wave1/bin/wave1.mjs',sha:'a1c46940235b07c37ed520027e1383dc2439eea4',args:['--list'],flag:'verified'},
 {path:'parity/wave2/bin/wave2.mjs',sha:'003105cb898dbf35829420a8c54c3b9783482e42',args:['--list'],flag:'verified'},
 {path:'parity/wave3/bin/wave3.mjs',sha:'ee2914e0294f02edf51aa0c52afd8f13048700a5',args:['--validate'],flag:'verified',status:'SOURCE_CONTRACT_VALID_ONLY'},
 {path:'parity/wave4/bin/manifest.mjs',sha:'5e0b2e20ad47428c20e7d764aa81759bc3b87051',args:['--validate'],flag:'compilerExecuted',status:'CONTRACT_VALID_ONLY'},
 {path:'parity/wave5/bin/validate.mjs',sha:'b1bcb088dc23809425c338da56b0a93baf83564d',args:['--validate'],flag:'compilerExecuted',status:'SOURCE_CONTRACT_ONLY'},
 {path:'parity/wave6/bin/check.mjs',sha:'cd7f451eb7c05a2a499bf24ae56b8597f347dcf1',args:[],flag:'realCompilerExecuted',status:'PINNED_CONTRACT_ONLY'}
]);
const gitBlob=buf=>createHash('sha1').update(Buffer.from('blob '+buf.length+'\0')).update(buf).digest('hex');
export function assessValidatorOutput(wave,stdout){
 if(!Number.isInteger(wave)||wave<1||wave>6||typeof stdout!=='string'||stdout.length>512*1024)deny('invalid wave/output');
 let doc;try{doc=JSON.parse(stdout)}catch{deny('validator failed to emit single JSON object')}
 if(!doc||Array.isArray(doc)||typeof doc!=='object')deny('invalid validator output');
 const spec=VALIDATORS[wave-1];
 if(!Object.hasOwn(doc,spec.flag)||doc[spec.flag]!==false||spec.status!==undefined&&doc.status!==spec.status)deny('validator claims compiler execution or mismatched source contract');
 for(const flag of ['verified','certifiedParity','compilerExecuted','guestExecuted','parityVerified','releaseCertified','realCompilerExecuted']){
  if(Object.hasOwn(doc,flag)&&doc[flag]!==false)deny('forbidden verification promotion '+flag);
 }
 return Object.freeze({status:'SOURCE_FIXTURES_VALIDATED_HOST_ONLY',wave,validator:spec.path,validatorGitBlob:spec.sha,compilerExecuted:false,parityVerified:false});
}
export function assessValidatorProcess(wave,processResult){
 if(!processResult||processResult.error||processResult.signal||processResult.status!==0||processResult.stderr!==''||typeof processResult.stdout!=='string')deny('source validator exited unsuccessfully');
 return assessValidatorOutput(wave,processResult.stdout);
}
export async function runSourceValidator({wave,root,timeoutMs=20000,env=process.env}={}){
 if(!Number.isInteger(wave)||wave<1||wave>6||typeof root!=='string'||!isAbsolute(root)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)deny('unsafe source validation invocation');
 const spec=VALIDATORS[wave-1],path=resolve(root,spec.path),st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>512*1024)deny('missing or unsafe source validator');
 const rootReal=await realpath(root),actual=await realpath(path),rel=relative(rootReal,actual);
 if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))deny('validator symlink escape');
 if(gitBlob(await readFile(path))!==spec.sha)deny('validator Git blob differs from reviewed source');
 const clean=Object.fromEntries(['PATH','HOME','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR','COMSPEC'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
 clean.CI='true';clean.NODE_OPTIONS='';
 const result=spawnSync(process.execPath,[path,...spec.args],{cwd:root,encoding:'utf8',shell:false,timeout:timeoutMs,maxBuffer:512*1024,env:clean,windowsHide:true});
 return assessValidatorProcess(wave,result);
}
