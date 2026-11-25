// Admission of a target profile only; this cannot attest an AOT binary or CI.
import {inspect_strict_aot_inventory} from './strict-guest-aot-lanes-v1.mjs';

const TRIPLES=Object.freeze({
  'linux-x64': ['x86_64-unknown-linux-gnu','ELF64'],
  'linux-arm64': ['aarch64-unknown-linux-gnu','ELF64'],
  'windows-x64': ['x86_64-pc-windows-msvc','PE32+'],
  'macos-arm64': ['aarch64-apple-darwin','Mach-O64']
});
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^(?!0{64}$)[a-f0-9]{64}$/;
const BACKENDS=new Set(['java-graalvm','llvm','net-nativeaot','forge']);
function plainRecord(x,keys){
  if(x===null||typeof x!=='object'||Array.isArray(x)||Object.getPrototypeOf(x)!==Object.prototype)return false;
  const got=Object.keys(x);
  return got.length===keys.length&&got.every(k=>keys.includes(k))&&
    keys.every(k=>Object.hasOwn(x,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'));
}
export function inspectAotTargetProfile(inventory,candidate) {
  const result={classification:'INVALID',releaseQualified:false,errors:[]};
  try {
    inspect_strict_aot_inventory(inventory);
    const fields=['laneId','backend','platform','targetTriple','artifactFormat',
      'sourceCommit','sourceTree','compilerCommit','compilerTree',
      'compilerBinarySha256','guestBinarySha256'];
    if(!plainRecord(candidate,fields))throw Error('unexpected or accessor profile fields');
    if(!BACKENDS.has(candidate.backend))throw Error('unsupported backend');
    const triple=Object.hasOwn(TRIPLES,candidate.platform)?TRIPLES[candidate.platform]:null;
    if(!triple || candidate.targetTriple!==triple[0]||candidate.artifactFormat!==triple[1])
      throw Error('target triple and artifact format mismatch');
    if(candidate.laneId!==candidate.backend+'-'+candidate.platform)
      throw Error('lane identity mismatch');
    const lane=inventory.lanes.find(x=>x.id===candidate.laneId);
    if(!lane||lane.backend!==candidate.backend||lane.platform!==candidate.platform||
       lane.artifactFormat!==candidate.artifactFormat)
      throw Error('lane not present in source-only inventory');
    if(![candidate.sourceCommit,candidate.sourceTree,candidate.compilerCommit,
         candidate.compilerTree].every(x=>typeof x==='string'&&HEX40.test(x)))
      throw Error('missing exact source/compiler head and tree');
    if(![candidate.compilerBinarySha256,candidate.guestBinarySha256]
      .every(x=>typeof x==='string'&&HEX64.test(x)))
      throw Error('missing compiler/guest binary SHA-256');
    return {classification:'TARGET_PROFILE_SHAPE_VALID_UNATTESTED',
      releaseQualified:false,errors:[]};
  } catch(e) {
    result.errors.push(e instanceof Error?e.message:'invalid profile data');
    return result;
  }
}
