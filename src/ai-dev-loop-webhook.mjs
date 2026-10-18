import {createHmac, timingSafeEqual} from 'node:crypto';

const HEX=/^[0-9a-f]{40}$/;
const DELIVERY=/^[A-Za-z0-9-]{1,128}$/;
const nonempty=s=>typeof s==='string' && s.length>0;

/**
 * A host-side webhook admission boundary; does not execute AI tasks.
 * Callbacks MUST be backed by durable, tenant-authorized storage. In-memory
 * deduplication does not satisfy the contract across a process restart.
 */
export async function admitGithubPush({secret,headers,rawBody,readExpected,persistInbox,maxBytes=1_048_576}) {
  if(!nonempty(secret) || typeof readExpected!=='function' ||
      typeof persistInbox!=='function')throw TypeError('admission configuration required');
  if(!Buffer.isBuffer(rawBody) || rawBody.length===0 || rawBody.length>maxBytes)
    return {status:413,code:'INVALID_BODY'};
  // Raw-body signature is validated BEFORE JSON parsing and any state lookup.
  const signature=headers['x-hub-signature-256'];
  if(typeof signature!=='string' || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return {status:401,code:'BAD_SIGNATURE'};
  const expectedSig=Buffer.from(createHmac('sha256',secret).update(rawBody).digest('hex'),'hex');
  const got=Buffer.from(signature.slice(7),'hex');
  if(!timingSafeEqual(got,expectedSig))return {status:401,code:'BAD_SIGNATURE'};
  if(headers['x-github-event']!=='push')return {status:202,code:'IGNORED_EVENT'};
  const delivery=headers['x-github-delivery'];
  if(typeof delivery!=='string' || !DELIVERY.test(delivery))
    return {status:400,code:'BAD_DELIVERY_ID'};
  let payload;
  try {payload=JSON.parse(rawBody.toString('utf8'));}catch{return {status:400,code:'BAD_JSON'};}
  if(!payload || typeof payload!=='object' || payload.deleted!==false ||
      !HEX.test(payload.after||'') || !nonempty(payload.ref) ||
      !Number.isSafeInteger(payload.installation?.id) ||
      !Number.isSafeInteger(payload.repository?.id))
    return {status:422,code:'BAD_PUSH'};
  const expected=await readExpected({installationId:payload.installation.id,repositoryId:payload.repository.id});
  // The expected SHA/ref/run/iteration must come from authoritative backend
  // state, NEVER from untrusted JSON fields supplied by the webhook.
  if(!expected || expected.stage!=='waiting_webhook' ||
      expected.installationId!==payload.installation.id ||
      expected.repositoryId!==payload.repository.id ||
      expected.expectedSha!==payload.after ||
      expected.expectedRef!==payload.ref ||
      !nonempty(expected.tenantId) || !nonempty(expected.workflowId) ||
      !nonempty(expected.runId) || !nonempty(expected.nodeId) ||
      !Number.isSafeInteger(expected.iteration) || expected.iteration<1 ||
      !Number.isSafeInteger(expected.stateVersion) || expected.stateVersion<0) return {status:202,code:'STALE_OR_UNRELATED'};
  // persistInbox MUST atomically deduplicate this delivery and verify
  // run/iteration/expected SHA under a storage transaction.
  const inserted=await persistInbox({
    tenantId:expected.tenantId,workflowId:expected.workflowId,runId:expected.runId,
    nodeId:expected.nodeId,iteration:expected.iteration,
    event:'github_push',deliveryId:delivery,sha:payload.after,ref:payload.ref,
    expectedStateVersion:expected.stateVersion
  });
  return inserted ? {status:202,code:'ACCEPTED'} : {status:200,code:'DUPLICATE'};
}

/** Minimal native Node HTTP adapter. Route/authentication still belongs to the server. */
export function createGithubWebhookHandler(settings) {
  return async (req,res)=>{
    if(req.method!=='POST' || req.url!=='/webhooks/github'){
      res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"not_found"}');return;
    }
    const maxBytes=settings.maxBytes??1_048_576;
    try {
      const parts=[];let total=0;
      for await(const chunk of req){
        total+=chunk.length;
        if(total>maxBytes){res.writeHead(413);res.end();return;}
        parts.push(chunk);
      }
      const answer=await admitGithubPush({
        ...settings,headers:req.headers,rawBody:Buffer.concat(parts),maxBytes
      });
      res.writeHead(answer.status,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({code:answer.code}));
    }catch{
      // No request payload or credentials in error responses.
      if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});
      res.end('{"code":"INGRESS_UNAVAILABLE"}');
    }
  };
}
