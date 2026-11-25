// Source-only canonical LiveView command replay gate. Structural checks never
// authenticate runner logs, compiled Oreslang guest or backend parity.
import {createHash} from 'node:crypto';
export const EVENT_BLOB='e9fc97d87dee2670c56ff3abf9e86befbc0f2ff8';
export const EVENT_BACKENDS=Object.freeze(['java','llvm','wasm','forge','net']);
const HASH40=/^[0-9a-f]{40}$/;const HASH64=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY=/^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
const fail=msg=>{throw Error('LIVEVIEW_EVENT_GATE: '+msg)};
const ensure=(ok,msg)=>{if(!ok)fail(msg)};
const fields=(obj,keys)=>ensure(obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k)),
  'unexpected object fields: '+keys.join(','));
const blob=content=>{const b=Buffer.from(content,'utf8');return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');};
const sha256=content=>createHash('sha256').update(content,'utf8').digest('hex');
function canonical(v,depth=0){
  ensure(depth<=8,'payload depth');
  if(v===null||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='number'){
    ensure(Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v)),'unsafe scalar');
    return JSON.stringify(v);
  }
  if(typeof v==='string'){
    for(let i=0;i<v.length;i++){
      const c=v.charCodeAt(i);
      if(c>=0xD800&&c<=0xDBFF){ensure(i+1<v.length&&v.charCodeAt(i+1)>=0xDC00&&v.charCodeAt(i+1)<=0xDFFF,'lone surrogate');i++;}
      else ensure(c<0xDC00||c>0xDFFF,'lone surrogate');
    }
    ensure(v.length<=8192,'string budget');return JSON.stringify(v);
  }
  if(Array.isArray(v)){
    ensure(v.length<=64&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean),'invalid array');
    return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
  }
  ensure(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null),'non-JSON object');
  const keys=Object.keys(v).sort();ensure(keys.length<=64&&keys.every(k=>KEY.test(k)),'invalid object keys');
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
export function validateEventVectors(fixture,raw){
  fields(fixture,['schema','purpose','encoding','cases']);
  ensure(fixture.schema==='ores-liveview-event-fingerprint-v1','schema drift');
  ensure(typeof fixture.purpose==='string'&&typeof fixture.encoding==='string','fixture metadata');
  ensure(blob(raw)===EVENT_BLOB,'fixture Git blob drift');
  ensure(Array.isArray(fixture.cases)&&fixture.cases.length===8,'eight vectors required');
  const ids=new Set();
  for(const c of fixture.cases){
    fields(c,['id','user','name','payload','base_rev','canonical_payload_json','sha256']);
    ensure(typeof c.id==='string'&&ID.test(c.id)&&!ids.has(c.id),'invalid or duplicate event vector ID');ids.add(c.id);
    ensure(typeof c.user==='string'&&c.user.length>0&&/^[a-z_]+$/.test(c.name)&&
      Number.isSafeInteger(c.base_rev)&&c.base_rev>=0,'invalid event vector');
    const payload=canonical(c.payload);
    ensure(payload===c.canonical_payload_json,'canonical payload mismatch: '+c.id);
    const expected=sha256(JSON.stringify([c.user,c.name,c.base_rev,payload]));
    ensure(HASH64.test(c.sha256)&&expected===c.sha256,'fingerprint mismatch: '+c.id);
  }
  return {fixture_blob:EVENT_BLOB,vector_count:ids.size,host_reference_only:true,backend_parity_certified:false};
}
export function validateEventReceipt(receipt,fixture){
  fields(receipt,['schema','fixture_blob','backends']);
  ensure(receipt.schema==='ores-liveview-event-backend-receipt-v1'&&receipt.fixture_blob===EVENT_BLOB,'receipt version mismatch');
  ensure(Array.isArray(receipt.backends)&&receipt.backends.length===EVENT_BACKENDS.length,'five backends required');
  const cases=new Map(fixture.cases.map(c=>[c.id,c.sha256])),seen=new Set();
  for(const b of receipt.backends){
    fields(b,['backend','repository','head_sha','tree_sha','runner','guest','results']);
    ensure(EVENT_BACKENDS.includes(b.backend)&&!seen.has(b.backend),'unknown or duplicate backend');seen.add(b.backend);
    ensure(b.repository==='ores-truffle-oreslang/oreslang-source.'+b.backend,'wrong backend repository');
    ensure(HASH40.test(b.head_sha)&&HASH40.test(b.tree_sha),'unpinned backend source');
    fields(b.runner,['run_id','job_id','runner_id','step_count','head_sha']);
    ensure(['run_id','job_id','runner_id','step_count'].every(k=>Number.isSafeInteger(b.runner[k])&&b.runner[k]>0)&&
      b.runner.head_sha===b.head_sha,'missing real-step runner identity');
    fields(b.guest,['compiled','executed','actual_socket_io','actor_owned_state','binary_sha256']);
    ensure(b.guest.compiled===true&&b.guest.executed===true&&b.guest.actual_socket_io===true&&
      b.guest.actor_owned_state===true&&HASH64.test(b.guest.binary_sha256),'host-only guest evidence');
    ensure(Array.isArray(b.results)&&b.results.length===cases.size,'missing fingerprint observations');
    const observed=new Set();
    for(const result of b.results){
      fields(result,['case_id','sha256']);
      ensure(cases.has(result.case_id)&&!observed.has(result.case_id),'unknown/duplicate case');
      observed.add(result.case_id);
      ensure(result.sha256===cases.get(result.case_id),'mismatched observed fingerprint: '+result.case_id);
    }
  }
  return {structurally_complete:true,runner_provenance_authenticated:false,
    guest_execution_authenticated:false,backend_parity_certified:false,backend_count:seen.size};
}
