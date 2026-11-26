// Host-only receipt shape guard. Never promotes backend status or authenticates CI.
import test from 'node:test';
import assert from 'node:assert/strict';
const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const counters = ['dynamicAllocations','allocatedBytes','payloadCopies','copiedBytes'];
function validate(r, expected) {
  if (!r || r.repo !== expected.repo || r.caseId !== expected.caseId ||
      !sha1.test(r.head || '') || r.head !== expected.head ||
      !sha1.test(r.tree || '') || r.tree !== expected.tree ||
      !sha256.test(r.compilerDigest || '') || r.compilerDigest !== expected.compilerDigest) return false;
  if (r.mode !== 'default-aot' || r.jit !== false || r.optIn !== false ||
      r.evidenceKind !== 'compiler-emitted-guest' || r.scope !== expected.scope ||
      r.exit !== expected.exit || r.referenceExit !== expected.exit || r.referenceMode !== 'optimization-disabled') return false;
  if (!Number.isSafeInteger(r.runnerId) || r.runnerId <= 0 ||
      !Number.isSafeInteger(r.executedSteps) || r.executedSteps <= 0 || r.conclusion !== 'success') return false;
  if (!r.metrics || !counters.every(k => Object.hasOwn(r.metrics,k) && Number.isSafeInteger(r.metrics[k]) && r.metrics[k] >= 0)) return false;
  if (expected.zeroAllocation && (r.metrics.dynamicAllocations !== 0 || r.metrics.allocatedBytes !== 0)) return false;
  if (expected.zeroCopy && (r.metrics.payloadCopies !== 0 || r.metrics.copiedBytes !== 0)) return false;
  return true;
}
const expected = {repo:'atto-lang/atto-source.rs',caseId:'signature-1',head:'a'.repeat(40),tree:'b'.repeat(40),compilerDigest:'c'.repeat(64),scope:'guest main after initialization',exit:42,zeroAllocation:true,zeroCopy:true};
const good = {repo:expected.repo,caseId:expected.caseId,head:expected.head,tree:expected.tree,compilerDigest:expected.compilerDigest,mode:'default-aot',jit:false,optIn:false,evidenceKind:'compiler-emitted-guest',scope:expected.scope,exit:42,referenceExit:42,referenceMode:'optimization-disabled',runnerId:1,executedSteps:4,conclusion:'success',metrics:{dynamicAllocations:0,allocatedBytes:0,payloadCopies:0,copiedBytes:0}};
test('synthetic complete receipt shape is accepted, not promoted',()=>assert.equal(validate(good,expected),true));
for (const [name,patch] of Object.entries({
  'no runner':{runnerId:0},'zero steps':{executedSteps:0},'wrong tree':{tree:'d'.repeat(40)},
  'wrong head':{head:'d'.repeat(40)},'wrong compiler':{compilerDigest:'d'.repeat(64)},
  'host-only':{evidenceKind:'host-only'},'opt-in':{optIn:true},'JIT':{jit:true},
  'changed semantics':{referenceExit:41},'incorrect scope':{scope:'host'},'failed job':{conclusion:'failure'},
  'missing metrics':{metrics:{}},'missing copied bytes':{metrics:{dynamicAllocations:0,allocatedBytes:0,payloadCopies:0}},
  'hidden allocation bytes':{metrics:{...good.metrics,allocatedBytes:8}},'hidden copied bytes':{metrics:{...good.metrics,copiedBytes:8}},
  'negative count':{metrics:{...good.metrics,payloadCopies:-1}}
})) test('rejects '+name,()=>assert.equal(validate({...good,...patch},expected),false));
