import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {admitGithubPush,createGithubWebhookHandler} from '../src/ai-dev-loop-webhook.mjs';

const secret='test-only-shared-secret-long';
const sha='a'.repeat(40);
const payload={deleted:false,after:sha,ref:'refs/heads/feature',
  installation:{id:71},repository:{id:52}};
const expected={tenantId:'tenant',workflowId:'workflow',runId:'run',nodeId:'hook',
  iteration:2,stage:'waiting_webhook',installationId:71,repositoryId:52,
  expectedSha:sha,expectedRef:'refs/heads/feature',stateVersion:4};
const signed=(data=payload,event='push',delivery='1a')=>{
  const rawBody=Buffer.from(JSON.stringify(data));
  return {headers:{
    'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),
    'x-github-event':event,'x-github-delivery':delivery
  },rawBody};
};
const harness=(input=signed(), override={})=>{
  const recorded=[];
  const seen=new Set();
  const opts={secret,...input,readExpected:async()=>expected,persistInbox:async m=>{
    recorded.push(m);if(seen.has(m.deliveryId))return false;seen.add(m.deliveryId);return true;
  },...override};
  return {opts,recorded};
};

test('valid push publishes exact persisted workflow identity and pins iteration and SHA',async()=>{
  const {opts,recorded}=harness();
  assert.deepEqual(await admitGithubPush(opts),{status:202,code:'ACCEPTED'});
  assert.deepEqual(recorded[0],{tenantId:'tenant',workflowId:'workflow',runId:'run',
    nodeId:'hook',iteration:2,event:'github_push',deliveryId:'1a',
    sha,ref:'refs/heads/feature',expectedStateVersion:4});
});

test('bad raw signature is rejected before any storage lookup',async()=>{
  let lookups=0;
  const input=signed();input.rawBody=Buffer.from(input.rawBody.toString().replace(sha,'b'.repeat(40)));
  const {opts}=harness(input,{readExpected:async()=>{lookups++;return expected;}});
  assert.equal((await admitGithubPush(opts)).status,401);
  assert.equal(lookups,0);
});

test('missing signature and non-push GitHub events do not mutate inbox',async()=>{
  const input=signed();delete input.headers['x-hub-signature-256'];
  const a=harness(input);assert.equal((await admitGithubPush(a.opts)).status,401);
  const b=harness(signed(payload,'ping'));
  assert.equal((await admitGithubPush(b.opts)).code,'IGNORED_EVENT');
  assert.equal(b.recorded.length,0);
});

test('reject oversized payload before parsing',async()=>{
  const {opts}=harness(signed());
  assert.equal((await admitGithubPush({...opts,maxBytes:5})).status,413);
});

test('wrong SHA, ref or installation are stale, not accepted',async()=>{
  for(const wrong of [
    {...payload,after:'b'.repeat(40)},
    {...payload,ref:'refs/heads/main'},
    {...payload,installation:{id:72}},
    {...payload,repository:{id:53}}
  ]){
    const a=harness(signed(wrong));
    assert.equal((await admitGithubPush(a.opts)).code,'STALE_OR_UNRELATED');
    assert.equal(a.recorded.length,0);
  }
});

test('reject arbitrary run ID or expected SHA supplied by signed event',async()=>{
  const evil={...payload,expectedSha:'b'.repeat(40),runId:'attacker-run',iteration:900};
  const a=harness(signed(evil));
  assert.equal((await admitGithubPush(a.opts)).code,'ACCEPTED');
  assert.equal(a.recorded[0].runId,'run');
  assert.equal(a.recorded[0].iteration,2);
});

test('duplicate delivery returns 200 but does not queue twice',async()=>{
  const a=harness();assert.equal((await admitGithubPush(a.opts)).code,'ACCEPTED');
  assert.equal((await admitGithubPush(a.opts)).code,'DUPLICATE');
  assert.equal(a.recorded.length,2); // storage must enforce duplicate key atomically
});

test('deleted branch and malformed push fail closed',async()=>{
  for(const bad of [{...payload,deleted:true},{...payload,after:'notsha'},
    {...payload,repository:{}},{...payload,installation:{}}]){
    const a=harness(signed(bad));
    assert.equal((await admitGithubPush(a.opts)).status,422);
    assert.equal(a.recorded.length,0);
  }
});

test('HTTP adapter enforces POST endpoint and emits accepted JSON',async()=>{
  const h=harness();
  const server=createServer(createGithubWebhookHandler({
    secret,readExpected:h.opts.readExpected,persistInbox:h.opts.persistInbox
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try {
    const miss=await fetch(url+'/webhooks/github');assert.equal(miss.status,404);
    const request=signed();
    const response=await fetch(url+'/webhooks/github',{
      method:'POST',headers:request.headers,body:request.rawBody
    });
    assert.equal(response.status,202);
    assert.deepEqual(await response.json(),{code:'ACCEPTED'});
  }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});


test('unversioned expected actor state cannot bypass transactional correlation',async()=>{
  const a=harness(signed(),{readExpected:async()=>({...expected,stateVersion:undefined})});
  assert.equal((await admitGithubPush(a.opts)).code,'STALE_OR_UNRELATED');
  assert.equal(a.recorded.length,0);
});
