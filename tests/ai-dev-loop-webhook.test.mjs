import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {admitGithubPush,createGithubWebhookHandler} from '../src/ai-dev-loop-webhook.mjs';

const secret='ci-fixture-secret';
const sha='a'.repeat(40);
const payload={deleted:false,after:sha,ref:'refs/heads/feature',
  installation:{id:71},repository:{id:52}};
const signed=(data=payload,event='push',deliveryId='delivery-1')=>{
  const rawBody=Buffer.from(JSON.stringify(data));
  return {rawBody,headers:{
    'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex'),
    'x-github-event':event,'x-github-delivery':deliveryId
  }};
};
const harness=(event=signed(),override={})=>{
  const calls=[];const used=new Set();
  const admitVerifiedEvent=async e=>{
    calls.push(e);
    if(e.sha!==sha||e.ref!=='refs/heads/feature'||e.repositoryId!==52||
       e.installationId!==71)return 'STALE';
    if(used.has(e.deliveryId))return 'DUPLICATE';
    used.add(e.deliveryId);return 'ACCEPTED';
  };
  return {calls,options:{secret,...event,admitVerifiedEvent,...override}};
};
test('valid GitHub push invokes ONE verified atomic-admission callback',async()=>{
  const a=harness();
  assert.deepEqual(await admitGithubPush(a.options),{status:202,code:'ACCEPTED'});
  assert.equal(a.calls.length,1);
  assert.deepEqual({...a.calls[0],rawBody:undefined},{
    installationId:71,repositoryId:52,sha,ref:'refs/heads/feature',
    deliveryId:'delivery-1',rawBody:undefined
  });
  assert.deepEqual(a.calls[0].rawBody,a.options.rawBody);
  assert.equal('runId' in a.calls[0],false);
  assert.equal('tenantId' in a.calls[0],false);
});
test('tampered HMAC never invokes storage',async()=>{
  const event=signed();event.rawBody=Buffer.from(JSON.stringify({...payload,after:'b'.repeat(40)}));
  const a=harness(event);
  assert.equal((await admitGithubPush(a.options)).status,401);
  assert.equal(a.calls.length,0);
});
test('unknown signature and non-push events do not enqueue',async()=>{
  const bad=signed();delete bad.headers['x-hub-signature-256'];
  const a=harness(bad);
  assert.equal((await admitGithubPush(a.options)).code,'BAD_SIGNATURE');
  const b=harness(signed(payload,'ping'));
  assert.equal((await admitGithubPush(b.options)).code,'IGNORED_EVENT');
  assert.equal(a.calls.length+b.calls.length,0);
});
test('oversized, malformed and empty bodies rejected',async()=>{
  const a=harness(signed());
  assert.equal((await admitGithubPush({...a.options,maxBytes:10})).status,413);
  assert.equal((await admitGithubPush({...a.options,rawBody:Buffer.alloc(0)})).status,413);
  const malformed=signed();malformed.rawBody=Buffer.from('{oops');
  assert.equal((await admitGithubPush(harness(malformed).options)).status,401);
});
test('SHA/ref/repository/installation are backend-bound',async()=>{
  for(const event of [
    {...payload,after:'b'.repeat(40)},
    {...payload,ref:'refs/heads/other'},
    {...payload,repository:{id:123}},
    {...payload,installation:{id:456}}
  ]){
    const a=harness(signed(event));
    assert.equal((await admitGithubPush(a.options)).code,'STALE_OR_UNRELATED');
  }
});
test('signed attacker-supplied workflow coordinates are discarded',async()=>{
  const a=harness(signed({...payload,tenantId:'attacker',runId:'attacker',
    iteration:90,expectedStateVersion:42}));
  assert.equal((await admitGithubPush(a.options)).code,'ACCEPTED');
  assert.equal('tenantId' in a.calls[0],false);
  assert.equal('expectedStateVersion' in a.calls[0],false);
});
test('same signed delivery is idempotent at backend boundary',async()=>{
  const a=harness();
  assert.equal((await admitGithubPush(a.options)).code,'ACCEPTED');
  assert.equal((await admitGithubPush(a.options)).code,'DUPLICATE');
  assert.equal(a.calls.length,2);
});
test('deleted branch and malformed identifiers fail closed',async()=>{
  for(const event of [
    {...payload,deleted:true}, {...payload,after:'INVALID'},
    {...payload,ref:'refs/tags/tag'}, {...payload,repository:{id:0}},
    {...payload,installation:{id:0}}
  ]){
    const a=harness(signed(event));
    assert.equal((await admitGithubPush(a.options)).status,422);
    assert.equal(a.calls.length,0);
  }
});
test('backend error fails closed instead of claiming accepted',async()=>{
  const a=harness(signed(),{admitVerifiedEvent:async()=>undefined});
  await assert.rejects(admitGithubPush(a.options),/backend result/);
});
test('HTTP end-to-end routes signed event to one backend admission',async()=>{
  const a=harness();
  const server=createServer(createGithubWebhookHandler({
    secret,admitVerifiedEvent:a.options.admitVerifiedEvent
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(root+'/wrong')).status,404);
    const request=signed();
    const res=await fetch(root+'/webhooks/github',{method:'POST',
      headers:request.headers,body:request.rawBody});
    assert.equal(res.status,202);assert.deepEqual(await res.json(),{code:'ACCEPTED'});
    assert.equal(a.calls.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
