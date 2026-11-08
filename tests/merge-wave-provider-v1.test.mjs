import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGitHubReadOnlyClient, validateManifest, collectWave} from '../src/merge-wave-provider-v1.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const p=(repo='org/repo',number=1,extra={})=>({repo,number,expectedHead:A,expectedBaseSha:B,requiredStepNames:['Test'],requiredWorkflows:[{workflowId:7,workflowName:'CI',jobName:'tests',testStepName:'Test'}],...extra});
const manifest=(...specs)=>({prs:specs.length?specs:[p()]});
const ok=(body,status=200)=>({ok:status>=200 && status<300,status,json:async()=>body});
function clientForMock(handler,{maxPages=10,pageSize=100}={}){
 const calls=[];
 const fetchImpl=async (url,options)=>{calls.push({url,options});return handler(url,options,calls.length)};
 return {api:makeGitHubReadOnlyClient({token:'SECRET_NOT_FOR_LOGS',fetchImpl,maxPages,pageSize}),calls};
}

const bad = [
 ['missing manifest',null],['missing prs',{}],['null prs',{prs:null}],['empty prs',{prs:[]}],
 ['more than 20 prs',{prs:Array.from({length:21},(_,i)=>p('org/r',i+1))}],
 ['repo traversal',manifest(p('org/..'))],['owner traversal',manifest(p('../repo'))],
 ['three path components',manifest(p('org/repo/evil'))],['URL encoding in repo',manifest(p('org/repo%2Froot'))],
 ['query in repo',manifest(p('org/repo?x=1'))],['wrong PR number',manifest(p('org/repo',0))],
 ['negative PR',manifest(p('org/repo',-1))],['fractional PR',manifest(p('org/repo',1.5))],
 ['absent head sha',manifest(p('org/repo',1,{expectedHead:null}))],
 ['malformed head sha',manifest(p('org/repo',1,{expectedHead:'x'.repeat(40)}))],
 ['absent base sha',manifest(p('org/repo',1,{expectedBaseSha:null}))],
 ['empty required tests',manifest(p('org/repo',1,{requiredStepNames:[]}))],
 ['blank test step',manifest(p('org/repo',1,{requiredStepNames:['  ']}))],
 ['duplicate test policy step',manifest(p('org/repo',1,{requiredStepNames:['Test','Test']}))],
 ['oversized test name',manifest(p('org/repo',1,{requiredStepNames:['a'.repeat(161)]}))],
 ['depends on self',manifest(p('org/repo',1,{dependsOn:1}))],
 ['invalid depends on string',manifest(p('org/repo',1,{dependsOn:'2'}))],
 ['duplicate PR',manifest(p(),p())],
];
for(const [name,body] of bad) test('manifest rejects '+name,()=>assert.throws(()=>validateManifest(body)));
test('well-formed fixture manifest validated without mutation',()=>{
 const value=manifest(p('org/site',1),p('org/site',2),p('org/editor',3),p('org/cli',4),p('org/cli',5,{dependsOn:4}));
 assert.equal(validateManifest(value),value);
});

