/** Structural admission for eight modes x two actor kinds = sixteen cases.
 * THIS IS NOT guest execution or an authenticated CI attestation.
 */
export const MATRIX = Object.freeze([
  ['graalvm','aot','aot'], ['graalvm','aot','jit'],
  ['graalvm','jit','aot'], ['graalvm','jit','jit'],
  ['llvm','aot','aot'], ['llvm','aot','jit'],
  ['llvm','jit','aot'], ['llvm','jit','jit'],
].map(([backend,from,to]) => backend+':'+from+'->'+to));
export const ACTOR_KINDS=Object.freeze(['shared','private']);
const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^[0-9a-f]{64}$/;
const positive=x=>Number.isSafeInteger(x)&&x>0;
function reject(detail){throw new Error('actor hot-reload evidence rejected: '+detail)}
function keys(obj,names,label){
  if (!obj||typeof obj!=='object'||Array.isArray(obj))
    reject(label+' is not an object');
  if(Object.keys(obj).sort().join('|')!==names.slice().sort().join('|'))
    reject(label+' has missing/extra keys');
}
export function pendingReport(){
  return {schema_version:2,feature:'oreslang-actor-hot-reload-v2',
    cases:ACTOR_KINDS.flatMap(actor_kind=>MATRIX.map(transition=>({transition,actor_kind,
      status:'blocked',source_commit:null,source_tree:null,
      compiled_image_sha256:null,ci:null,observed:null})))};
}
export function evaluateHotReloadReport(report){
  keys(report,['schema_version','feature','cases'],'report');
  if(report.schema_version!==2||report.feature!=='oreslang-actor-hot-reload-v2')
    reject('wrong feature/schema');
  if(!Array.isArray(report.cases)||report.cases.length!==MATRIX.length*ACTOR_KINDS.length)
    reject('must include all sixteen actor-kind / mode combinations');
  let passed=0;
  const seen=new Set(),blocked=[];
  for(const c of report.cases){
    keys(c,['transition','actor_kind','status','source_commit','source_tree',
      'compiled_image_sha256','ci','observed'],'case');
    if(!MATRIX.includes(c.transition)||!ACTOR_KINDS.includes(c.actor_kind))
      reject('invalid transition or actor kind');
    const identity=c.actor_kind+'|'+c.transition;
    if(seen.has(identity)) reject('duplicate actor-kind / transition');
    seen.add(identity);
    if(!['executed','blocked','unsupported'].includes(c.status))
      reject('invalid status');
    if(c.status!=='executed'){
      if(c.compiled_image_sha256!==null||c.ci!==null||c.observed!==null||
         c.source_commit!==null||c.source_tree!==null)
        reject('blocked case contains fake execution evidence');
      blocked.push(identity);
      continue;
    }
    if(!SHA40.test(c.source_commit)||!SHA40.test(c.source_tree)||
       !SHA256.test(c.compiled_image_sha256))
      reject('invalid exact-head source/image fields');
    keys(c.ci,['head_sha','run_id','job_id','steps_executed'],'CI receipt');
    if(c.ci.head_sha!==c.source_commit||!positive(c.ci.run_id)||
       !positive(c.ci.job_id)||!positive(c.ci.steps_executed))
      reject('wrong CI head or zero-step job');
    const o=c.observed;
    keys(o,['actor_id_before','actor_id_after','heap_id_before','heap_id_after',
      'allocation_domain_before','allocation_domain_after',
      'mailbox_id_before','mailbox_id_after','generation_before','generation_after',
      'outputs','on_start_runs','old_code_pin_blocked_commit',
      'old_code_retired_after_last_pin','rejected_upgrade_kept_previous_epoch',
      'duplicate_delivery_count','guest_compiled','guest_executed',
      'real_image_switch'],'actor observation');
    for(const key of ['actor_id_before','heap_id_before','mailbox_id_before',
       'allocation_domain_before'])
      if(typeof o[key]!=='string'||!o[key]) reject('invalid '+key);
    for(const [a,b] of [['actor_id_before','actor_id_after'],
       ['heap_id_before','heap_id_after'],['mailbox_id_before','mailbox_id_after'],
       ['allocation_domain_before','allocation_domain_after']])
      if(o[a]!==o[b]) reject('actor resource changed: '+a);
    if(!Number.isSafeInteger(o.generation_before)||o.generation_before<0||
       o.generation_after!==o.generation_before+1)
      reject('non-monotonic generation');
    if(JSON.stringify(o.outputs)!==JSON.stringify([42,43,45]))
      reject('state or handler output lost');
    if(o.on_start_runs!==1) reject('actor restarted');
    for(const name of ['old_code_pin_blocked_commit',
        'old_code_retired_after_last_pin','rejected_upgrade_kept_previous_epoch',
        'guest_compiled','guest_executed','real_image_switch'])
      if(o[name]!==true) reject(name+' false');
    if(o.duplicate_delivery_count!==0) reject('duplicate mailbox delivery');
    passed++;
  }
  return {required_transitions:8,required_actor_kinds:ACTOR_KINDS.length,
    required_cases:16,structurally_passing_cases:passed,
    blocked_cases:blocked,structurally_complete:passed===16,
    // No self-reported document can establish authentic source or real execution.
    authenticated_execution:false,production_hot_reload_certified:false};
}
