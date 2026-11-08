// Advisory policy verification; no mutation/merge endpoints and no release authority.
const validSHA = x => typeof x === 'string' && /^[a-f0-9]{40}$/i.test(x);
const named = x => typeof x === 'string' && x.trim().length > 0;
const supported = new Set(['pull_request','required_status_checks','non_fast_forward','deletion','creation','update']);
const unique = x => [...new Set(x)];

export function assessGovernance({repository,head,pr,branch, reviews,protection,rules,checkRuns,
  trustedReviewers=['ORESoftware','the1mills']}={}) {
  const blockers=[], fail=x=>{if(!blockers.includes(x))blockers.push(x)};
  if (!named(repository)||!validSHA(head)||pr?.head?.sha!==head||pr?.base?.ref!=='main')
    fail('POLICY_PR_IDENTITY_MISMATCH');
  if (!branch||typeof branch!=='object'||Array.isArray(branch)||branch?.name!=='main')
    fail('MAIN_BRANCH_METADATA_UNVERIFIED');
  if (branch?.protected!==true)fail('MAIN_NOT_PROTECTED');
  if (branch?.commit?.sha!==pr?.base?.sha || !validSHA(branch?.commit?.sha))
    fail('MAIN_BASE_SHA_CHANGED');
  if (!protection||typeof protection!=='object'||Array.isArray(protection))
    fail('BRANCH_PROTECTION_UNVERIFIED');
  if (!Array.isArray(rules))fail('EFFECTIVE_RULES_UNVERIFIED');
  if (!Array.isArray(checkRuns))fail('CHECK_RUNS_UNVERIFIED');
  if (!Array.isArray(reviews))fail('REVIEWS_UNVERIFIED');
  if (protection?.enforce_admins?.enabled!==true)fail('ADMIN_ENFORCEMENT_UNVERIFIED');
  if (!Array.isArray(trustedReviewers)||!trustedReviewers.length||trustedReviewers.some(x=>!named(x)))
    fail('TRUSTED_REVIEWERS_UNVERIFIED');
  const approvedRules=[],requiredChecks=[];
  if(protection?.required_pull_request_reviews){
    const p=protection.required_pull_request_reviews;
    approvedRules.push({count:p.required_approving_review_count,codeowners:p.require_code_owner_reviews,
      lastPush:p.require_last_push_approval,threads:protection?.required_conversation_resolution?.enabled});
    const bypass=p.bypass_pull_request_allowances;
    if(bypass&&Object.values(bypass).some(x=>Array.isArray(x)&&x.length>0))fail('REVIEW_BYPASS_ACTORS_PRESENT');
  }
  const classic=protection?.required_status_checks;
  if(classic){
    if(Array.isArray(classic.checks)&&classic.checks.length)
      for(const x of classic.checks)requiredChecks.push({context:x?.context,appId:x?.app_id});
    else for(const context of Array.isArray(classic.contexts)?classic.contexts:[])
      requiredChecks.push({context});
  }
  for(const rule of Array.isArray(rules)?rules:[]){
    if(!supported.has(rule?.type)){
      fail(rule?.type==='merge_queue'?'MERGE_QUEUE_REQUIRED':'UNKNOWN_RESTRICTIVE_RULE');
      continue;
    }
    if(rule.type==='pull_request'){
      const p=rule.parameters;
      approvedRules.push({count:p?.required_approving_review_count,codeowners:p?.require_code_owner_review,
        lastPush:p?.require_last_push_approval,threads:p?.required_review_thread_resolution,
        requiredTeams:p?.required_reviewers});
    }
    if(rule.type==='required_status_checks'){
      if(!Array.isArray(rule.parameters?.required_status_checks))fail('MALFORMED_RULESET_CHECKS');
      for(const x of Array.isArray(rule.parameters?.required_status_checks)?rule.parameters.required_status_checks:[])
        requiredChecks.push({context:x?.context,appId:x?.integration_id});
    }
  }
  const counts=approvedRules.map(x=>x.count);
  if(!counts.length||counts.some(x=>!Number.isInteger(x)||x<1))fail('NO_VALID_REVIEW_COUNT_RULE');
  if(approvedRules.some(x=>x.codeowners===true))fail('CODEOWNER_REVIEW_UNVERIFIED');
  if(approvedRules.some(x=>x.lastPush===true))fail('LAST_PUSH_APPROVAL_UNVERIFIED');
  if(approvedRules.some(x=>x.threads===true))fail('REVIEW_THREADS_UNVERIFIED');
  if(approvedRules.some(x=>Array.isArray(x.requiredTeams)&&x.requiredTeams.length))
    fail('REQUIRED_TEAM_REVIEW_UNVERIFIED');
  const author=typeof pr?.user?.login==='string'?pr.user.login.toLowerCase():'';
  const trusted=new Set(Array.isArray(trustedReviewers)?trustedReviewers.map(x=>typeof x==='string'?x.toLowerCase():'') :[]);
  const latest=new Map();
  for(const r of Array.isArray(reviews)?reviews:[]){
    if(r?.state==='PENDING'&&r.submitted_at==null)continue;
    const who=typeof r?.user?.login==='string'?r.user.login.toLowerCase():'';
    const rawTime=r?.submitted_at;
    const timestamp=typeof rawTime==='string'&&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawTime)
      ? Date.parse(rawTime) : NaN;
    const canonical=Number.isFinite(timestamp)?new Date(timestamp).toISOString():'';
    if(!who||!Number.isFinite(timestamp)||canonical.slice(0,19)!==rawTime?.slice(0,19)){
      fail('INVALID_REVIEW_TIMELINE');continue;
    }
    const previous=latest.get(who);
    if(!previous||timestamp>previous.time)latest.set(who,{time:timestamp,reviews:[r]});
    else if(timestamp===previous.time)previous.reviews.push(r);
  }
  let validApprovals=0;
  for(const [who,s] of latest){
    const states=new Set(s.reviews.map(x=>x.state));
    const commits=new Set(s.reviews.map(x=>x.commit_id));
    if(states.size!==1||(states.has('APPROVED')&&commits.size!==1))fail('AMBIGUOUS_REVIEW_TIMELINE');
    if(states.has('CHANGES_REQUESTED'))fail('ACTIVE_CHANGES_REQUESTED');
    if(!states.has('APPROVED'))continue;
    if(s.reviews.some(x=>x.dismissed_at!=null)){fail('DISMISSED_APPROVAL');continue;}
    if(who!==author&&trusted.has(who)&&commits.has(head))validApprovals++;
  }
  const quorum=Math.max(1,...counts.filter(Number.isInteger));
  if(!author||validApprovals<quorum)fail('APPROVAL_QUORUM_NOT_MET');
  if(!requiredChecks.length)fail('NO_REQUIRED_CHECKS');
  const seen=new Set();
  for(const req of requiredChecks){
    if(!named(req.context)||seen.has(req.context)){fail('MALFORMED_OR_DUPLICATE_CHECK_RULE');continue;}
    seen.add(req.context);
    const matches=(Array.isArray(checkRuns)?checkRuns:[]).filter(c=>c?.name===req.context);
    if(matches.length!==1){fail('REQUIRED_CHECK_AMBIGUOUS_OR_MISSING');continue;}
    const c=matches[0];
    if(c.head_sha!==head||c.status!=='completed'||c.conclusion!=='success')
      fail('REQUIRED_CHECK_NOT_SUCCESSFUL_ON_HEAD');
    if(req.appId!=null&&c.app?.id!==req.appId)fail('REQUIRED_CHECK_WRONG_APP');
    if(req.appId==null&&c.app?.slug!=='github-actions')fail('REQUIRED_CHECK_SOURCE_UNVERIFIED');
  }
  return {advisoryOnly:true,mergeAuthorized:false,readyForHumanGovernanceReview:blockers.length===0,
    repository,head,validApprovals,requiredApprovals:quorum,blockers};
}

export function governanceFingerprint({protection,rules,checkRuns}={}) {
  if(!protection||!Array.isArray(rules)||!Array.isArray(checkRuns))
    throw Error('Incomplete branch governance evidence');
  const ordered=list=>list.map(x=>JSON.stringify(x)).sort();
  return JSON.stringify({protection,rules:ordered(rules),
    checks:ordered(checkRuns.map(c=>({id:c?.id,name:c?.name,head_sha:c?.head_sha,
      status:c?.status,conclusion:c?.conclusion,app:c?.app,completed_at:c?.completed_at})))});
}
