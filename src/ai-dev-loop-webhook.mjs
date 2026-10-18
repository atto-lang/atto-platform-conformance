import {createHmac, timingSafeEqual} from 'node:crypto';

const SHA=/^[0-9a-f]{40}$/;
const DELIVERY=/^[A-Za-z0-9-]{1,128}$/;
const REF=/^refs\/heads\/[A-Za-z0-9_./-]{1,240}$/;
const validId=n=>Number.isSafeInteger(n)&&n>0;
const validRef=s=>typeof s==='string'&&REF.test(s)&&
  !s.split('/').some(part=>part==='.'||part==='..'||part==='');

/**
 * Authenticated HTTP boundary ONLY. It does not choose tenant, run, or actor
 * identity from the webhook payload. The injected admitVerifiedEvent callback
 * MUST resolve authorized workflow identity and check repo/ref/SHA, expected
 * actor state version, delivery replay and inbox quota in one DB transaction.
 */
export async function admitGithubPush({
  secret,headers,rawBody,admitVerifiedEvent,maxBytes=1_048_576
}) {
  if(typeof secret!=='string'||secret.length<16||
     !headers||typeof admitVerifiedEvent!=='function'||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16_777_216)
    throw new TypeError('invalid GitHub webhook admission configuration');
  if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>maxBytes)
    return {status:413,code:'INVALID_BODY'};

  // Verify the original byte stream before JSON parsing or any storage lookup.
  const signature=headers['x-hub-signature-256'];
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))
    return {status:401,code:'BAD_SIGNATURE'};
  const actual=Buffer.from(signature.slice(7),'hex');
  const expected=createHmac('sha256',secret).update(rawBody).digest();
  if(!timingSafeEqual(actual,expected))return {status:401,code:'BAD_SIGNATURE'};

  if(headers['x-github-event']!=='push')return {status:202,code:'IGNORED_EVENT'};
  const deliveryId=headers['x-github-delivery'];
  if(typeof deliveryId!=='string'||!DELIVERY.test(deliveryId))
    return {status:400,code:'BAD_DELIVERY_ID'};
  let payload;
  try { payload=JSON.parse(rawBody.toString('utf8')); }
  catch { return {status:400,code:'BAD_JSON'}; }
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     payload.deleted!==false||!SHA.test(payload.after||'')||
     !validRef(payload.ref)||
     !validId(payload.installation?.id)||!validId(payload.repository?.id))
    return {status:422,code:'BAD_PUSH'};

  // No readExpected + persistInbox split is permitted here. The database
  // callback is the single authority for expectation and deduplication.
  const result=await admitVerifiedEvent({
    installationId:payload.installation.id,repositoryId:payload.repository.id,
    ref:payload.ref,sha:payload.after,deliveryId,rawBody:Buffer.from(rawBody)
  });
  if(result==='ACCEPTED')return {status:202,code:'ACCEPTED'};
  if(result==='DUPLICATE')return {status:200,code:'DUPLICATE'};
  if(result==='STALE')return {status:202,code:'STALE_OR_UNRELATED'};
  // Reject unknown results rather than reporting false successful admission.
  throw new Error('unexpected durable admission result');
}

/** Host Node adapter: external operations are NEVER run on the request stack. */
export function createGithubWebhookHandler(settings) {
  return async (req,res)=>{
    if(req.method!=='POST'||req.url!=='/webhooks/github'){
      res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"not_found"}');return;
    }
    const maxBytes=settings.maxBytes??1_048_576;
    try {
      const chunks=[];let total=0;
      for await(const chunk of req){
        total+=chunk.length;
        if(total>maxBytes){res.writeHead(413);res.end();return;}
        chunks.push(chunk);
      }
      const result=await admitGithubPush({
        ...settings,headers:req.headers,rawBody:Buffer.concat(chunks),maxBytes
      });
      res.writeHead(result.status,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({code:result.code}));
    } catch {
      if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});
      res.end('{"code":"INGRESS_UNAVAILABLE"}');
    }
  };
}
