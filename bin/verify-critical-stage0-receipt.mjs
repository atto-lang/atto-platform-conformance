// Strict, UNATTESTED consistency check for one stage-0 execution receipt.
// This cannot authenticate GitHub, grant source transfer, or certify parity.
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const expected={
  'java-graal':{
    'positive-try-critical-named-mutex.ores':['guest','31'],
    'negative-queued-critical-unlowered.ores':['compile-reject','E_CRITICAL_UNLOWERED'],
    'negative-try-critical-call-effect.ores':['compile-reject','E_CRITICAL_BODY_EFFECT'],
    'negative-try-critical-shared-gate.ores':['compile-reject','E_CRITICAL_GATE_TYPE']
  },
  llvm:{
    'sync-fnc':['compile-pass',null],
    'critical-suspends-order-a':['compile-reject','E_CRITICAL_SUSPENDS_DECL'],
    'critical-suspends-order-b':['compile-reject','E_CRITICAL_SUSPENDS_DECL']
  },
  'dotnet-nativeaot':{
    'sync-fnc':['compile-pass',null],
    'critical-suspends-order-a':['compile-reject','E_CRITICAL_SUSPENDS_DECL'],
    'critical-suspends-order-b':['compile-reject','E_CRITICAL_SUSPENDS_DECL'],
    'async-fnc-rejected':['compile-reject','E_ASYNC_FUNCTION_REMOVED']
  },
  cranelift:{
    'sync-fnc':['compile-pass',null],
    'critical-suspends-order-a':['compile-reject','E_CRITICAL_SUSPENDS_DECL'],
    'critical-suspends-order-b':['compile-reject','E_CRITICAL_SUSPENDS_DECL'],
    'async-fnc-rejected':['compile-reject','E_ASYNC_FUNCTION_REMOVED']
  },
  wasm:{
    'critical-gate-host-denied':['host-reject','E_CRITICAL_UNLOWERED'],
    'generator-frame-host-denied':['host-reject','E_ASYNC_GENERATOR_UNLOWERED'],
    'suspending-critical-body-host-denied':['host-reject','E_CRITICAL_SUSPENSION']
  }
};
const fail=message=>{throw new Error(message);};
export function verifyCriticalStage0Receipt(receipt, plan) {
  if (receipt?.schema!=='oreslang.critical-suspends.stage0-receipt/1' ||
      plan?.schema!=='oreslang.critical-suspends.current-head-preflight/1')
    fail('invalid stage0 schema');
  if (receipt.self_attested_parity!==false || receipt.cross_org_source_transfer!==false)
    fail('unattested stage0 receipt cannot claim parity or cross-org source export');
  const entry=plan.entries.find(x=>x.backend===receipt.backend);
  if (!entry || !Object.hasOwn(expected,receipt.backend))
    fail('backend absent from pinned current-head plan');
  if (!SHA40.test(receipt.source_commit_sha) || !SHA40.test(receipt.source_tree_sha) ||
      receipt.source_commit_sha!==entry.commit || receipt.source_tree_sha!==entry.tree)
    fail('stage0 receipt does not match exact source commit and tree');
  if (receipt.fixture_manifest_blob_sha1!==plan.fixture.manifest_blob_sha1)
    fail('fixture manifest identity mismatch');
  for (const name of ['run_id','job_id','run_attempt','runner_id','executed_steps'])
    if (!Number.isSafeInteger(receipt[name]) || receipt[name]<1)
      fail('stage0 requires an actually admitted runner and nonzero executed steps: '+name);
  if (!SHA64.test(receipt.test_plan_sha256))
    fail('stage0 test plan digest required');
  const spec=expected[receipt.backend];
  if (!receipt.cases || Object.keys(receipt.cases).length!==Object.keys(spec).length ||
      Object.keys(receipt.cases).some(id=>!Object.hasOwn(spec,id)))
    fail('exact small stage0 case set required');
  let hasGuest=false,hasCompiler=false,hasHost=false;
  for (const [id,[phase,want]] of Object.entries(spec)) {
    const value=receipt.cases[id];
    if (!value || value.phase!==phase || value.status!=='pass')
      fail('missing or failed stage0 case: '+id);
    if (phase==='guest') {
      hasGuest=true;
      if (value.native_guest_executed!==true || value.compiler_accepted!==true ||
          value.stdout!==want || value.exit_code!==0)
        fail('native guest output/exit mismatch: '+id);
    } else if (phase==='compile-pass') {
      hasCompiler=true;
      if (value.compiler_accepted!==true || value.exit_code!==0)
        fail('real compiler acceptance required: '+id);
    } else if (phase==='compile-reject') {
      hasCompiler=true;
      // A nonzero exit alone is not rejection: signal crashes, timeout and
      // diagnostics preceded by an unrelated type/syntax error are failures.
      const firstCode=typeof value.stderr==='string'
        ? value.stderr.match(/\\bE_[A-Z0-9_]+\\b/)?.[0] : null;
      if (value.compiler_rejected!==true ||
          !Number.isInteger(value.exit_code) || value.exit_code<1 ||
          value.exit_code>255 || value.timed_out!==false || value.signal!==null ||
          value.diagnostic_code!==want || firstCode!==want ||
          value.emitted_artifact!==false)
        fail('exact first compiler diagnostic, non-signal exit, no artifacts required: '+id);
    } else {
      hasHost=true;
      if (value.host_test_executed!==true || value.diagnostic_code!==want)
        fail('host capability rejection required: '+id);
    }
  }
  if (hasCompiler || hasGuest) {
    if (receipt.compiler_invoked!==true || !SHA64.test(receipt.compiler_sha256))
      fail('compiler invocation and digest required');
  } else if (receipt.compiler_invoked!==false || receipt.compiler_sha256!==null)
    fail('host-only stage must not claim compiler invocation');
  if (receipt.native_guest_executed!==hasGuest)
    fail('host, compiler and native guest evidence must remain separate');
  if (hasHost && (hasGuest || hasCompiler))
    fail('host-only claims cannot be mixed with compiler or guest claims');
  return Object.freeze({classification:'UNATTESTED_STAGE0_RECORD',
    backend:receipt.backend,evidence_class:hasGuest?'GUEST':hasCompiler?'COMPILER_ADMISSION':'HOST_ONLY',
    checked_cases:Object.keys(spec).length});
}
