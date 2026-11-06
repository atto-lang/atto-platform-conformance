import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKENDS,CANDIDATES,OWNER,buildPacket,assessJob,fetchLiveSnapshot,parseUniqueJson,readSnapshot} from '../scripts/runner_admission_support_packet_20261106.mjs';

const repo=b=>OWNER+'/oreslang-source.'+b;
function fixture(){
  const branches=Object.fromEntries(BACKENDS.map(b=>[b,{name:'main',commit:{sha:'a'.repeat(40)},protected:false,protection:{required_status_checks:{enforcement_level:'off'}}}]));
  const candidates=Object.fromEntries(CANDIDATES.map(c=>[c.backend,{
    pr:{number:c.pr,url:'https://api.github.com/repos/'+repo(c.backend)+'/pulls/'+c.pr,
      state:'open',merged:false,base:{ref:'main',repo:{full_name:repo(c.backend)}},
      head:{sha:c.head,ref:c.branch,repo:{full_name:repo(c.backend)}}},
    run:{id:c.run,url:'https://api.github.com/repos/'+repo(c.backend)+'/actions/runs/'+c.run,
      head_sha:c.head,head_branch:c.branch,head_repository:{full_name:repo(c.backend)},
      event:'pull_request',path:c.workflowPath,status:'completed',
      run_attempt:c.attempt,repository:{full_name:repo(c.backend)}},
    jobs:{total_count:1,jobs:[{id:c.job,run_id:c.run,
      run_url:'https://api.github.com/repos/'+repo(c.backend)+'/actions/runs/'+c.run,
      head_branch:c.branch,run_attempt:c.attempt,head_sha:c.head,status:'completed',
      conclusion:'failure',runner_id:0,runner_name:'',steps:[]}]} }]));
  return {branches,candidates};
}
function success(c){return {id:c.job,run_id:c.run,run_attempt:c.attempt,head_sha:c.head,
  head_branch:c.branch,run_url:'https://api.github.com/repos/'+repo(c.backend)+'/actions/runs/'+c.run,
  status:'completed',conclusion:'success',runner_id:123,runner_name:'hosted',
  steps:[{name:'Set up job',status:'completed',conclusion:'success'},{name:'Run actual tests',status:'completed',conclusion:'success'}]};}
