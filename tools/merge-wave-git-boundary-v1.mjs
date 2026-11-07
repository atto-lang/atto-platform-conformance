// Fail-closed local Git fetch preflight. Not a trusted release or merge authority.
const REMOTE='https://github.com/ores-truffle-oreslang/oreslang-platform-conformance';
const MAX_CONFIG=65536,MAX_ENTRIES=256;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&
 Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,'value'));
const denyKey=k=>k.startsWith('url.')||k.startsWith('http.')||k.startsWith('credential.')||
 k.startsWith('include.')||k.startsWith('includeif.')||k.startsWith('protocol.')||
 k.startsWith('filter.')||k.startsWith('submodule.')||k.startsWith('alias.')||
 /^remote\.(?!origin\.url$|origin\.fetch$)/.test(k)||
 ['core.sshcommand','core.hookspath','core.fsmonitor','core.gitproxy',
  'core.worktree','extensions.worktreeconfig'].includes(k);
const envKey=k=>/^(GIT_|GITHUB_TOKEN$|GH_TOKEN$|FETCH_TOKEN$|SSH_ASKPASS$|NODE_OPTIONS$|LD_PRELOAD$|LD_LIBRARY_PATH$|BASH_ENV$|ENV$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(k);
const envAllowed=(k,v)=>(k==='GIT_TERMINAL_PROMPT'&&v==='0')||
 (k==='GIT_OPTIONAL_LOCKS'&&v==='0')||(k==='GIT_NO_REPLACE_OBJECTS'&&v==='1');

export function parseGitNullConfig(v){
 if(typeof v!=='string'||v.length>MAX_CONFIG||(v!==''&&!v.endsWith('\0')))
  throw Error('CONFIG_ENCODING_INVALID');
 if(v==='')return [];
 const rows=v.slice(0,-1).split('\0');
 if(rows.length>MAX_ENTRIES)throw Error('CONFIG_UNBOUNDED');
 return rows.map(row=>{
  const p=row.indexOf('\n');
  if(p<1||p===row.length-1||row.indexOf('\n',p+1)!==-1)
   throw Error('CONFIG_RECORD_INVALID');
  const key=row.slice(0,p),value=row.slice(p+1);
  if(key.length>200||value.length>4096||/[\x00-\x1f\x7f]/.test(key+value)||
   !/^[a-zA-Z][a-zA-Z0-9.:/_-]*$/.test(key))throw Error('CONFIG_RECORD_INVALID');
  return {key:key.toLowerCase(),value};
 });
}
export function inspectGitBoundary({phase,origin,configText,env}={}){
 const problems=new Set(),fail=s=>problems.add(s);
 if(phase!=='preflight'&&phase!=='postflight')fail('PHASE_INVALID');
 if(typeof origin!=='string'||!(origin===REMOTE||origin===REMOTE+'.git'))
  fail('REMOTE_ORIGIN_UNVERIFIED');
 if(!plain(env))fail('ENVIRONMENT_SHAPE_INVALID');
 else if(Object.keys(env).length>4096)fail('ENVIRONMENT_UNBOUNDED');
 else for(const [k,v] of Object.entries(env)){
  if(typeof v!=='string')fail('ENVIRONMENT_SHAPE_INVALID');
  else if(envKey(k)&&!envAllowed(k,v))fail('INHERITED_ENVIRONMENT_OVERRIDE');
 }
 try{
  const rows=parseGitNullConfig(configText),seen=new Set();let origins=0;
  for(const {key,value} of rows){
   if(seen.has(key))fail('CONFIG_DUPLICATE_KEY');
   seen.add(key);
   if(key==='remote.origin.url'){
    origins++;
    if(value!==origin||!(value===REMOTE||value===REMOTE+'.git'))
     fail('CONFIG_REMOTE_ORIGIN_MISMATCH');
   }else if(denyKey(key))fail('CONFIG_REDIRECT_OR_CREDENTIAL_OVERRIDE');
  }
  if(origins!==1)fail('CONFIG_REMOTE_IDENTITY_UNVERIFIED');
 }catch{fail('CONFIG_RECORDS_UNVERIFIED');}
 return {schema_version:1,kind:'ATTO_LOCAL_GIT_FETCH_BOUNDARY_V1',
  preflight_ok:problems.size===0,status:problems.size===0?'STRUCTURAL_CHECK_ONLY':'BLOCKED',
  merge_authorized:false,guest_certified:false,blockers:[...problems].sort()};
}
export async function checkLocalGitBoundary(phase){
 const {spawnSync}=await import('node:child_process');
 if(phase!=='preflight'&&phase!=='postflight')throw Error('PHASE_INVALID');
 // Node process.env is a special host object; make a plain, immutable-to-caller
 // string-entry snapshot before evaluating inherited Git and credential overrides.
 const inherited=Object.fromEntries(Object.entries(process.env));
 const safe='remote.origin.url\n'+REMOTE+'\0';
 if(!inspectGitBoundary({phase,origin:REMOTE,configText:safe,env:inherited}).preflight_ok)
  throw Error('INHERITED_ENVIRONMENT_UNVERIFIED');
 const git=args=>{
  const x=spawnSync('/usr/bin/git',args,{encoding:null,maxBuffer:MAX_CONFIG+1024,
   env:{...inherited,GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
  if(x.error||x.status!==0||!Buffer.isBuffer(x.stdout))throw Error('GIT_READ_FAILED');
  return new TextDecoder('utf-8',{fatal:true}).decode(x.stdout);
 };
 const configText=git(['config','--null','--list']);
 const origin=git(['remote','get-url','origin']).trimEnd();
 const verdict=inspectGitBoundary({phase,origin,configText,env:inherited});
 if(!verdict.preflight_ok)throw Error(verdict.blockers.join(','));
 return verdict;
}
if(typeof process!=='undefined'&&process.argv?.[1]?.split('/').pop()==='merge-wave-git-boundary-v1.mjs'){
 try{await checkLocalGitBoundary(process.argv[2]);
  console.log('ATTO_LOCAL_GIT_BOUNDARY_STRUCTURAL_ONLY:'+process.argv[2]);
 }catch(e){console.error('ATTO_LOCAL_GIT_BOUNDARY_BLOCKED:'+String(e.message).slice(0,300));
  process.exitCode=1;}
}
