/** Executes all six pinned same-repo host suites. This is NOT guest compiler execution. */
import {readFile,lstat,readdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {validateInventory,mergeReadiness} from './inventory.mjs';
import {assessProcess} from './test-evidence.mjs';

const fail=s=>{throw Error('integration-runner: '+s)};
const safeEnv=()=>Object.fromEntries(['PATH','HOME','TMPDIR','TEMP','TMP','SYSTEMROOT','WINDIR','COMSPEC'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]).concat([['CI','true'],['NODE_OPTIONS','']]));
function gitAt(root,args){
 const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',shell:false,timeout:20000,maxBuffer:131072,env:safeEnv()});
 if(result.error||result.signal||result.status!==0||result.stderr)fail('git cannot prove local checkout at '+root+': '+String(result.error?.message||result.stderr||result.status));
 return result.stdout.trim();
}
const blobHash=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
async function regular(path,max=1048576,rootReal=null){
 const s=await lstat(path);
 if(!s.isFile()||s.isSymbolicLink()||s.size<=0||s.size>max)fail('missing, symlinked or oversized file: '+path);
 if(rootReal!==null){const actual=await realpath(path),sub=relative(rootReal,actual);if(sub==='..'||sub.startsWith('../')||isAbsolute(sub))fail('intermediate symlink escapes checkout: '+path)}
}
export async function verifyCheckout(w,workspace){
 if(!w||!Number.isInteger(w.wave)||w.wave<1||w.wave>6)fail('invalid wave');
 if(typeof workspace!=='string'||!isAbsolute(workspace))fail('absolute checkout root required');
 const root=resolve(workspace,'wave'+w.wave);
 if(relative(workspace,root).startsWith('..'))fail('outside workspace');
 const st=await lstat(root);if(!st.isDirectory()||st.isSymbolicLink())fail('nonregular checkout root');
 const rootReal=await realpath(root);
 const head=gitAt(root,['rev-parse','HEAD']);
 if(head!==w.head)fail('source commit drift: wave '+w.wave+' observed '+head+' wanted '+w.head);
 const dirty=gitAt(root,['status','--porcelain=v1','--untracked-files=all']);
 if(dirty)fail('tracked source tree modified before tests wave '+w.wave);
 for(const path of w.changedFiles)await regular(join(root,path),16*1024*1024,rootReal);
 const pins=[];
 for(const p of w.pinnedFiles){
  const path=join(root,p.path);await regular(path,1048576,rootReal);
  const blob=blobHash(await readFile(path));
  if(blob!==p.gitBlob)fail('source Git blob mismatch wave '+w.wave+': '+p.path);
  pins.push({path:p.path,gitBlob:blob});
 }
 const testsDir=join(root,'parity','wave'+w.wave,'tests'),children=await readdir(testsDir);
 const tests=children.filter(x=>/^[a-zA-Z0-9_-]+\.test\.mjs$/.test(x)).sort();
 if(!tests.length||tests.length>30)fail('wave '+w.wave+' has no bounded Node suites');
 for(const t of tests)await regular(join(testsDir,t),1048576,rootReal);
 const selected=tests.map(t=>'parity/wave'+w.wave+'/tests/'+t);
 const expected=w.changedFiles.filter(p=>p.startsWith('parity/wave'+w.wave+'/tests/')&&p.endsWith('.test.mjs')).sort();
 if(JSON.stringify(selected)!==JSON.stringify(expected))fail('unreviewed/missing test program wave '+w.wave);
 return Object.freeze({wave:w.wave,head,root,pins,tests:selected});
}
export async function runIntegration({inventoryPath,checkoutRoot,outputPath,timeoutMs=180000}={}){
 if(typeof inventoryPath!=='string'||!isAbsolute(inventoryPath)||typeof checkoutRoot!=='string'||!isAbsolute(checkoutRoot)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)fail('invalid bounded run arguments');
 await regular(inventoryPath);
 const doc=JSON.parse(await readFile(inventoryPath,'utf8')),sourceInventory=validateInventory(doc);
 const report={schemaVersion:1,status:'STARTED',scope:'NODE_HOST_CONFORMANCE_ONLY',inventory:sourceInventory,results:[],compilerParityVerified:false,releaseCertified:false,independentRunnerAttestation:false};
 for(const w of doc.waves){
  let check=null;
  try {
   check=await verifyCheckout(w,checkoutRoot);
   const cmd=spawnSync(process.execPath,['--test','--test-reporter=tap',...check.tests],{cwd:check.root,encoding:'utf8',shell:false,timeout:timeoutMs,maxBuffer:2*1024*1024,env:safeEnv(),windowsHide:true});
   let tap=null,observationError=null;
   try{tap=assessProcess(cmd,{minimumTests:check.tests.length})}catch(e){observationError=String(e.message||e)}
   const after=gitAt(check.root,['status','--porcelain=v1','--untracked-files=all']);
   const status=cmd.error?.code==='ETIMEDOUT'?'TIMEOUT':cmd.signal?'SIGNALED':after?'SOURCE_MUTATED':tap?'PASSED':'NO_CONFIRMED_TESTS';
   report.results.push({wave:w.wave,head:check.head,status,exitCode:Number.isInteger(cmd.status)?cmd.status:null,
    tests:check.tests,pinned:check.pins,stdoutTail:String(cmd.stdout||'').slice(-2500),stderrTail:String(cmd.stderr||'').slice(-1500),
    testCounts:tap?.counts??null,observationError,hostSuiteRan:!cmd.error,guestCompilerRan:false});
  }catch(e){
   report.results.push({wave:w.wave,head:w.head,status:'BLOCKED_BEFORE_TEST',exitCode:null,
    tests:check?.tests??[],pinned:check?.pins??[],stdoutTail:'',stderrTail:'',testCounts:null,
    observationError:String(e?.message||e).slice(0,1000),hostSuiteRan:false,guestCompilerRan:false});
  }
 }
 const readiness=mergeReadiness(report);
 report.readiness=readiness;
 report.status=readiness.hostReadiness==='BLOCKED'?'HOST_SUITES_FAILED':'HOST_SUITES_OBSERVED_UNATTESTED';
 if(outputPath!==undefined){
  if(typeof outputPath!=='string'||!isAbsolute(outputPath))fail('absolute output report required');
  await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return report;
}
const calledPath=process.argv[1]?resolve(process.argv[1]):'';
if(calledPath===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length!==2||!args[0].startsWith('--checkouts=')||!args[1].startsWith('--inventory='))fail('use --checkouts=/absolute/path --inventory=/absolute/path');
  const result=await runIntegration({checkoutRoot:args[0].slice(12),inventoryPath:args[1].slice(12)});
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.status==='HOST_SUITES_FAILED'?1:0;
 }catch(e){console.error(e.stack||e.message);process.exitCode=2}
}