test('nine source branches and five jobs are classified without merge authority',()=>{
  const r=buildPacket(fixture());
  assert.equal(r.sourceRepositories.length,9);assert.equal(r.sampledJobs.length,5);
  assert.equal(r.counts.unprotectedMains,9);assert.equal(r.counts.runnerNotAllocated,5);
  assert.equal(r.counts.executedSuccessfulSampledJobs,0);
  assert.deepEqual([r.authorizedToMerge,r.authorizedToExportPrivateSource,r.certifiedAttoGuestExecution],[false,false,false]);
});
for(const c of CANDIDATES){
  test('reject changed original PR head '+c.backend,()=>{
    const f=fixture();f.candidates[c.backend].pr.head.sha='f'.repeat(40);
    assert.equal(buildPacket(f).sampledJobs.find(x=>x.repository===repo(c.backend)).assessment,'PR_HEAD_DRIFT_OR_UNVERIFIED');
  });
  test('reject run repository substitution '+c.backend,()=>{
    const f=fixture();f.candidates[c.backend].run.repository.full_name='other/repo';
    assert.equal(buildPacket(f).sampledJobs.find(x=>x.repository===repo(c.backend)).assessment,'RUN_IDENTITY_MISMATCH');
  });
  test('fake success with runner_id=0 still fails '+c.backend,()=>{
    const f=fixture();f.candidates[c.backend].jobs.jobs[0].conclusion='success';
    assert.equal(buildPacket(f).sampledJobs.find(x=>x.repository===repo(c.backend)).assessment,'RUNNER_NOT_ALLOCATED');
  });
}
test('missing and duplicated target job IDs fail closed',()=>{
  const f=fixture();f.candidates.java.jobs.jobs=[];assert.equal(buildPacket(f).sampledJobs[0].assessment,'JOB_LIST_INCOMPLETE_OR_UNVERIFIED');
  const g=fixture();g.candidates.java.jobs.jobs.push(g.candidates.java.jobs.jobs[0]);g.candidates.java.jobs.total_count=2;
  assert.equal(buildPacket(g).sampledJobs[0].assessment,'JOB_MISSING_OR_DUPLICATE');
});
test('unknown main protection is not a verified protected branch',()=>{
  const f=fixture();delete f.branches.forge.protected;f.branches.js.commit.sha='bad';
  assert.equal(buildPacket(f).counts.unverifiedMains,2);
});
test('housekeeping-only runner does not prove test execution',()=>{
  const c=CANDIDATES[0],j=success(c);j.steps.pop();
  assert.equal(assessJob(j,c),'NO_MEANINGFUL_TEST_STEP');
});
test('actual successful sample remains advisory only',()=>{
  const f=fixture(),c=CANDIDATES[0];f.candidates.java.jobs.jobs[0]=success(c);
  const p=buildPacket(f);assert.equal(p.counts.executedSuccessfulSampledJobs,1);assert.equal(p.authorizedToMerge,false);
});
test('merged historical PRs preserve exact-original-head runner diagnoses',()=>{
  const f=fixture();
  for(const backend of ['java','llvm','wasm','forge']){
    const p=f.candidates[backend].pr;
    p.state='closed';p.merged=true;p.merge_commit_sha='d'.repeat(40);
    p.merged_at='2026-11-06T19:01:07Z';
  }
  const packet=buildPacket(f);
  for(const backend of ['java','llvm','wasm','forge']){
    assert.equal(packet.sampledJobs.find(x=>x.repository===repo(backend)).assessment,'RUNNER_NOT_ALLOCATED');
  }
  assert.equal(packet.counts.runnerNotAllocated,5);
  assert.equal(packet.authorizedToMerge,false);
});
test('closed-unmerged historical PR cannot impersonate valid runner evidence',()=>{
  const f=fixture(),p=f.candidates.java.pr;
  p.state='closed';p.merged=false;p.merge_commit_sha='d'.repeat(40);p.merged_at=null;
  assert.equal(buildPacket(f).sampledJobs[0].assessment,'PR_HEAD_DRIFT_OR_UNVERIFIED');
});
test('merged historical PR needs real merge SHA and timestamp evidence',()=>{
  for(const mutation of [
    p=>{p.merge_commit_sha=null;},
    p=>{p.merge_commit_sha='not-a-sha';},
    p=>{p.merged_at=null;},
    p=>{p.merged_at='not-a-date';}
  ]){
    const f=fixture(),p=f.candidates.java.pr;
    p.state='closed';p.merged=true;p.merge_commit_sha='d'.repeat(40);
    p.merged_at='2026-11-06T19:01:07Z';
    mutation(p);
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'PR_HEAD_DRIFT_OR_UNVERIFIED');
  }
});
test('checkout/setup-only Actions cannot masquerade as executed tests',()=>{
  const c=CANDIDATES[0],j=success(c);
  j.steps=[
    {name:'Set up job',status:'completed',conclusion:'success'},
    {name:'Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',status:'completed',conclusion:'success'},
    {name:'Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',status:'completed',conclusion:'success'},
    {name:'Run dtolnay/rust-toolchain@686976e191b89faba57d3206551f0f330d8cb249',status:'completed',conclusion:'success'},
    {name:'Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',status:'completed',conclusion:'success'}
  ];
  assert.equal(assessJob(j,c),'NO_MEANINGFUL_TEST_STEP');
  j.steps.push({name:'Execute source-owned negative regression tests',status:'completed',conclusion:'success'});
  assert.equal(assessJob(j,c),'EXECUTED_JOB_SUCCESS');
});

