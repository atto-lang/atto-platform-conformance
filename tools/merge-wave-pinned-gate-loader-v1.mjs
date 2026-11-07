// Loads exact immutable source blobs from THIS checkout's Git object database.
// No network, pull requests, issue writes, mirrors, or dynamic unpinned source.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const PINS=Object.freeze([
  Object.freeze({key:'review',commit:'e4bc75bb4ca6db5eca03b944fef1658637a7635f',
    path:'tools/merge-wave-review-timeline.mjs',blob:'6c48511d311a0fc453b9dfdf10c0ecc9a09bbb36'}),
  Object.freeze({key:'ledger',commit:'ebffa81813ed61c82c2a4cd8f6861afac641931e',
    path:'lib/pr-blocker-ledger-v1.mjs',blob:'97eb079e4bf3819771fee49b4c2d3209925329ae'}),
  Object.freeze({key:'qualifier',commit:'a377ea19440e6a69d87e4bfea73625ba247a3fee',
    path:'tools/merge-wave-qualifier.mjs',blob:'adb025c93e73d1c0ccf236604d8fd7d5429b893a'}),
  Object.freeze({key:'live',commit:'978211a03187e9364154a58412b8a4ec888fea85',
    path:'tools/merge-wave-live-evidence-v1.mjs',blob:'f6a37ad3066228b5cbe0050709652b9689f4b53f'}),
  Object.freeze({key:'binder',commit:'f9d79551cc77412f26800cb2ed3449cb144f9b1a',
    path:'tools/merge-wave-integrated-gates-v1.mjs',blob:'ec5293ec292b008178112b98363c99e2016fec8d'})
]);
const SHA=/^[a-f0-9]{40}$/;
export const gateSourcePins=PINS;

// Validates the Git blob bytes, not merely the commit's name or the caller's path.
export function verifyPinnedBlob(bytes,expected) {
  if(!Buffer.isBuffer(bytes)||typeof expected!=='string'||!SHA.test(expected))
    throw new TypeError('pinned source requires raw Git blob bytes and a SHA-1 object ID');
  const h=createHash('sha1');
  h.update(Buffer.from('blob '+bytes.length+'\0'));
  h.update(bytes);
  if(h.digest('hex')!==expected) throw Error('PINNED_GATE_BLOB_MISMATCH');
  return true;
}

export async function loadPinnedFiveGates({readGitObject}={}) {
  // Injectable read is test-only; returned code MUST pass same immutable byte digest.
  const read=readGitObject??((pin)=>{
    const args=['--no-pager','show',pin.commit+':'+pin.path];
    const r=spawnSync('git',args,{encoding:null,maxBuffer:256*1024,
      env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'}});
    if(r.error||r.status!==0||!Buffer.isBuffer(r.stdout))
      throw Error('PINNED_GATE_GIT_OBJECT_UNAVAILABLE:'+pin.key);
    return r.stdout;
  });
  if(typeof read!=='function') throw new TypeError('readGitObject must be a function');
  const loaded={};
  for(const pin of PINS){
    const bytes=await read(pin);
    if(!Buffer.isBuffer(bytes)||bytes.length>128*1024) throw Error('PINNED_GATE_SOURCE_UNBOUNDED:'+pin.key);
    verifyPinnedBlob(bytes,pin.blob);
    const text=bytes.toString('utf8');
    if(!Buffer.from(text,'utf8').equals(bytes)||/^\s*import\s/m.test(text))
      throw Error('PINNED_GATE_SOURCE_ENCODING_OR_DEPENDENCY_INVALID:'+pin.key);
    const module=await import('data:text/javascript;base64,'+bytes.toString('base64'));
    loaded[pin.key]=module;
  }
  for(const [name,fn] of [['review','qualifyReviewTimeline'],['ledger','collectExactHeadEvidence'],
    ['qualifier','qualifyCandidate'],['live','collectLiveEvidence'],['live','readPages'],
    ['binder','bindMergeWaveGates']]){
    if(typeof loaded[name]?.[fn]!=='function') throw Error('PINNED_GATE_EXPORT_MISSING:'+name+':'+fn);
  }
  return Object.freeze({
    collectLiveEvidence:loaded.live.collectLiveEvidence,
    readPages:loaded.live.readPages,
    qualifyReviewTimeline:loaded.review.qualifyReviewTimeline,
    collectExactHeadEvidence:loaded.ledger.collectExactHeadEvidence,
    qualifyCandidate:loaded.qualifier.qualifyCandidate,
    bindMergeWaveGates:loaded.binder.bindMergeWaveGates
  });
}
