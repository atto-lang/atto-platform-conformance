import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectNative,inspectWasm,sha256} from './artifacts.mjs';
const bad=x=>{throw Error('wave5-evidence: '+x)};
const allowedTargets={
 llvm:['elf-x86_64','elf-aarch64','macho-x86_64','macho-arm64','pe-x64','pe-arm64'],
 net:['pe-x64','pe-arm64'],
 forge:['elf-x86_64','elf-aarch64','macho-x86_64','macho-arm64','pe-x64','pe-arm64'],
 wasm:['wasm32']
};
export const TASKS=Object.freeze({21:'actor-memory-domains',22:'llvm-real-native-aot',23:'net-native-aot',24:'forge-independent-compiler',25:'llvm-to-wasm-profiles'});
export function validateProfile({task,backend,target,wasmProfile='scalar',allowedImports=[]}={}){
 if(!Object.hasOwn(TASKS,task))bad('unknown task');
 if(task===21){if(backend!=='memory'||target!=='host-model')bad('task21 is host-only until source lowering');return true}
 const intended={22:'llvm',23:'net',24:'forge',25:'wasm'}[task];
 if(backend!==intended||!allowedTargets[backend]?.includes(target))bad('backend/native target mismatch');
 if(!Array.isArray(allowedImports))bad('import policies must be arrays');
 if(target!=='wasm32'&&(wasmProfile!=='scalar'||allowedImports.length))bad('native targets cannot use wasm import policy');
 if(target==='wasm32'&&(!['scalar','capability'].includes(wasmProfile)||!Array.isArray(allowedImports)))bad('invalid wasm profile');
 return true;
}
async function regularFile(path){
 if(typeof path!=='string'||!isAbsolute(path))bad('absolute artifact path required');
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())bad('artifact must be a regular non-symlink file');
 if(stat.size<8||stat.size>128*1024*1024)bad('artifact exceeds bounded size');
}
export async function inspectAot({task,backend,target,artifactPath,artifactSha256,wasmProfile='scalar',allowedImports=[]}={}){
 validateProfile({task,backend,target,wasmProfile,allowedImports});
 if(task===21)bad('no binary shortcut for guest memory isolation');
 if(typeof artifactSha256!=='string'||!/^[0-9a-f]{64}$/.test(artifactSha256))bad('caller must pin sha256');
 await regularFile(artifactPath);
 const bytes=await readFile(artifactPath);
 if(sha256(bytes)!==artifactSha256)bad('artifact hash changed');
 const evidence=target==='wasm32'?inspectWasm(bytes,{profile:wasmProfile,allowedImports}):inspectNative(bytes,target);
 return Object.freeze({
  task,backend,target,artifactSha256,artifactShape:evidence,
  status:'ARTIFACT_SHAPE_OBSERVED',guestExecuted:false,compilerExecuted:false,sourceTreeVerified:false,
  nativeAotProven:false,parityVerified:false,
  warning:'Binary headers/imports checked only. A native shell, JIT launcher, host bridge, or compiler provenance is not authenticated by this inspection.'
 });
}
export function observeGuest({argv,expectedStdout,expectedExit=0,timeoutMs=15000,spawn=spawnSync}={}){
 if(!Array.isArray(argv)||argv.length<1||argv.some(x=>typeof x!=='string'||!x||x.includes('\0'))||!isAbsolute(argv[0]))bad('absolute guest execution command required');
 if(typeof expectedStdout!=='string'||expectedStdout.length>4096||!Number.isSafeInteger(expectedExit)||expectedExit<0||expectedExit>255)bad('invalid guest oracle');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)bad('unsafe guest timeout');
 const result=spawn(argv[0],argv.slice(1),{shell:false,encoding:'utf8',timeout:timeoutMs,maxBuffer:65536,windowsHide:true});
 if(result.error)bad(result.error.code==='ETIMEDOUT'?'guest timeout':'guest launch error');
 if(result.signal)bad('guest signaled');
 if(result.status!==expectedExit||result.stderr||result.stdout!==expectedStdout)bad('guest result mismatch');
 return Object.freeze({status:'GUEST_RESULT_OBSERVED',exitCode:result.status,stdout:result.stdout,guestExecuted:true,provenanceVerified:false,parityVerified:false});
}