test('historical job remains classified after newer workflow retry',()=>{
  const f=fixture(),c=CANDIDATES.find(c=>c.backend==='llvm');
  f.candidates.llvm.run.run_attempt=c.attempt+1;
  const item=buildPacket(f).sampledJobs.find(x=>x.repository===repo('llvm'));
  assert.equal(item.assessment,'RUNNER_NOT_ALLOCATED');
  assert.equal(item.sampledHistoricalAttempt,true);
  assert.equal(item.latestRunAttempt,c.attempt+1);
  assert.equal(item.attempt,c.attempt);
});
test('future or impossible run attempt is rejected',()=>{
  const c=CANDIDATES[0];
  for(const attempt of [0,-1,NaN,c.attempt-1]){
    const f=fixture();f.candidates.java.run.run_attempt=attempt;
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'RUN_IDENTITY_MISMATCH');
  }
});
test('job attempt identity cannot be promoted by a newer run',()=>{
  const f=fixture(),c=CANDIDATES[0];
  f.candidates.java.run.run_attempt=c.attempt+2;
  f.candidates.java.jobs.jobs[0].run_attempt=c.attempt+2;
  assert.equal(buildPacket(f).sampledJobs[0].assessment,'IDENTITY_MISMATCH');
});
test('even a historical executed success never grants merge or private-source export',()=>{
  const f=fixture(),c=CANDIDATES[0];
  f.candidates.java.run.run_attempt=c.attempt+2;
  f.candidates.java.jobs.jobs[0]=success(c);
  const p=buildPacket(f),v=p.sampledJobs[0];
  assert.equal(v.assessment,'EXECUTED_JOB_SUCCESS');
  assert.equal(v.sampledHistoricalAttempt,true);
  assert.equal(p.authorizedToMerge,false);
  assert.equal(p.authorizedToExportPrivateSource,false);
});

test('Forge historical sample matches the real attempt-2 job identity',()=>{
  const c=CANDIDATES.find(c=>c.backend==='forge');
  assert.equal(c.run,42075608060);
  assert.equal(c.attempt,2);
  assert.equal(c.job,127717546451);
  const f=fixture(),p=buildPacket(f);
  assert.equal(p.sampledJobs.find(x=>x.repository===repo('forge')).assessment,'RUNNER_NOT_ALLOCATED');
  f.candidates.forge.jobs.jobs[0].run_attempt=1;
  assert.equal(buildPacket(f).sampledJobs.find(x=>x.repository===repo('forge')).assessment,'IDENTITY_MISMATCH');
});

test('duplicate decoded JSON authority keys are rejected',()=>{
  for(const raw of ['{"id":1,"id":2}','{"id":1,"\u0069d":2}',
    '{"nested":{"run_attempt":1,"run_attempt":2}}',
    '{"jobs":[{"head_sha":"a","head_sha":"b"}]}']){
    assert.throws(()=>parseUniqueJson(raw),/duplicate JSON object key/);
  }
});
test('normal repeated keys in separate nested objects are accepted',()=>{
  assert.deepEqual(parseUniqueJson('{"a":{"id":1},"b":{"id":2},"steps":[]}'),
    {a:{id:1},b:{id:2},steps:[]});
});
test('JSON scanner handles quoted delimiters and escaped quotes',()=>{
  const value={message:'a,b}c: "hello"',nested:{ok:true}};
  assert.deepEqual(parseUniqueJson(JSON.stringify(value)),value);
});
test('reject nonfinite, unsafe integer, BOM and unpaired Unicode authority',()=>{
  for(const raw of ['{"id":1e999}','{"id":9007199254740993}',
    '\uFEFF{"id":1}','{"id":"\uD800"}']){
    assert.throws(()=>parseUniqueJson(raw));
  }
});
test('reject oversized, malformed and overly nested JSON without accepting authority',()=>{
  assert.throws(()=>parseUniqueJson(' '.repeat(2000001)),/oversized/);
  assert.throws(()=>parseUniqueJson('{"a":1,}'));
  const deep='['.repeat(65)+'1'+']'.repeat(65);
  assert.throws(()=>parseUniqueJson(deep));
});
test('reject duplicate keys through all API response paths',async()=>{
  let calls=0;
  const duplicate=async()=>{
    calls++;
    const bytes=new TextEncoder().encode('{"name":"main","name":"evil"}');
    return {ok:true,headers:{get:()=>null},arrayBuffer:async()=>bytes.buffer};
  };
  await assert.rejects(fetchLiveSnapshot('placeholder',duplicate),/duplicate JSON object key/);
  assert.equal(calls,1);
});


