import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {admitGithubPush,createGithubWebhookHandler} from '../src/ai-dev-loop-webhook.mjs';

const secret='test-webhook-secret-long-enough';
const sha='a'.repeat(40);
const payload={deleted:false,after:sha,ref:'refs/heads/dev',
  installation:{id:71},repository:{id:52}};
function signed(data=payload,event='push',delivery='delivery-1'){
  const rawBody=Buffer.from(JSON.stringify(data));
  return {rawBody,headers:{
    'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),
    'x-github-event':event,'x-github-delivery':delivery}};
}
function fixture(input=signed(),response='ACCEPTED'){
  const calls=[];
  const config={secret,...input,admitVerifiedEvent:async value=>{calls.push(value);return response;}};
  return {config,calls};
}

test('verified push calls only the atomic durable admission boundary',async()=>{
  const f=fixture();
  assert.deepEqual(await admitGithubPush(f.config),{status:202,code:'ACCEPTED'});
  assert.equal(f.calls.length,1);
  assert.deepEqual({...f.calls[0],rawBody:undefined},{
    installationId:71,repositoryId:52,ref:'refs/heads/dev',sha,deliveryId:'delivery-1',
    rawBody:undefined});
  assert.deepEqual(f.calls[0].rawBody,signed().rawBody);
  assert.equal('tenantId' in f.calls[0],false);
  assert.equal('expectedStateVersion' in f.calls[0],false);
});

test('reject tampered raw bytes before any DB admission',async()=>{
  const s=signed();s.rawBody=Buffer.from(s.rawBody.toString().replace(sha,'b'.repeat(40)));
  const f=fixture(s);
  assert.equal((await admitGithubPush(f.config)).status,401);
  assert.equal(f.calls.length,0);
});
test('missing signature or malformed signature is rejected',async()=>{
  for(const bad of [undefined,'sha256=z','sha256='+'0'.repeat(64)]){
    const s=signed();
    if(bad===undefined)delete s.headers['x-hub-signature-256'];
    else s.headers['x-hub-signature-256']=bad;
    const f=fixture(s);
    assert.equal((await admitGithubPush(f.config)).status,401);
    assert.equal(f.calls.length,0);
  }
});
test('non-push event never calls database',async()=>{
  const f=fixture(signed(payload,'ping'));
  assert.equal((await admitGithubPush(f.config)).code,'IGNORED_EVENT');
  assert.equal(f.calls.length,0);
});
test('invalid delivery ID rejected after authenticated event',async()=>{
  for(const id of ['','../x','x'.repeat(129)]){
    const f=fixture(signed(payload,'push',id));
    assert.equal((await admitGithubPush(f.config)).code,'BAD_DELIVERY_ID');
    assert.equal(f.calls.length,0);
  }
});
test('invalid or oversized request rejected before storage',async()=>{
  const f=fixture();
  assert.equal((await admitGithubPush({...f.config,maxBytes:5})).status,413);
  assert.equal((await admitGithubPush({...f.config,rawBody:Buffer.alloc(0)})).status,413);
  assert.equal(f.calls.length,0);
});
test('ill-formed but authenticated push rejected',async()=>{
  const cases=[
    {...payload,deleted:true},{...payload,after:'bad'},{...payload,ref:'refs/tags/v1'},
    {...payload,repository:{id:0}},{...payload,installation:{id:Number.MAX_SAFE_INTEGER+1}},
    {...payload,after:'b'.repeat(39)}, {...payload,ref:'refs/heads/../../other'}];
  for(const invalid of cases){
    const f=fixture(signed(invalid));
    assert.equal((await admitGithubPush(f.config)).code,'BAD_PUSH');
    assert.equal(f.calls.length,0);
  }
});
test('signed payload cannot set tenant/run/expected state version',async()=>{
  const f=fixture(signed({...payload,tenantId:'attacker',runId:'attacker',
    expectedStateVersion:900,workflowId:'root'}));
  assert.equal((await admitGithubPush(f.config)).code,'ACCEPTED');
  assert.equal(f.calls.length,1);
  assert.equal('tenantId' in f.calls[0],false);
  assert.equal('runId' in f.calls[0],false);
  assert.equal('expectedStateVersion' in f.calls[0],false);
});
test('durable duplicate and stale outcomes are returned unchanged',async()=>{
  for(const [r,code,status] of [['DUPLICATE','DUPLICATE',200],
    ['STALE','STALE_OR_UNRELATED',202]]){
    const f=fixture(signed(),r);
    assert.deepEqual(await admitGithubPush(f.config),{status,code});
  }
});
test('invalid DB callback result fails closed',async()=>{
  const f=fixture(signed(),null);
  await assert.rejects(()=>admitGithubPush(f.config),/unexpected durable admission/);
});
test('requires an atomic callback; legacy split callbacks are not accepted',async()=>{
  const f=fixture();
  delete f.config.admitVerifiedEvent;
  f.config.readExpected=async()=>({});
  f.config.persistInbox=async()=>true;
  await assert.rejects(()=>admitGithubPush(f.config),TypeError);
});
test('HTTP adapter ingests signed push and routes to one callback',async()=>{
  const f=fixture();
  const server=createServer(createGithubWebhookHandler({
    secret,admitVerifiedEvent:f.config.admitVerifiedEvent
  }));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/webhooks/github';
    const notFound=await fetch(url);assert.equal(notFound.status,404);
    const s=signed();
    const r=await fetch(url,{method:'POST',headers:s.headers,body:s.rawBody});
    assert.equal(r.status,202);assert.deepEqual(await r.json(),{code:'ACCEPTED'});
    assert.equal(f.calls.length,1);
  }finally{await new Promise((done,fail)=>server.close(e=>e?fail(e):done()));}
});
test('HTTP adapter returns 503 without leaking raw webhook or database errors',async()=>{
  const server=createServer(createGithubWebhookHandler({
    secret,admitVerifiedEvent:async()=>{throw Error('database-private-stack');}
  }));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  try{
    const s=signed();
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/webhooks/github',{
      method:'POST',headers:s.headers,body:s.rawBody});
    assert.equal(r.status,503);
    const body=await r.text();
    assert.doesNotMatch(body,/database-private-stack/);
    assert.deepEqual(JSON.parse(body),{code:'INGRESS_UNAVAILABLE'});
  }finally{await new Promise((done,fail)=>server.close(e=>e?fail(e):done()));}
});