test('read client rejects missing token and unsafe configuration',()=>{
 assert.throws(()=>makeGitHubReadOnlyClient({token:null}),/token/i);
 assert.throws(()=>makeGitHubReadOnlyClient({token:'x',maxPages:11}),RangeError);
 assert.throws(()=>makeGitHubReadOnlyClient({token:'x',pageSize:0}),RangeError);
 assert.throws(()=>makeGitHubReadOnlyClient({token:'x',fetchImpl:'not function'}),TypeError);
});
test('client does not expose mutating methods',()=>{
 const {api}=clientForMock(()=>ok({}));
 assert.deepEqual(Object.keys(api),['get']);
 assert.equal(api.post,undefined);assert.equal(api.patch,undefined);assert.equal(api.delete,undefined);
});
test('single-object fetch uses GET, no redirects, fixed origin and bearer credential',async()=>{
 const {api,calls}=clientForMock(()=>ok({number:1}));
 const body=await api.get('/repos/org/repo/pulls/1','object');
 assert.equal(body.number,1);assert.equal(calls.length,1);
 const c=calls[0],url=new URL(c.url);
 assert.equal(url.origin,'https://api.github.com');assert.equal(url.pathname,'/repos/org/repo/pulls/1');
 assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');
 assert.equal(c.options.headers.Authorization,'Bearer SECRET_NOT_FOR_LOGS');
 assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('per_page'),'100');
});
test('malformed single-object payload is rejected',async()=>{
 const {api}=clientForMock(()=>ok([{}]));
 await assert.rejects(api.get('/repos/org/repo/pulls/1','object'),/Malformed provider object/);
});
test('read client fails closed on HTTP error without leaking bearer token',async()=>{
 const {api}=clientForMock(()=>ok({message:'unauthorized'},401));
 await assert.rejects(api.get('/repos/org/repo/pulls/1'),e=>{
  assert.match(e.message,/401/);assert.doesNotMatch(e.message,/SECRET_NOT_FOR_LOGS/);return true;
 });
});
test('path traversal and nonrepo resources are rejected before network',async()=>{
 const {api,calls}=clientForMock(()=>{throw Error('fetch must not be called')});
 for(const path of ['/users/me','/repos/org/../admin','/repos/../repo/pulls/1',
   '/repos/org%2Frepo/r/pulls','/repos/org/repo/#fragment','/repos/org/repo/../admin',
   '/repos/org/repo/%2e%2e/admin','/repos/org/repo//pulls/1']){
  await assert.rejects(api.get(path),Error);
 }
 assert.equal(calls.length,0);
});
test('unknown response kind is rejected before fetching',async()=>{
 const {api,calls}=clientForMock(()=>ok({}));
 await assert.rejects(api.get('/repos/org/repo/pulls/1','raw'),/Unknown provider response kind/);
 assert.equal(calls.length,0);
});
test('array pagination combines exactly two pages and retains order',async()=>{
 const {api,calls}=clientForMock((url)=>{
  const page=Number(new URL(url).searchParams.get('page'));
  return ok(page===1?[{id:1},{id:2}]:[{id:3}]);
 },{pageSize:2});
 const result=await api.get('/repos/org/repo/pulls/1/reviews','array');
 assert.deepEqual(result.map(x=>x.id),[1,2,3]);assert.equal(calls.length,2);
});
test('workflow_runs envelope pagination supported',async()=>{
 const {api}=clientForMock((url)=>ok({workflow_runs:Number(new URL(url).searchParams.get('page'))===1?[{id:1},{id:2}]:[{id:3}]}),{pageSize:2});
 assert.deepEqual((await api.get('/repos/org/repo/actions/runs','runs')).map(x=>x.id),[1,2,3]);
});
test('jobs envelope pagination supported',async()=>{
 const {api}=clientForMock((url)=>ok({jobs:Number(new URL(url).searchParams.get('page'))===1?[{id:1},{id:2}]:[{id:3}]}),{pageSize:2});
 assert.deepEqual((await api.get('/repos/org/repo/actions/runs/1/jobs','jobs')).map(x=>x.id),[1,2,3]);
});
test('pagination exactly full at limit fails closed',async()=>{
 const {api,calls}=clientForMock(()=>ok([{id:1}]),{maxPages:2,pageSize:1});
 await assert.rejects(api.get('/repos/org/repo/pulls/1/reviews','array'),/pagination limit exceeded/);
 assert.equal(calls.length,2);
});
test('unexpected paginated response shape is rejected',async()=>{
 const {api}=clientForMock(()=>ok({workflow_runs:'not array'}));
 await assert.rejects(api.get('/repos/org/repo/actions/runs','runs'),/Malformed provider pagination/);
});
test('jobs response must have jobs array',async()=>{
 const {api}=clientForMock(()=>ok({jobs:null}));
 await assert.rejects(api.get('/repos/org/repo/actions/runs/1/jobs','jobs'),/Malformed provider pagination/);
});
test('network rejection propagates without substituting evidence',async()=>{
 const {api}=clientForMock(()=>Promise.reject(Error('network failure')));
 await assert.rejects(api.get('/repos/org/repo/pulls/1'),/network failure/);
});
test('empty page stops immediately',async()=>{
 const {api,calls}=clientForMock(()=>ok([]));
 assert.deepEqual(await api.get('/repos/org/repo/pulls/1/reviews','array'),[]);
 assert.equal(calls.length,1);
});