test('PR metadata is bound to the pinned original source branch and repository',()=>{
  const variants=[
    p=>{p.url='https://api.github.com/repos/other/repo/pulls/2552';},
    p=>{p.head.ref='forged-branch';},
    p=>{p.base.repo.full_name='other/repo';},
    p=>{p.head.sha='f'.repeat(40);}
  ];
  for(const change of variants){const f=fixture();change(f.candidates.java.pr);
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'PR_HEAD_DRIFT_OR_UNVERIFIED');}
});
test('run metadata is bound to original GitHub PR event and source workflow',()=>{
  const variants=[
    r=>{r.event='workflow_dispatch';},
    r=>{r.head_branch='forged-branch';},
    r=>{r.head_repository.full_name='untrusted/fork';},
    r=>{r.path='.github/workflows/other.yml';},
    r=>{r.url='https://api.github.com/repos/other/repo/actions/runs/41958899763';},
    r=>{r.status='in_progress';}
  ];
  for(const change of variants){const f=fixture();change(f.candidates.java.run);
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'RUN_IDENTITY_MISMATCH');}
});
test('historical GitHub runs with empty PR array remain valid',()=>{
  const f=fixture();f.candidates.java.run.pull_requests=[];
  assert.equal(buildPacket(f).sampledJobs[0].assessment,'RUNNER_NOT_ALLOCATED');
});
test('job metadata is bound to original run URL and branch',()=>{
  for(const mutate of [
    j=>{j.head_branch='forged-branch';},
    j=>{j.run_url='https://api.github.com/repos/other/repo/actions/runs/41958899763';}
  ]){const f=fixture();mutate(f.candidates.java.jobs.jobs[0]);
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'IDENTITY_MISMATCH');}
});
test('incomplete, malformed, or paginated job inventories are not accepted',()=>{
  const variants=[
    j=>{j.total_count=2;},
    j=>{j.total_count=0;},
    j=>{j.total_count=null;},
    j=>{j.total_count=100;},
    j=>{j.jobs=[];}
  ];
  for(const change of variants){const f=fixture();change(f.candidates.java.jobs);
    assert.equal(buildPacket(f).sampledJobs[0].assessment,'JOB_LIST_INCOMPLETE_OR_UNVERIFIED');}
});
test('duplicate pinned job identities are denied even if listed count matches',()=>{
  const f=fixture(),jobs=f.candidates.java.jobs;
  jobs.jobs.push({...jobs.jobs[0]});jobs.total_count=2;
  assert.equal(buildPacket(f).sampledJobs[0].assessment,'JOB_MISSING_OR_DUPLICATE');
});
test('a complete multi-job inventory still admits only the pinned job',()=>{
  const f=fixture(),jobs=f.candidates.java.jobs;
  jobs.jobs.push({...jobs.jobs[0],id:127020277347});jobs.total_count=2;
  assert.equal(buildPacket(f).sampledJobs[0].assessment,'RUNNER_NOT_ALLOCATED');
});


function fakeSnapshotFile(json,{links=1n,regular=true,changed=false,partial=false,size=null}={}){
  const bytes=new TextEncoder().encode(json);
  const stat={isFile:()=>regular,nlink:links,size:size===null?BigInt(bytes.length):size,
    dev:1n,ino:2n,mode:33188n,mtimeNs:3n,ctimeNs:4n};
  let statCalls=0,closed=0,opened=0;
  return {
    async opener(){
      opened++;
      return {
        async stat(){statCalls++;return changed&&statCalls>1?{...stat,mtimeNs:4n}:stat;},
        async read(buf,offset,length,pos){
          const count=Math.max(0,Math.min(length,bytes.length-pos,partial?3:length));
          buf.set(bytes.subarray(pos,pos+count),offset);
          return {bytesRead:count};
        },
        async close(){closed++;}
      };
    },
    get closed(){return closed;},
    get opened(){return opened;}
  };
}
test('offline snapshot reads only stable, bounded regular descriptor bytes',async()=>{
  const obj={branches:{java:{name:'main'}},candidates:{},message:'valid'};
  const src=fakeSnapshotFile(JSON.stringify(obj),{partial:true});
  assert.deepEqual(await readSnapshot('synthetic.json',src.opener),obj);
  assert.equal(src.closed,1);
  assert.equal(src.opened,1);
});
test('offline snapshot rejects hardlinks, nonregular files, size and mutation',async()=>{
  const input='{"repo":"source-only"}';
  for(const opts of [
    {links:2n},{regular:false},{size:2000001n},{size:0n},
    {size:1n},{changed:true}
  ]){
    const src=fakeSnapshotFile(input,opts);
    await assert.rejects(readSnapshot('synthetic.json',src.opener));
    assert.equal(src.closed,1);
  }
});
test('offline snapshot rejects duplicate authority keys and closes descriptor',async()=>{
  const src=fakeSnapshotFile('{"id":1,"\\u0069d":2}');
  await assert.rejects(readSnapshot('synthetic.json',src.opener),/duplicate JSON object key/);
  assert.equal(src.closed,1);
});
test('offline snapshot does not accept missing or substituted read data',async()=>{
  const src=fakeSnapshotFile('{"a":1}',{size:2n});
  await assert.rejects(readSnapshot('synthetic.json',src.opener),/changed during read/);
  assert.equal(src.closed,1);
});

