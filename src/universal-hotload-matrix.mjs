/** Structural-only UHL-1 proof admission; cannot authenticate CI or runtime. */
export const UHL1_BACKENDS=Object.freeze(['java-graal','llvm','wasm','dotnet-nativeaot','cranelift']);
export const UHL1_CASES=Object.freeze({
  'code-only':['logical_ref_stable','mailbox_stable','actor_incarnation_stable','route_epoch_advanced','outputs_42_43_45'],
  'supervisor':['child_spec_atomic','control_progress_during_freeze','planned_upgrade_not_restart','crash_restart_fenced'],
  'ets-code-only':['table_id_stable','table_rows_preserved','schema_stable','table_epoch_published_with_route'],
  'ets-heir':['dead_owner_fenced','same_tenant_only','heir_receipt_single_use','no_dual_writer'],
  'suspended-pins':['await_pin','ffi_pin','ets_reader_writer_pins','control_not_blocked','reclaim_after_final_pin'],
  'typed-migration':['fresh_actor_heap','checkpoint_schema_verified','precommit_rollback','postcommit_stale_ingress_denied'],
  'untrusted':['placement_enforced','guest_cannot_promote','quotas_enforced','forged_image_denied'],
  'unload':['code_image_pinned','cleanup_outside_control_lock','unload_failure_quarantined','no_use_after_free']
});
const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^[0-9a-f]{64}$/;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const expectedKeys=(obj,keys,where)=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('UHL1 evidence rejected: invalid '+where);
  if(Object.keys(obj).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('UHL1 evidence rejected: missing/extra '+where+' keys');
};
const reject=msg=>{throw Error('UHL1 evidence rejected: '+msg)};
export function pendingUhl1Report(){
  return {schema:'ores.hotload/uhl1-evidence-v1',
    records:UHL1_BACKENDS.flatMap(backend=>Object.keys(UHL1_CASES).map(scenario=>({
      backend,scenario,status:'not_executed',evidence:null
    })))};
}
function evidenceBasics(e,backend,status){
  expectedKeys(e,['source_sha','source_tree','compiler_sha256','image_sha256',
    'runner','compiler_executed','guest_executed','negative_proof_sha256','checks'],'evidence');
  if(!SHA40.test(e.source_sha)||!SHA40.test(e.source_tree)
      ||!SHA256.test(e.compiler_sha256)
      ||(status==='pass_executed'
        ? !SHA256.test(e.image_sha256)
        : status==='unsupported_confirmed'
          ? e.image_sha256!==null
          : e.image_sha256!==null&&!SHA256.test(e.image_sha256)))
    reject('invalid exact source/compiler/image digests');
  expectedKeys(e.runner,['head_sha','run_id','job_id','run_attempt','steps_executed','backend'],'runner');
  if(e.runner.head_sha!==e.source_sha||e.runner.backend!==backend
      ||!positive(e.runner.run_id)||!positive(e.runner.job_id)
      ||!positive(e.runner.run_attempt)||!positive(e.runner.steps_executed))
    reject('zero-step, mismatched or incomplete runner');
  if(e.compiler_executed!==true||typeof e.guest_executed!=='boolean')
    reject('not actual compiler or invalid guest flag');
}
export function evaluateUhl1Report(report){
  expectedKeys(report,['schema','records'],'report');
  if(report.schema!=='ores.hotload/uhl1-evidence-v1'||!Array.isArray(report.records))
    reject('wrong report version');
  const names=Object.keys(UHL1_CASES),required=UHL1_BACKENDS.length*names.length;
  if(report.records.length!==required)reject('incomplete five-backend matrix');
  const seen=new Set(),pending=[],unsupported=[],failed=[];
  let structurallyPassing=0;
  for(const row of report.records){
    expectedKeys(row,['backend','scenario','status','evidence'],'case');
    if(!UHL1_BACKENDS.includes(row.backend)||!names.includes(row.scenario))
      reject('unknown backend or scenario');
    const key=row.backend+'|'+row.scenario;
    if(seen.has(key))reject('duplicate matrix row');
    seen.add(key);
    if(row.status==='not_executed'){
      if(row.evidence!==null)reject('unexecuted record has evidence');
      pending.push(key);continue;
    }
    if(!['pass_executed','unsupported_confirmed','fail_executed'].includes(row.status))
      reject('unknown status');
    const e=row.evidence;
    evidenceBasics(e,row.backend,row.status);
    if(row.status==='pass_executed'){
      if(e.guest_executed!==true||e.negative_proof_sha256===null)
        reject('missing positive guest or negative mutation receipt');
      if(!SHA256.test(e.negative_proof_sha256))reject('missing negative proof hash');
      const checks=UHL1_CASES[row.scenario];
      expectedKeys(e.checks,checks,'scenario checks');
      if(checks.some(c=>e.checks[c]!==true))
        reject('missing/failing scenario witness');
      structurallyPassing++;
    }else if(row.status==='unsupported_confirmed'){
      // Unsupported counts as safe rejection, NOT hot-load parity.
      if(e.guest_executed!==false||!SHA256.test(e.negative_proof_sha256))
        reject('unsupported requires executed compiler denial');
      expectedKeys(e.checks,['denied_before_publish','no_guest_image_emitted'],'unsupported checks');
      if(e.checks.denied_before_publish!==true||e.checks.no_guest_image_emitted!==true)
        reject('unsupported feature did not fail closed');
      unsupported.push(key);
    }else{
      failed.push(key); // Authored evidence can still fail honestly.
    }
  }
  return {
    total:required,structurally_passing:structurallyPassing,
    pending,unsupported,failed,
    structurally_complete:structurallyPassing===required,
    // Self-reported JSON is NOT an attestation, even when entirely green.
    authenticated_execution:false,production_hot_load_certified:false
  };
}