function makeFive(){return manifest(p('org/site',1),p('org/site',2),p('org/editor',3),p('org/cli',4),p('org/cli',5,{dependsOn:4}));}
function mockFive({approval=true,ci=true,parentMerged=true,stacked=false}={}){
 const value=makeFive();const known=new Map(value.prs.map(x=>[x.repo+'#'+x.number,x]));
 const calls=[];
 const client={get:async (path,kind)=>{
  calls.push({path,kind});
  const match=/^\/repos\/([^/]+\/[^/]+)\/(.*)$/.exec(path);
  if(!match) throw new Error('bad resource '+path);
  const repo=match[1],sub=match[2];
  let n=Number(/^pulls\/(\d+)/.exec(sub)?.[1]);
  if(Number.isInteger(n) && Number.isSafeInteger(n) && /^pulls\/\d+$/.test(sub)){
   const sp=known.get(repo+'#'+n);
   if (!sp) throw new Error('unknown PR '+n);
   const isParent=n===4;
   return {number:n,user:{login:'the1mills'},state:'open',merged:isParent?parentMerged:false,
    merged_at:isParent&&parentMerged?'2026-11-07T20:00:00Z':null,
    draft:false,mergeable:true,head:{sha:sp.expectedHead},
    base:{sha:sp.expectedBaseSha,ref:stacked&&n===5?'feature':'main',repo:{full_name:repo}}};
  }
  n=Number(/^pulls\/(\d+)\/reviews$/.exec(sub)?.[1]);
  if(Number.isSafeInteger(n) && /^pulls\/\d+\/reviews$/.test(sub))
    return approval?[{user:{login:'ORESoftware'},state:'APPROVED',commit_id:A,submitted_at:'2026-11-07T23:00:00Z'}]:[];
  if(sub.startsWith('actions/runs?'))
    return ci?[{id:1000+value.prs.find(x=>x.repo===repo)?.number,event:'pull_request',
      head_sha:A,status:'completed',conclusion:'success',run_attempt:1,workflow_id:7,name:'CI'}]:[];
  const run=/^actions\/runs\/(\d+)\/jobs\?filter=latest$/.exec(sub);
  if(run) return [{name:'tests',run_id:Number(run[1]),runner_id:3,run_attempt:1,
    conclusion:'success',steps:[{name:'Test',status:'completed',conclusion:'success'}]}];
  throw new Error('Unhandled GET '+path+' '+kind);
 }};
 return {value,client,calls};
}