test('missing snapshot is never green',()=>{
  const p=buildPacket({});assert.equal(p.counts.unverifiedMains,9);assert.equal(p.sampledJobs.every(x=>x.assessment==='PR_HEAD_DRIFT_OR_UNVERIFIED'),true);
});
test('live endpoint calls only private-source GETs, refuses missing token',async()=>{
  await assert.rejects(fetchLiveSnapshot(''),/GITHUB_TOKEN/);
  const f=fixture(),methods=[],urls=[];
  const fake=async(url,options)=>{
    methods.push(options.method);urls.push(url);
    const b=/oreslang-source\.([^/]+)/.exec(url)?.[1];
    let obj=url.endsWith('/branches/main')?f.branches[b]:url.includes('/pulls/')?f.candidates[b].pr:url.includes('/attempts/')?f.candidates[b].jobs:f.candidates[b].run;
    const bytes=new TextEncoder().encode(JSON.stringify(obj));
    return {ok:true,arrayBuffer:async()=>bytes.buffer};
  };
  const p=buildPacket(await fetchLiveSnapshot('placeholder',fake));
  assert.equal(p.counts.runnerNotAllocated,5);
  assert.equal(methods.length,24);
  assert.ok(methods.every(m=>m==='GET'));
  assert.ok(urls.every(u=>u.startsWith('https://api.github.com/repos/'+OWNER+'/oreslang-source.')));
});
test('live GitHub request refuses redirects, cookies and cache reuse',async()=>{
  let options;
  await assert.rejects(fetchLiveSnapshot('placeholder',async(url,opts)=>{
    options=opts;return {ok:false,status:403};
  }),/HTTP 403/);
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.credentials,'omit');
  assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer placeholder');
});
test('redirected or substituted GitHub REST responses fail before parsing',async()=>{
  await assert.rejects(fetchLiveSnapshot('token',async()=>({ok:true,redirected:true})),/redirected or substituted/);
  await assert.rejects(fetchLiveSnapshot('token',async()=>({ok:true,url:'https://example.com/other'})),/redirected or substituted/);
});
test('oversized streamed response cancels reader before rejection',async()=>{
  let canceled=0,released=0;
  const fake=async()=>({ok:true,headers:{get:()=>null},
    body:{getReader:()=>({
      read:async()=>({done:false,value:new Uint8Array(2000001)}),
      cancel:async()=>{canceled++;},
      releaseLock:()=>{released++;}
    })}});
  await assert.rejects(fetchLiveSnapshot('token',fake),/2 MB/);
  assert.equal(canceled,1);
  assert.equal(released,1);
});

test('HTTP errors and oversized streams are refused',async()=>{
  await assert.rejects(fetchLiveSnapshot('token',async()=>({ok:false,status:403})),/HTTP 403/);
  await assert.rejects(fetchLiveSnapshot('token',async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(2000001)}),releaseLock:()=>{}})}})),/2 MB/);
});
test('snapshot must have object type',()=>assert.throws(()=>buildPacket(null),/snapshot/));
