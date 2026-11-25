// Only contract-shape/mutation tests; these NEVER certify compiled .atto guest parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStdActorParity,readStdActorParity} from '../lib/std-actor-parity-v1.mjs';
import {classifyAttoRun} from '../lib/atto-library-run-evidence-v1.mjs';
const contract=readStdActorParity();
const validate=()=>validateStdActorParity(contract);
function rejected(name, change) {
  test('fail closed: '+name,()=>{
    const m=structuredClone(contract); change(m);
    assert.throws(()=>validateStdActorParity(m));
  });
}
test('all eleven compiler-owned actor target profiles are unverified',()=>{
  assert.equal(validate(),true);
  assert.equal(Object.keys(contract.backends).length,11);
  assert.deepEqual(Object.entries(contract.backends).filter(([,x])=>x.contractStatus==='NOT_IMPLEMENTED').map(([name])=>name),['atto','realtime']);
  assert.equal(Object.values(contract.backends).filter(x=>x.contractStatus==='NOT_EXECUTED').length,9);
});
test('two namespaces mean separate surfaces, never automatic actor scheduling authority',()=>{
  assert.equal(contract.sourceNamespace,'std.actor');
  assert.equal(contract.optionalRuntimeProfile,'atto.runtime.actor');
  assert.notEqual(contract.sourceNamespace,contract.optionalRuntimeProfile);
  assert.equal(contract.layers.stdActorDependency,false);
  assert.equal(contract.invariants.actorReplyMaySettleBeforeActorRetirement,true);
  assert.equal(contract.invariants.actorDoneRequiresPhysicalQuiescence,true);
});
rejected('allow implicit runtime in std',m=>m.layers.stdActorDependency=true);
rejected('turn policy namespace into runtime alias',m=>m.optionalRuntimeProfile='std.actor');
rejected('grant CONTROL from guest booleans',m=>m.invariants.guestBooleansNeverCreateCapabilities=false);
rejected('permit get_done without physical quiescence',m=>m.invariants.actorDoneRequiresPhysicalQuiescence=false);
rejected('wrongly delay every actor reply until retirement',m=>m.invariants.actorReplyMaySettleBeforeActorRetirement=false);
rejected('borrow future one-shot receipt',m=>m.api.futures[0].formal='ActorFuture<T>');
rejected('unwrap Result from actor',m=>m.api.futures[1].returns='T');
rejected('add privileged policy method without review',m=>m.api.policy.push('mint_control'));
rejected('allow more than bounded mailbox capacity',m=>m.api.mailboxCapacityBounds[1]=2147483647);
rejected('convert HDL to fabricated PASS',m=>m.backends.hdl.contractStatus='PASS');
rejected('convert bootstrap compiler to PASS',m=>m.backends.atto.contractStatus='PASS');
rejected('hide self-hosting backend',m=>{delete m.backends.atto});
rejected('hide realtime backend',m=>{delete m.backends.realtime});
rejected('invent a twelfth compiler',m=>m.backends.other={repo:'other',pr:1,contractStatus:'NOT_EXECUTED'});
rejected('drop native negative fixture',m=>m.guestTests.futureNegative.pop());
rejected('silently skip some adversarial guest tests',m=>m.guestTests.boundaries.assertions=34);
rejected('omit independent receipt verification',m=>m.verificationRequired.pop());
rejected('mark unverified matrix as certified',m=>m.status='CERTIFIED');
test('zero-step GitHub failures remain NOT_EXECUTED and cannot authorize mirroring or merging',()=>{
  const head='a'.repeat(40);
  const result=classifyAttoRun({run:{id:123,run_attempt:1,head_sha:head,status:'completed',conclusion:'failure'},
    jobs:[{id:456,name:'native-actor',status:'completed',conclusion:'failure',steps:[]}],
    expectedHead:head,expectedJob:'native-actor',requiredSteps:['Execute real guest']});
  assert.equal(result.classification,'RUNNER_ADMISSION_FAILURE');
  assert.equal(result.executedSteps,0);
});

