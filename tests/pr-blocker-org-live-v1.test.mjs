import test from 'node:test';
import assert from 'node:assert/strict';
import {GithubReadError, githubReadClient, paged, searchWindow, inventoryOrg, inspectPR} from '../tools/pr-blocker-org-live-v1.mjs';
const H='a'.repeat(40), H2='b'.repeat(40), REPO='example/atlang';
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
function mock(routes) {
 const calls=[];
 const client=githubReadClient({token:'test-token',sleep:async()=>{},
  fetcher:async(url,config)=>{
   const u=new URL(url),key=u.pathname+u.search;
   calls.push({url:u,config});
   const handler=routes.find(x=>typeof x[0]==='function'?x[0](u):x[0]===u.pathname);
   if(!handler) throw Error('unexpected mock route '+key);
   return typeof handler[1]==='function'?handler[1](u,calls):handler[1];
  }});
 return{client,calls};
}
test('HTTP transport uses only GET, GitHub origin, non-redirecting authorization',async()=>{
 const {client,calls}=mock([['/installation/repositories',response({repositories:[],total_count:0})]]);
 await client.get('/installation/repositories');
 assert.equal(calls[0].config.method,'GET');assert.equal(calls[0].config.redirect,'error');
 assert.equal(calls[0].url.origin,'https://api.github.com');
 assert.equal(calls[0].config.headers.Authorization,'Bearer test-token');
 await assert.rejects(client.get('//evil.example/path'));
 await assert.rejects(client.get('/../evil'));
});
test('429 rate limit retries with bounded Retry-After, 403 permission does not retry',async()=>{
 let n=0;const delays=[];
 const client=githubReadClient({token:'x',sleep:async ms=>delays.push(ms),fetcher:async()=>
  ++n===1?response({message:'limit'},429,{'retry-after':'1'}):response({ok:true})});
 assert.deepEqual(await client.get('/x'),{ok:true});assert.deepEqual(delays,[1000]);
 assert.equal(client.stats.rateLimits,1);assert.equal(client.stats.retries,1);
 let forbidden=0;
 const deny=githubReadClient({token:'x',sleep:async()=>{throw Error('must not wait');},fetcher:async()=>{forbidden++;return response({},403);}});
 await assert.rejects(deny.get('/x'),e=>e instanceof GithubReadError&&e.kind==='PERMISSION_DENIED');
 assert.equal(forbidden,1);
});
test('response body is bounded and malformed JSON is denied',async()=>{
 const large=githubReadClient({token:'x',fetcher:async()=>new Response('x',{headers:{'content-length':String(9*1024*1024)}})});
 await assert.rejects(large.get('/x'),e=>e.kind==='BODY_TOO_LARGE');
 const malformed=githubReadClient({token:'x',fetcher:async()=>new Response('{bad')});
 await assert.rejects(malformed.get('/x'),e=>e.kind==='INVALID_JSON');
});
test('paged enumerates exact-multiple-of-100 and detects duplicate pages',async()=>{
 const a=Array.from({length:100},(_,i)=>({id:i+1}));
 const {client}=mock([[u=>u.pathname==='/x',u=>response(u.searchParams.get('page')==='1'?a:[{id:101}])]]);
 const result=await paged(client,'/x');assert.equal(result.items.length,101);assert.equal(result.complete,true);
 const bad=mock([[u=>u.pathname==='/y',u=>response(u.searchParams.get('page')==='1'?a:[{id:1}])]]);
 const result2=await paged(bad.client,'/y');assert.equal(result2.complete,false);
 assert.ok(result2.gaps.some(x=>x.kind==='DUPLICATE_PAGE_ITEM'));
});
test('search recursively partitions 1000-result cap into disjoint second windows',async()=>{
 const calls=[];const c={get:async(_path,params)=>{
  calls.push(params);
  if(params.q.includes('00:00:00Z..2026-11-06T00:00:03Z')) return {total_count:1000,items:[],incomplete_results:false};
  if(params.q.includes('00:00:00Z..2026-11-06T00:00:01Z'))return {total_count:0,items:[],incomplete_results:false};
  return{total_count:1,items:[{number:7,pull_request:{}}],incomplete_results:false};
 }};
 const r=await searchWindow(c,REPO,Date.parse('2026-11-06T00:00:00Z'),Date.parse('2026-11-06T00:00:04Z'));
 assert.equal(calls.length,3);assert.equal(r.complete,true);assert.deepEqual(r.items.map(x=>x.number),[7]);
});
test('saturated one-second interval fails closed rather than claiming exhaustion',async()=>{
 const c={get:async()=>({total_count:1000,items:[],incomplete_results:false})};
 const r=await searchWindow(c,REPO,Date.parse('2026-11-06T00:00:00Z'),Date.parse('2026-11-06T00:00:01Z'));
 assert.equal(r.complete,false);assert.ok(r.gaps.some(x=>x.kind==='SEARCH_1000_CAP_OR_INCOMPLETE'));
});
test('incomplete search response is recursively split and recorded if unsplittable',async()=>{
 const c={get:async()=>({total_count:0,items:[],incomplete_results:true})};
 const r=await searchWindow(c,REPO,Date.parse('2026-11-06T00:00:00Z'),Date.parse('2026-11-06T00:00:01Z'));
 assert.equal(r.complete,false);
});
test('inventory cross-check discloses missing search PR, never marks complete',async()=>{
 const pr={id:2,number:9,state:'open',head:{sha:H},base:{ref:'main'}};
 const {client}=mock([
  ['/installation/repositories',response({total_count:1,repositories:[{id:1,full_name:REPO}]})],
  [`/repos/${REPO}/pulls`,response([pr])],
  ['/search/issues',response({total_count:0,items:[],incomplete_results:false})]
 ]);
 const r=await inventoryOrg({client,org:'example',start:'2026-11-05T00:00:00Z',stop:'2026-11-06T00:00:00Z'});
 assert.equal(r.prs.length,1);assert.equal(r.complete,false);
 assert.ok(r.gaps.some(x=>x.kind==='SEARCH_MISSING_CANONICAL_PR'));
});
test('inaccessible repository inventory is a permission gap, not empty complete',async()=>{
 const {client}=mock([['/installation/repositories',response({},403)]]);
 const r=await inventoryOrg({client,org:'example',start:'2026-11-05T00:00:00Z',stop:'2026-11-06T00:00:00Z'});
 assert.equal(r.complete,false);assert.ok(r.gaps.some(x=>x.kind==='REPOSITORY_DISCOVERY_INCOMPLETE'));
});
test('inspection fetches attempts, each job step separately, review requests and unknown threads',async()=>{
 const observed=[]; const pr={state:'open',head:{sha:H},base:{ref:'main'},requested_reviewers:[{login:'someone'}]};
 const job=(id,attempt)=>({id,run_id:3,run_attempt:attempt,head_sha:H,runner_id:0,status:'completed',conclusion:'failure'});
 const {client}=mock([
  [`/repos/${REPO}/pulls/9`,()=>response(pr)],
  [`/repos/${REPO}/actions/runs`,response({workflow_runs:[{id:3,head_sha:H,run_attempt:2,status:'completed',conclusion:'failure'}],total_count:1})],
  [u=>u.pathname.includes('/attempts/1/jobs'),response({jobs:[job(10,1)],total_count:1})],
  [u=>u.pathname.includes('/attempts/2/jobs'),response({jobs:[job(11,2)],total_count:1})],
  [u=>u.pathname.includes('/actions/jobs/10'),response({...job(10,1),steps:[]})],
  [u=>u.pathname.includes('/actions/jobs/11'),response({...job(11,2),steps:null})],
  [`/repos/${REPO}/pulls/9/reviews`,response([{id:14,user:{login:'other'},state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T01:00:00Z',commit_id:H}])],
  [`/repos/${REPO}/branches/main/protection`,response({},403)]
 ]);
 let called=0;
 const classify=async({listRuns,listJobs,listSteps})=>{
  const runs=(await listRuns()).items;assert.equal(runs.length,2);
  for(const run of runs){const jobs=(await listJobs(null,run.id,run.run_attempt)).items;
   for(const j of jobs){const steps=(await listSteps(null,j.id)).steps;observed.push({id:j.id,steps});called++;}}
  return {records:[],gaps:[]};
 };
 const result=await inspectPR(client,REPO,9,classify);
 assert.equal(called,2);assert.deepEqual(observed.map(x=>x.id),[10,11]);
 assert.equal(result.headVerified,true);assert.equal(result.review.changeRequests.length,1);
 assert.equal(result.review.requestedReviewers[0],'someone');
 assert.equal(result.review.approvalEnforcement,'UNKNOWN');
 assert.equal(result.review.unresolvedThreads,'UNOBSERVED');
 assert.equal(result.complete,false);
});
test('a moved head fails exact-head post-collection validation',async()=>{
 let n=0;
 const pr=(head)=>({state:'open',head:{sha:head},base:{ref:'main'}});
 const {client}=mock([
  [`/repos/${REPO}/pulls/9`,()=>response(pr(++n===1?H:H2))],
  [`/repos/${REPO}/actions/runs`,response({workflow_runs:[],total_count:0})],
  [`/repos/${REPO}/pulls/9/reviews`,response([])],
  [`/repos/${REPO}/branches/main/protection`,response({},403)]
 ]);
 const result=await inspectPR(client,REPO,9,async()=>({records:[],gaps:[]}));
 assert.equal(result.headVerified,false);assert.ok(result.gaps.some(x=>x.kind==='PR_HEAD_CHANGED_DURING_AUDIT'));
});
