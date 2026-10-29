// Host-side reference only. Reproduce exact bytes in every Oreslang backend.
import { createHash } from 'node:crypto';
const magic=Buffer.from('OAID\x01');
const domain=Buffer.from('ORESLANG_ACTOR_ID_V1\x00');
export class ActorIdError extends Error { constructor(code){super(code);this.code=code;} }
const fail=code=>{throw new ActorIdError(code);};
function str(s,max){
  if(typeof s!=='string'||!s||s!==s.normalize('NFC')||/[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(s))fail('INVALID_STRING');
  const b=Buffer.from(s);if(b.length>max)fail('TOO_LONG');return b;
}
function field(b){const h=Buffer.alloc(2);h.writeUInt16BE(b.length);return Buffer.concat([h,b]);}
function i64(value,signed){
  if(typeof value!=='bigint'&&!(typeof value==='number'&&Number.isSafeInteger(value)))fail('INVALID_INTEGER');
  const n=BigInt(value),b=Buffer.alloc(8);
  if(signed){if(n<-(1n<<63n)||n>=(1n<<63n))fail('INTEGER_RANGE');b.writeBigInt64BE(n);}
  else{if(n<0n||n>=(1n<<64n))fail('INTEGER_RANGE');b.writeBigUInt64BE(n);}
  return b;
}
function key(k,nested=false){
  if(!k||typeof k!=='object')fail('INVALID_KEY');
  if(k.kind==='string')return Buffer.concat([Buffer.from([1]),field(str(k.value,256))]);
  if(k.kind==='uuid'){
    if(typeof k.value!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(k.value))fail('INVALID_UUID');
    return Buffer.concat([Buffer.from([2]),Buffer.from(k.value.replaceAll('-',''),'hex')]);
  }
  if(k.kind==='u64'||k.kind==='i64')return Buffer.concat([Buffer.from([k.kind==='u64'?3:4]),i64(k.value,k.kind==='i64')]);
  if(k.kind==='compound'){
    if(nested||!Array.isArray(k.items)||k.items.length<2||k.items.length>8)fail('INVALID_COMPOUND');
    return Buffer.concat([Buffer.from([5,k.items.length]),...k.items.map(x=>key(x,true))]);
  }
  fail('INVALID_KEY');
}
export function encode_actor_id(id){
  if(!id||typeof id!=='object')fail('INVALID_ID');
  const b=Buffer.concat([magic,field(str(id.tenant,128)),field(str(id.namespace,128)),field(str(id.actor_type,128)),key(id.key)]);
  if(b.length>1024)fail('ID_TOO_LONG');return b;
}
export const actor_id_hash=id=>createHash('sha256').update(domain).update(encode_actor_id(id)).digest('hex');
export const actor_storage_key=id=>'oa1h_'+Buffer.from(actor_id_hash(id),'hex').toString('base64url');
export const actor_ref_token=id=>'oa1_'+encode_actor_id(id).toString('base64url');
export function decode_actor_id(b){
  if(!Buffer.isBuffer(b)||b.length<5||b.length>1024||!b.subarray(0,5).equals(magic))fail('INVALID_ENCODING');
  const decoder=new TextDecoder('utf-8',{fatal:true});let p=5;
  function take(n){if(p+n>b.length)fail('TRUNCATED');const x=b.subarray(p,p+n);p+=n;return x;}
  function read_str(max){const n=take(2).readUInt16BE();let v;try{v=decoder.decode(take(n));}catch{fail('INVALID_UTF8');}str(v,max);return v;}
  function read_key(nested=false){
    const tag=take(1)[0];
    if(tag===1)return {kind:'string',value:read_str(256)};
    if(tag===2){const h=take(16).toString('hex');return {kind:'uuid',value:h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};}
    if(tag===3)return {kind:'u64',value:take(8).readBigUInt64BE()};
    if(tag===4)return {kind:'i64',value:take(8).readBigInt64BE()};
    if(tag===5){if(nested)fail('INVALID_COMPOUND');const n=take(1)[0];if(n<2||n>8)fail('INVALID_COMPOUND');return {kind:'compound',items:Array.from({length:n},()=>read_key(true))};}
    fail('INVALID_TAG');
  }
  const id={tenant:read_str(128),namespace:read_str(128),actor_type:read_str(128),key:read_key()};
  if(p!==b.length||!encode_actor_id(id).equals(b))fail('NONCANONICAL');return id;
}
export function parse_actor_ref_token(token){
  if(typeof token!=='string'||!/^oa1_[A-Za-z0-9_-]+$/.test(token))fail('INVALID_TOKEN');
  const b=Buffer.from(token.slice(4),'base64url');
  if(b.toString('base64url')!==token.slice(4))fail('NONCANONICAL');return decode_actor_id(b);
}
