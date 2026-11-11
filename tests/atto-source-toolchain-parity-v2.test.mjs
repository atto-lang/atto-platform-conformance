import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ALL,CORE,validateToolchainParityV2} from '../lib/atto-source-toolchain-parity-v2.mjs';
const root=resolve('.');
const manifest=JSON.parse(readFileSync(resolve(root,'contracts/atto-source-toolchain-parity-v2.json'),'utf8'));
test('nine source toolchains tracked with strict no-certification invariant',()=>{
 assert.equal(ALL.length,9);assert.equal(CORE.length,5);
 assert.deepEqual(validateToolchainParityV2(manifest,root),[]);
 for(const id of ALL)assert.equal(manifest.fullCorpusEvidence[id],'NOT_CERTIFIED');
});
test('tampered source evidence or omitted toolchain never promotes parity',()=>{
 const mutations=[
 m=>m.fullExecutableParityCertified=true,
 m=>m.coreBackends.pop(),
 m=>m.extendedBackends.splice(2,1),
 m=>m.sourceRepositories.splice(4,1),
 m=>m.sourceRepositories[5].repo='ores-truffle-oreslang/oreslang-source.java',
 m=>m.fullCorpusEvidence.llvm='PASS',
 m=>m.promotionGates.pop(),
 m=>m.selectedReceipts[0].sourceSha='0'.repeat(40).toUpperCase(),
 m=>m.selectedReceipts[1].sourceBlobs=0,
 m=>m.selectedReceipts[2].scopeIsFullRepo=true,
 m=>m.selectedReceipts[2].evidenceClass='compiled-guest-subset',
 m=>m.selectedReceipts[3].evidenceClass='compiled-guest-subset',
 m=>m.selectedReceipts[5].evidenceClass='compiled-guest-subset',
 m=>m.selectedReceipts.reverse(),
 m=>m.knownDivergences=[]
 ];
 for(const [index,mutate] of mutations.entries()){
  const broken=structuredClone(manifest);mutate(broken);
  assert.ok(validateToolchainParityV2(broken,root).length>0,
    'mutation '+index+' was incorrectly admitted');
 }
});