test('collector refuses to touch provider when manifest invalid',async()=>{
 let called=0;const invalid=manifest(p('org/..'));
 await assert.rejects(collectWave(invalid,{get:async()=>{called++;throw Error('must not call')}}),/Invalid pinned PR/);
 assert.equal(called,0);
});
test('collector executes GET-only provider interface and returns non-authorizing report',async()=>{
 const {value,client,calls}=mockFive();const r=await collectWave(value,client);
 assert.equal(r.mergeAuthorized,false);assert.equal(r.advisoryOnly,true);
 assert.equal(r.prs.length,5);assert.equal(r.distinctReadyRepos<=3,true);
 assert.ok(calls.every(x=>x.path.startsWith('/repos/')));
});
test('collector rejects candidate when independent approval absent',async()=>{
 const {value,client}=mockFive({approval:false});const r=await collectWave(value,client);
 assert.equal(r.readyForHumanFinalReview,false);
 assert.ok(r.prs.every(x=>x.blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL')));
});
test('collector rejects candidate when CI run list is empty',async()=>{
 const {value,client}=mockFive({ci:false});const r=await collectWave(value,client);
 assert.equal(r.readyForHumanFinalReview,false);
 assert.ok(r.prs.every(x=>x.blockers.includes('NO_EXACT_HEAD_PR_RUN')));
});
test('collector refuses an unmerged stacked dependency',async()=>{
 const {value,client}=mockFive({parentMerged:false,stacked:true});const r=await collectWave(value,client);
 assert.ok(r.prs[4].blockers.includes('PARENT_NOT_MERGED'));
 assert.ok(r.prs[4].blockers.includes('NOT_MAIN_BASED'));
});
test('collector refuses a still-stacked dependency even if parent has merged',async()=>{
 const {value,client}=mockFive({parentMerged:true,stacked:true});const r=await collectWave(value,client);
 assert.ok(r.prs[4].blockers.includes('NOT_MAIN_BASED'));
});
test('collector requires read provider',async()=>{
 await assert.rejects(collectWave(makeFive(),null),/Missing read-only provider/);
});
test('collector rejects malformed run identities before job lookups',async()=>{
 const {value,client}=mockFive();const get=client.get;
 client.get=async (path,kind)=>kind==='runs'?[{id:0,head_sha:A,event:'pull_request',
   conclusion:'success',status:'completed',run_attempt:1}]:get(path,kind);
 await assert.rejects(collectWave(value,client),/Malformed provider run identity/);
});
test('five independent approvals in three repositories satisfy advisory wave while never authorizing merge',async()=>{
 const {value,client}=mockFive({parentMerged:false});delete value.prs[4].dependsOn;
 const r=await collectWave(value,client);
 assert.equal(r.readyForHumanFinalReview,true,JSON.stringify(r.prs.map(x=>x.blockers)));
 assert.equal(r.readyCount,5);assert.equal(r.distinctReadyRepos,3);
 assert.equal(r.mergeAuthorized,false);
});
test('provider rejects malformed input before outgoing GET after spec validation failure',async()=>{
 const {value,client,calls}=mockFive();value.prs[4].requiredStepNames.push('Test');
 await assert.rejects(collectWave(value,client),/Invalid pinned PR identity/);
 assert.equal(calls.length,0);
});

test('manifest cannot remove pinned workflow policy',()=>{
 const x=manifest(p());delete x.prs[0].requiredWorkflows;
 assert.throws(()=>validateManifest(x),/Invalid pinned PR identity/);
});
test('manifest rejects duplicate, malformed, and unpinned workflow contracts',()=>{
 const x=manifest(p());x.prs[0].requiredWorkflows.push({...x.prs[0].requiredWorkflows[0]});
 assert.throws(()=>validateManifest(x),/Invalid pinned PR identity/);
 const y=manifest(p());y.prs[0].requiredWorkflows[0].workflowId=0;
 assert.throws(()=>validateManifest(y),/Invalid pinned PR identity/);
 const z=manifest(p());z.prs[0].requiredWorkflows[0].testStepName=' ';
 assert.throws(()=>validateManifest(z),/Invalid pinned PR identity/);
});
test('read-only provider reports missing required workflow on otherwise green run',async()=>{
 const {value,client}=mockFive();const original=client.get;
 client.get=async (path,kind)=>{
   const response=await original(path,kind);
   return kind==='runs'?response.map(x=>({...x,workflow_id:1234})):response;
 };
 const result=await collectWave(value,client);
 assert.equal(result.readyForHumanFinalReview,false);
 assert.ok(result.prs.every(x=>x.blockers.includes('MISSING_REQUIRED_WORKFLOW')));
});
