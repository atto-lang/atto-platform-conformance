import {createHmac, timingSafeEqual} from 'node:crypto';
const SHA=/^[0-9a-f]{40}$/;
const DELIVERY=/^[A-Za-z0-9-]{1,128}$/;

/**
 * Host-only HMAC verification and tenant-neutral routing. A trusted backend
 * resolves installation/repo to authorized tenant and atomically checks
 * persisted expected SHA/ref, state version, delivery ID and inbox capacity.
 *
 * The sole callback admitVerifiedEvent must be ONE durable transaction.
 * Never use readExpected followed by enqueue as two independent operations.
 */
export async function admitGithubPush({
  secret,headers,rawBody,admitVerifiedEvent,maxBytes=1_048_576
}) {
  if(typeof secret!=='string'||secret.length===0 ||
     typeof admitVerifiedEvent!=='function')throw new TypeError('invalid webhook configuration');
  if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>maxBytes)
    return {status:413,code:'INVALID_BODY'};
  const signature=headers?.['x-hub-signature-256'];
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))
    return {status:401,code:'BAD_SIGNATURE'};
  const digest=createHmac('sha256',secret).update(rawBody).digest();
  if(!timingSafeEqual(Buffer.from(signature.slice(7),'hex'),digest))
    return {status:401,code:'BAD_SIGNATURE'};
  if(headers['x-github-event']!=='push')return {status:202,code:'IGNORED_EVENT'};
  const deliveryId=headers['x-github-delivery'];
  if(typeof deliveryId!=='string'||!DELIVERY.test(deliveryId))
    return {status:400,code:'BAD_DELIVERY_ID'};
  let payload;
  try{payload=JSON.parse(rawBody.toString('utf8'));}catch{return {status:400,code:'BAD_JSON'};}
  if(!payload||typeof payload!=='object'||payload.deleted!==false||
     typeof payload.after!=='string'||!SHA.test(payload.after)||
     typeof payload.ref!=='string'||!payload.ref.startsWith('refs/heads/')||
     payload.ref.length<=11||payload.ref.length>255||
     !Number.isSafeInteger(payload.repository?.id)||payload.repository.id<=0||
     !Number.isSafeInteger(payload.installation?.id)||payload.installation.id<=0)
    return {status:422,code:'BAD_PUSH'};
  // No tenant/workflow/run fields here: the authenticated backend must derive
  // them from the GitHub App installation authorization and DB expectation.
  const admitted=await admitVerifiedEvent({
    installationId:payload.installation.id,
    repositoryId:payload.repository.id,sha:payload.after,ref:payload.ref,
    deliveryId,rawBody:Buffer.from(rawBody)
  });
  if(admitted==='ACCEPTED')return {status:202,code:'ACCEPTED'};
  if(admitted==='DUPLICATE')return {status:200,code:'DUPLICATE'};
  if(admitted==='STALE')return {status:202,code:'STALE_OR_UNRELATED'};
  throw new Error('invalid admission backend result');
}
export function createGithubWebhookHandler(settings) {
  return async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/webhooks/github'){
      res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"not_found"}');return;
    }
    const maxBytes=settings.maxBytes??1_048_576;
    try{
      const chunks=[];let total=0;
      for await(const chunk of req){
        total+=chunk.length;
        if(total>maxBytes){res.writeHead(413);res.end();return;}
        chunks.push(chunk);
      }
      const out=await admitGithubPush({...settings,headers:req.headers,
        rawBody:Buffer.concat(chunks),maxBytes});
      res.writeHead(out.status,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({code:out.code}));
    }catch{
      if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});
      res.end('{"code":"INGRESS_UNAVAILABLE"}');
    }
  };
}
