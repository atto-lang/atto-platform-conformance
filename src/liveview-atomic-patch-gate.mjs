// Data-only cross-backend LiveView DOM patch/snapshot contract gate.
// Structural consistency is NOT authenticated guest execution evidence.
import {createHash} from 'node:crypto';
export const ATOMIC_BLOB='1afd6d4c73b7bb0ee4424eadb265c47eb40e7652';
export const BACKENDS=Object.freeze(['java','llvm','wasm','forge','net']);
const fail=m=>{throw new Error('LIVEVIEW_ATOMIC_PATCH_GATE: '+m)};
const check=(v,m)=>{if(!v)fail(m)};
const sha40=/^[a-f0-9]{40}$/,sha64=/^[a-f0-9]{64}$/;
const hexId=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowed=['patch','snapshot'];
export function gitBlob(text) {
  const buf=Buffer.from(text,'utf8');
  return createHash('sha1').update(Buffer.from('blob '+buf.length+'\0')).update(buf).digest('hex');
}
export function validateAtomicFixture(fixture,raw) {
  check(typeof raw==='string' && gitBlob(raw)===ATOMIC_BLOB,'immutable atomic fixture blob mismatch');
  check(JSON.stringify(fixture,null,2)+'\n'===raw,'fixture object does not match pinned bytes');
  check(fixture && !Array.isArray(fixture) && fixture.schema==='ores-liveview-atomic-patch-v1','unknown schema');
  check(Object.keys(fixture).sort().join(',')==='cases,purpose,schema','fixture field contract');
  check(Array.isArray(fixture.cases) && fixture.cases.length===10,'exact 10 deterministic cases required');
  const ids=new Set();
  for(const c of fixture.cases){
    check(c && !Array.isArray(c) && Object.keys(c).sort().join(',')==='after,before,expected,id','case field contract');
    check(typeof c.id==='string' && hexId.test(c.id) && !ids.has(c.id),'duplicate or invalid case ID');
    ids.add(c.id);
    check(Array.isArray(c.before) && Array.isArray(c.after) && allowed.includes(c.expected),'invalid case contract');
    for(const tree of [c.before,c.after]){
      const used=new Set(),walk=nodes=>{for(const n of nodes){
        check(n && typeof n==='object'&&!Array.isArray(n)&&typeof n.id==='string'&&
          /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(n.id)&&!used.has(n.id),'invalid or duplicate element ID');
        used.add(n.id);check(n.tag==='div'||n.tag==='span','invalid test element');
        if(n.attrs!==undefined){check(n.attrs && typeof n.attrs==='object'&&!Array.isArray(n.attrs),'invalid attrs');
          for(const [k,v] of Object.entries(n.attrs))check(k==='class'&&typeof v==='string','invalid attr');}
        if(n.text!==undefined)check(typeof n.text==='string' && n.children===undefined,'invalid text');
        if(n.children!==undefined){check(Array.isArray(n.children),'invalid children');walk(n.children);}
      }};walk(tree);
    }
  }
  check(typeof raw==='string' && gitBlob(raw)===gitBlob(JSON.stringify(fixture,null,2)+'\n'),'fixture bytes are not canonical');
  return {case_count:ids.size,fixture_blob:gitBlob(raw),source_only:true};
}
export function validateAtomicReceipt(report,fixture,raw) {
  const {fixture_blob}=validateAtomicFixture(fixture,raw);
  check(report && !Array.isArray(report) && Object.keys(report).sort().join(',')==='backends,fixture_blob,schema','receipt field contract');
  check(report.schema==='ores-liveview-atomic-patch-receipt-v1' && report.fixture_blob===fixture_blob,'wrong fixture receipt');
  check(Array.isArray(report.backends) && report.backends.length===5,'exact five backends required');
  const ids=new Set();
  for(const b of report.backends){
    check(b && !Array.isArray(b) && Object.keys(b).sort().join(',')==='backend,binary_sha256,head_sha,results,runner','backend receipt fields');
    check(BACKENDS.includes(b.backend) && !ids.has(b.backend),'unknown or duplicate backend');ids.add(b.backend);
    check(sha40.test(b.head_sha) && sha64.test(b.binary_sha256),'unbound source/binary');
    check(b.runner && Object.keys(b.runner).sort().join(',')==='job_id,run_id,runner_id,step_count','runner receipt fields');
    for(const key of ['job_id','run_id','runner_id','step_count'])check(Number.isSafeInteger(b.runner[key]) && b.runner[key]>0,'zero-step or missing runner');
    check(Array.isArray(b.results)&&b.results.length===fixture.cases.length,'missing case results');
    const resultIds=new Set();
    for(const item of b.results){
      check(item && Object.keys(item).sort().join(',')==='case_id,observed','result fields');
      const oracle=fixture.cases.find(c=>c.id===item.case_id);
      check(oracle&&!resultIds.has(item.case_id)&&item.observed===oracle.expected,'incorrect, unknown or duplicate case result');
      resultIds.add(item.case_id);
    }
  }
  return {structurally_complete:true,backend_count:5,runner_provenance_authenticated:false,
    guest_execution_authenticated:false,backend_parity_certified:false,fixture_blob};
}