rejected('remove namespace-negative compiler case',m=>m.guestTests.namespaceNegative.pop());
rejected('promote namespace fraud from E_UNBOUND to generic syntax failure',m=>m.guestTests.namespaceNegative[0].expectedDiagnostic='E_UNSUPPORTED');
rejected('remove implicit import authority condition',m=>m.guestTests.namespaceNegative[0].requires='anything');
test('namespace-negative fixture expectations are distinct, exact, and executable-only',()=>{
  assert.deepEqual(contract.guestTests.namespaceNegative.map(x=>x.expectedDiagnostic),
    ['E_UNBOUND','E_DUPLICATE','E_SYNTAX']);
  assert.equal(new Set(contract.guestTests.namespaceNegative.map(x=>x.file)).size,3);
  assert.equal(contract.status,'SOURCE_CONTRACT_ONLY');
});

rejected('make namespace-only fixture silently import dependencies',m=>m.guestTests.namespacePositive.noImplicitImports=false);
rejected('drop executable namespace-only guest',m=>delete m.guestTests.namespacePositive);
test('standalone pure namespaced functions require actual guest main 42',()=>{
  assert.equal(contract.guestTests.namespacePositive.path,'stdlib/actor/guest_namespace_only.atto');
  assert.equal(contract.guestTests.namespacePositive.expectedMain,42);
  assert.equal(contract.guestTests.namespacePositive.noImplicitImports,true);
});

rejected('delete native compiled mutant execution evidence',m=>m.verificationRequired.splice(m.verificationRequired.indexOf('compiled_guest_mutation_execution'),1));
rejected('silently omit middle guard mutation',m=>m.guestTests.mutationControls.failCodeBoundaries.splice(1,1));
rejected('replace real compiler with host-side policy emulator',m=>m.guestTests.mutationControls.requiredCompiler='javascript_policy_emulator');
rejected('allow mutated guest to report 42',m=>m.guestTests.mutationControls.mustNotReturnSuccess42=false);
rejected('ignore host imports in mutant',m=>m.guestTests.mutationControls.rejectUnexpectedHostImports=false);
test('real compiler mutation controls must observe all six distinct failure codes',()=>{
  const m=contract.guestTests.mutationControls;
  assert.deepEqual(m.failCodeSmoke,[1,18,34]);
  assert.deepEqual(m.failCodeBoundaries,[100,166,232]);
  assert.equal(m.mustCompileAndExecute,true);
  assert.equal(m.requiredCompiler,'production_backend_compiler');
});

rejected('drop core ownership contract',m=>delete m.coreOwnership);
rejected('accept borrowed await in core',m=>m.coreOwnership.borrowedAwaitDiagnostic='NONE');
rejected('silently allow live Future loan over await',m=>m.coreOwnership.liveLoanAcrossAwaitDiagnostic='NONE');
rejected('treat source preflight as sound MIR',m=>m.coreOwnership.preflightIsNotFullBorrowChecker=false);
rejected('let valid Future source run without trusted runtime',m=>m.coreOwnership.validOwnedRequiresTypedAffineMirAndRuntime=false);
rejected('remove core ownership evidence requirement',m=>m.verificationRequired.pop());
rejected('drop core sealed constructor negative',m=>m.guestTests.futureOwnershipNegative.pop());
rejected('weaken post-await use error',m=>m.guestTests.futureOwnershipNegative[0].expectedDiagnostic='E_UNSUPPORTED');
test('native affine Future negative probes cover move, loan, repeat and forgery',()=>{
  const f=contract.guestTests.futureOwnershipNegative;
  assert.equal(f.length,4);
  assert.deepEqual(f.map(x=>x.expectedDiagnostic),['E_MOVED','E_BORROW','E_MOVED','E_RESERVED']);
  assert.equal(contract.coreOwnership.ownedReceiptFormal,'take!');
  assert.equal(contract.coreOwnership.negativeBeforeCodegen,true);
  assert.equal(contract.coreOwnership.preflightIsNotFullBorrowChecker,true);
});
