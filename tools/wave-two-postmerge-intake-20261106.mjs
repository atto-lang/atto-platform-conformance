/**
 * Read-only reconciliation of two 2026-11-06 AttoLang merge waves.
 * GitHub metadata is evidence to classify, NEVER authority to release or export.
 */
const OWNER = 'ores-truffle-oreslang';
const sha = x => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x);
const id = x => Number.isSafeInteger(x) && x > 0;
const entry = (repo, number, head, merge) => ({repo:\`\${OWNER}/\${repo}\`, number, head, merge});
export const WAVES = Object.freeze([
  Object.freeze([
    entry('oreslang-source.net',374,'d570052ed6ec2a5f3ce54483733dcb7664a01181','5d8246bca843309ee3f66538f1385fefb5690858'),
    entry('oreslang-source.forge',198,'51e2369d5e3d9f9fc9368c20a982e54e7e6c2ff1','7902eb2e3610babe1004a3e752b12079737992e6'),
    entry('oreslang-source.cranelift',94,'6e54844bfefca768e66b7421cb9db2e125f08202','a4f68cfa108bac77f1d945d23c37e1c55bea1b64'),
    entry('oreslang-source.rs',26,'6968d620957a6eb069df71440463beb43b9321c2','e516b09622f6d1b9d61330aff88e6c86bb6d97f1'),
    entry('oreslang-source.hdl',27,'a12245f3f1ce16bfe354b33f8ef806c5f43e733e','05b2a5899ca2b4f38ee27827a509dbfd1d19a3ef'),
  ]),
  Object.freeze([
    entry('oreslang-platform.asic',14,'45ff5c95408e878be5450d8136ec8d77cdbce88d','04eac14cf4c456d0b23a903a208febb8f13c4648'),
    entry('oreslang-platform.mobile',20,'1139bb36055d4719fde0d25f378b406b0e14869b','81ee60ab4aba9dc6b58c5b46709340848ca1a226'),
    entry('oreslang-platform.desktop',32,'28d36d6316a9f1b9ec721fd07fde317c72403224','cc12e421166700d65d4e3162fc1ea6095a7fa597'),
    entry('oreslang-platform-conformance',468,'2432ce4fc3d2c24bbe0d0247ea01f2f92ce0e064','bb62cdc864463446925202afa9ea9b40b74d16b7'),
    entry('oreslang-platform-conformance',482,'d10cfba86d14080bb484c453d6c38234c7d0badd','1235a720f63cce20038727880052fdf83139eb3f'),
  ])
]);
const paths = t => ({
  pr:\`/repos/\${t.repo}/pulls/\${t.number}\`,
  main:\`/repos/\${t.repo}/branches/main\`,
  compare:\`/repos/\${t.repo}/compare/\${t.merge}...main\`,
  review:\`/repos/\${t.repo}/pulls/\${t.number}/reviews?per_page=100&page=1\`,
  runs:\`/repos/\${t.repo}/actions/runs?head_sha=\${t.head}&per_page=100&page=1\`,
  protection:\`/repos/\${t.repo}/branches/main/protection\`,
});
export function validatePinnedWave(waves=WAVES) {
  if (!Array.isArray(waves) || waves.length!==2) throw Error('TWO_WAVES_REQUIRED');
  const seen=new Set(), repos=new Set();
  for(const wave of waves){
    if(!Array.isArray(wave) || wave.length!==5 || new Set(wave.map(t=>t.repo)).size<3)
      throw Error('WAVE_QUORUM');
    for(const t of wave){
      if(!t || !/^ores-truffle-oreslang\/[a-z0-9.-]+$/.test(t.repo) || !id(t.number) || !sha(t.head) || !sha(t.merge))
        throw Error('INVALID_TARGET');
      const key=\`\${t.repo}#\${t.number}\`;
      if(seen.has(key))throw Error('DUPLICATE_PR');
      seen.add(key);repos.add(t.repo);
    }
  }
  if(seen.size!==10 || repos.size!==9)throw Error('EXPECTED_TEN_PRS_NINE_REPOS');
  return true;
}
const recordBlock=(blocks,name)=>{if(!blocks.includes(name)) blocks.push(name);};
const independent=r=>r?.state==='APPROVED' && sha(r.commit_id) &&
  typeof r.user?.login==='string' && !['the1mills','oresoftware'].includes(r.user.login.toLowerCase());
const meaningful=s=>s && s.status==='completed' && s.conclusion==='success' && typeof s.name==='string' &&
  !/^(?:set up job|complete job|post\b|checkout|actions\/checkout|prepare all required actions|initialize containers|setup\b)/i.test(s.name.trim());
export function classifyJob(run,job,head) {
  if(!run || !job || run.head_sha!==head || !id(run.id) || !id(run.run_attempt) ||
    job.run_id!==run.id || job.run_attempt!==run.run_attempt ||
    (job.head_sha!==undefined && job.head_sha!==head))return 'IDENTITY_MISMATCH';
  if(!Array.isArray(job.steps))return 'STEPS_UNOBSERVED';
  if(!id(job.runner_id) || job.steps.length===0)return 'NOT_EXECUTED';
  if(run.status!=='completed' || run.conclusion!=='success' ||
     job.status!=='completed' || job.conclusion!=='success')return 'EXECUTED_NON_SUCCESS';
  if(!job.steps.some(meaningful))return 'SETUP_ONLY';
  return 'STEPFUL_UNCLASSIFIED'; // Not proof of guest, exact tree, or test assertions.
}
const policyGood=p=>!!p && p.required_pull_request_reviews?.required_approving_review_count>=1 &&
 p.required_pull_request_reviews?.require_code_owner_reviews===true &&
 p.required_pull_request_reviews?.dismiss_stale_reviews===true &&
 p.enforce_admins?.enabled===true && p.required_status_checks?.strict===true &&
 Array.isArray(p.required_status_checks.checks) && p.required_status_checks.checks.length>0 &&
 p.required_status_checks.checks.every(c=>typeof c.context==='string' && c.context.length>0 && id(c.app_id)) &&
 new Set(p.required_status_checks.checks.map(c=>c.context)).size===p.required_status_checks.checks.length &&
 ['users','teams','apps'].every(k=>Array.isArray(p.required_pull_request_reviews?.bypass_pull_request_allowances?.[k]) &&
   p.required_pull_request_reviews.bypass_pull_request_allowances[k].length===0) &&
 p.allow_force_pushes?.enabled===false && p.allow_deletions?.enabled===false;
async function safeRead(get,path,blocks,kind) {
  try {return await get(path);} catch {recordBlock(blocks,kind);return null;}
}
export async function inspectOne(get,t) {
  const blocks=[], p=paths(t);
  const pr=await safeRead(get,p.pr,blocks,'PR_UNREADABLE');
  if(!pr || pr.number!==t.number || pr.state!=='closed' || pr.merged!==true ||
     pr.head?.sha!==t.head || pr.merge_commit_sha!==t.merge || pr.base?.ref!=='main' ||
     pr.base?.repo?.full_name!==t.repo || pr.head?.repo?.full_name!==t.repo)
    recordBlock(blocks,'MERGE_IDENTITY_UNVERIFIED');
  const main=await safeRead(get,p.main,blocks,'MAIN_UNREADABLE');
  if(!main || !sha(main.commit?.sha))recordBlock(blocks,'MAIN_IDENTITY_UNVERIFIED');
  if(main?.protected!==true)recordBlock(blocks,'MAIN_NOT_PROTECTED');
  if(main?.protected===true){
    const policy=await safeRead(get,p.protection,blocks,'PROTECTION_UNREADABLE');
    if(!policyGood(policy))recordBlock(blocks,'PROTECTION_NOT_ENFORCED');
  }
  const compare=await safeRead(get,p.compare,blocks,'ANCESTRY_UNREADABLE');
  if(!compare || compare.merge_base_commit?.sha!==t.merge || compare.behind_by!==0 ||
     !['identical','ahead'].includes(compare.status) || !Number.isSafeInteger(compare.ahead_by) || compare.ahead_by<0 ||
     (compare.status==='identical' && compare.ahead_by!==0)) recordBlock(blocks,'LANDED_SHA_NOT_PROVEN_ON_MAIN');
  const reviews=await safeRead(get,p.review,blocks,'REVIEWS_UNREADABLE');
  if(!Array.isArray(reviews) || reviews.length>=100 ||
    !reviews.some(r=>independent(r) && r.commit_id===t.head && r.user.login.toLowerCase()!==pr?.user?.login?.toLowerCase()))
    recordBlock(blocks,'INDEPENDENT_HEAD_REVIEW_UNVERIFIED');
  const runPage=await safeRead(get,p.runs,blocks,'RUNS_UNREADABLE');
  let ci='NOT_EXECUTED';
  if(!Array.isArray(runPage?.workflow_runs) || runPage.workflow_runs.length>20 ||
    runPage.total_count!==undefined && runPage.total_count>runPage.workflow_runs?.length) {
    recordBlock(blocks,'RUN_COVERAGE_UNVERIFIED');
  } else {
    for(const run of runPage.workflow_runs){
      if(run.head_sha!==t.head || !id(run.id) || !id(run.run_attempt) || run.event!=='pull_request')continue;
      const page=await safeRead(get,\`/repos/\${t.repo}/actions/runs/\${run.id}/attempts/\${run.run_attempt}/jobs?per_page=100&page=1\`,blocks,'JOBS_UNREADABLE');
      if(!Array.isArray(page?.jobs) || page.jobs.length>=100 ||
        page.total_count!==undefined && page.total_count>page.jobs?.length){recordBlock(blocks,'JOB_COVERAGE_UNVERIFIED');continue;}
      for(const job of page.jobs){
        const state=classifyJob(run,job,t.head);
        if(state==='STEPFUL_UNCLASSIFIED')ci='STEPFUL_UNCLASSIFIED';
        else if(ci!=='STEPFUL_UNCLASSIFIED' && state!=='NOT_EXECUTED')ci=state;
      }
    }
  }
  if(ci!=='STEPFUL_UNCLASSIFIED')recordBlock(blocks,'EXACT_HEAD_CI_NOT_EXECUTED_OR_UNPROVEN');
  // Even a positive stepful run alone proves neither complete tests nor guest parity.
  recordBlock(blocks,'POSTMERGE_RELEASE_ATTESTATION_REQUIRED');
  return {repo:t.repo,pr:t.number,pinned_head:t.head,pinned_merge:t.merge,
    observed_main:main?.commit?.sha??null,ci_state:ci,blockers:blocks.sort()};
}
export async function auditLive(get,waves=WAVES) {
  validatePinnedWave(waves);
  if(typeof get!=='function')throw Error('GET_REQUIRED');
  const entries=[];
  for(const [w,wave] of waves.entries())
    for(const t of wave)entries.push({wave:w+1,...await inspectOne(get,t)});
  return {schema_version:1,scope:'read_only_postmerge_intake',status:'BLOCKED',
    merge_authorized:false,release_authorized:false,guest_parity_certified:false,
    waves:2,pr_count:entries.length,repo_count:new Set(entries.map(t=>t.repo)).size,entries};
}
