// Strict source-only RFC6455/LiveView conformance receipt validator.
// No report, even one with plausible hashes, authenticates native execution.
import {createHash} from 'node:crypto';
export const BACKENDS=Object.freeze(['java','llvm','wasm','forge','net']);
export const FIXTURE_BLOB='931f58c1acd40e4c7e1b0b061f1711a0afe3c9b8';
const HASH40=/^[0-9a-f]{40}$/;const HASH64=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const check=(ok,msg)=>{if(!ok)throw Error('LIVEVIEW_WIRE_GATE: '+msg)};
const fields=(o,keys)=>check(o!==null && typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(x=>Object.hasOwn(o,x)),
  'field contract mismatch: '+keys.join(','));
export function gitBlob(content){
  const data=Buffer.from(content,'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from('blob '+data.length),Buffer.from([0])])).update(data).digest('hex');
}
export function validateVectors(registry,raw){
  fields(registry,['schema','purpose','cases']);
  check(registry.schema==='ores-liveview-wire-v1','wire registry schema');
  check(Array.isArray(registry.cases)&&registry.cases.length===41,'expected 41 wire vectors');
  check(gitBlob(raw)===FIXTURE_BLOB,'fixture blob mismatch');
  const ids=new Set();
  for(const c of registry.cases){
    const negative=c.error_code!==undefined;
    fields(c,negative?['id','frames_hex','expected','error_code']:['id','frames_hex','expected']);
    check(typeof c.id==='string'&&ID.test(c.id)&&!ids.has(c.id),'invalid or duplicate case id');
    ids.add(c.id);
    check(typeof c.frames_hex==='string'&&c.frames_hex.length>=4&&c.frames_hex.length<=1024*2&&
      c.frames_hex.length%2===0&&/^[0-9a-f]+$/.test(c.frames_hex),'invalid hex fixture');
    if(negative){
      check(c.expected===null && [1002,1003,1007,1009].includes(c.error_code),'invalid reject oracle');
    } else {
      check(Array.isArray(c.expected)&&c.expected.length>=1&&c.expected.length<=8,'invalid positive oracle');
      for(const m of c.expected){
        check(m && typeof m==='object'&&!Array.isArray(m)&&['text','ping','pong','close'].includes(m.type),
          'invalid positive message');
        if(m.type==='text') {
          fields(m,['type','data']);
          check(typeof m.data==='string' && Buffer.byteLength(m.data,'utf8')<=65536,'invalid text oracle');
        } else {
          fields(m,['type','data_hex']);
          check(typeof m.data_hex==='string'&&m.data_hex.length%2===0&&
            /^[0-9a-f]*$/.test(m.data_hex),'invalid binary oracle');
        }
      }
    }
  }
  return {vector_count:ids.size,fixture_blob:FIXTURE_BLOB,source_only:true};
}
export function validateReceipt(report,registry){
  fields(report,['schema','fixture_blob','backends']);
  check(report.schema==='ores-liveview-wire-backend-receipt-v1','backend receipt schema');
  check(report.fixture_blob===FIXTURE_BLOB,'wrong fixture');
  check(Array.isArray(report.backends)&&report.backends.length===5,'exact five backend records required');
  const seen=new Set(),allCases=new Set(registry.cases.map(x=>x.id));
  for(const b of report.backends){
    fields(b,['backend','repository','head_sha','tree_sha','profile','runner','guest','results']);
    check(BACKENDS.includes(b.backend)&&!seen.has(b.backend),'unknown/duplicate backend');
    seen.add(b.backend);
    check(b.repository==='ores-truffle-oreslang/oreslang-source.'+b.backend,'backend repository mismatch');
    check(HASH40.test(b.head_sha)&&HASH40.test(b.tree_sha),'non-pinned SHA');
    check(typeof b.profile==='string' && /^(?:jvm|native-image|native|wasi|browser|net-native-aot|forge-native)$/.test(b.profile),'unknown execution profile');
    fields(b.runner,['run_id','job_id','runner_id','step_count','head_sha']);
    for(const n of ['run_id','job_id','runner_id','step_count'])
      check(Number.isSafeInteger(b.runner[n]) && b.runner[n]>0,'zero-step or missing runner');
    check(b.runner.head_sha===b.head_sha,'workflow head does not match source');
    fields(b.guest,['kind','compiled','executed','binary_sha256']);
    check(b.guest.kind==='native-oreslang-guest' && b.guest.compiled===true && b.guest.executed===true &&
      HASH64.test(b.guest.binary_sha256),'no compiled guest evidence claim');
    check(Array.isArray(b.results) && b.results.length===allCases.size,'incomplete vector receipts');
    const ids=new Set();
    for(const result of b.results){
      fields(result,['case_id','actual']);
      check(allCases.has(result.case_id)&&!ids.has(result.case_id),'duplicate or unknown vector receipt');
      ids.add(result.case_id);
      const want=registry.cases.find(x=>x.id===result.case_id);
      const expected=want.error_code===undefined?{messages:want.expected}:{close_code:want.error_code};
      check(JSON.stringify(result.actual)===JSON.stringify(expected),'observed vector mismatch: '+result.case_id);
    }
  }
  return {structurally_complete:true,runner_provenance_authenticated:false,
    guest_execution_authenticated:false,backend_parity_certified:false,
    backend_count:seen.size,fixture_blob:FIXTURE_BLOB};
}
