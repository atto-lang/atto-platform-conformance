// Advisory, read-only integration adapter. Existing gates are injected, never duplicated.
// A qualified snapshot is NOT authenticated authorization to merge or export private source.
const REPO = /^ores-truffle-oreslang\/(?:oreslang-source\.(?:java|llvm|net|wasm|forge|cranelift|js|rs|hdl)|oreslang-platform\.(?:mobile|iot|embedded|desktop|asic|fpga)|oreslang-platform-conformance)$/;
const SHA = /^[a-f0-9]{40}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const maxSteps = 128;
const required = ['collectLiveEvidence','readPages','qualifyReviewTimeline','collectExactHeadEvidence','qualifyCandidate'];
const issue = (category, reason) => ({category, reason});
const safeTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const identity = pr => ({
  head:pr?.head?.sha, base:pr?.base?.sha, state:pr?.state,
  draft:pr?.draft, mergeable:pr?.mergeable, baseRef:pr?.base?.ref,
  headRepo:pr?.head?.repo?.full_name, baseRepo:pr?.base?.repo?.full_name,
  author:pr?.user?.login, authorId:pr?.user?.id
});
const sameIdentity = (a,b) => Object.keys(a).every(k => a[k] === b[k]);
const result = (target, at, gaps, gates, facts) => ({
  schema_version:1, target, observed_at:at, status:'BLOCKED',
  merge_authorized:false, compiler_guest_certified:false,
  gates, facts, blockers:[...new Set(gaps)].sort(),
  note:'Read-only composition of advisory snapshots. No private source transfer, approval, or merge authorization.'
});

export function bindMergeWaveGates(deps) {
  if (!deps || typeof deps !== 'object' || required.some(k => typeof deps[k] !== 'function')) {
    throw new TypeError('all five versioned read-only gate functions required');
  }
  const {collectLiveEvidence,readPages,qualifyReviewTimeline,collectExactHeadEvidence,qualifyCandidate} = deps;
  async function auditPR({repo,number,get,readReviewerPolicy,scope='compiler',trustedStepNames=[],now=()=>new Date().toISOString()}={}) {
    if (typeof repo !== 'string' || !REPO.test(repo) || !positive(number) || number > 1_000_000 ||
      typeof get !== 'function' || typeof now !== 'function' ||
      !['compiler','source_free'].includes(scope) || !Array.isArray(trustedStepNames) ||
      trustedStepNames.length > 30 || trustedStepNames.some(x => typeof x !== 'string' || !x.trim() || x.length > 160)) {
      throw new TypeError('invalid read-only PR evidence target');
    }
    const target={repo,number}, at=safeTime(now()) ?? 'UNKNOWN', gaps=[], gates={}, facts={};
    if (at==='UNKNOWN') gaps.push('SNAPSHOT_TIME_UNOBSERVED');
    const path=`/repos/${repo}`;
    async function read(api, reason) {
      try { return await get(api); }
      catch { gaps.push(reason); return null; }
    }
    const first=await read(`${path}/pulls/${number}`,'INITIAL_PR_UNOBSERVED');
    const pinned=identity(first);
    if (!first || !SHA.test(pinned.head??'') || !SHA.test(pinned.base??'') ||
        pinned.state!=='open' || pinned.draft!==false || pinned.mergeable!==true ||
        pinned.baseRef!=='main' || pinned.headRepo!==repo || pinned.baseRepo!==repo ||
        !positive(pinned.authorId) || typeof pinned.author!=='string') {
      gaps.push('PR_METADATA_OR_PIN_UNVERIFIED');
    }
    let live;
    try { live=await collectLiveEvidence({repo,number,get,now}); }
    catch { gaps.push('LIVE_COLLECTOR_FAILED'); }
    gates.live={status:live?.status??'UNOBSERVED',blocked:live?.merge_authorized!==false};
    if (!live || live.status!=='BLOCKED' || live.merge_authorized!==false ||
        live.compiler_guest_certified===true || live.guest_certified!==false ||
        live.target?.head_sha!==pinned.head || live.target?.base_sha!==pinned.base) {
      gaps.push('LIVE_COLLECTOR_IDENTITY_OR_CONTRACT_MISMATCH');
    }
    for (const g of Array.isArray(live?.gaps)?live.gaps:[]) gaps.push(`LIVE:${String(g).slice(0,160)}`);
    // New reads are deliberately NOT served from an earlier PR snapshot cache.
    let reviewed={items:[],complete:false,gaps:['HEAD_UNVERIFIED']};
    if (SHA.test(pinned.head??'')) {
      try { reviewed=await readPages(get,`${path}/pulls/${number}/reviews`); }
      catch { gaps.push('REVIEW_PAGINATION_FAILED'); }
    }
    if (!reviewed.complete || !Array.isArray(reviewed.items)) gaps.push('REVIEW_HISTORY_INCOMPLETE');
    const reviews=(Array.isArray(reviewed.items)?reviewed.items:[]).map(r=>({
      id:r?.id,reviewer_id:r?.user?.id,login:r?.user?.login,
      state:r?.state,commit_sha:r?.commit_id,submitted_at:r?.submitted_at
    }));
    let reviewerPolicy=null;
    if (typeof readReviewerPolicy==='function' && SHA.test(pinned.base??'')) {
      try { reviewerPolicy=await readReviewerPolicy({repo,base_sha:pinned.base,head_sha:pinned.head,get}); }
      catch { gaps.push('REVIEW_POLICY_PROVIDER_FAILED'); }
    }
    if (!reviewerPolicy || reviewerPolicy.repo!==repo || reviewerPolicy.base_sha!==pinned.base)
      gaps.push('REVIEWER_ROSTER_OR_POLICY_UNVERIFIED');
    // The provider is not itself an authentication certificate; independence
    // requires separate authorized verification even for a structurally good roster.
    gaps.push('REVIEWER_ROSTER_PROVENANCE_REQUIRES_INDEPENDENT_VERIFICATION');
    try {
      const v=qualifyReviewTimeline({repo,base_sha:pinned.base,head_sha:pinned.head,
        author:pinned.author,author_id:pinned.authorId,as_of:at,review_count:reviews.length,
        reviews_complete:reviewed.complete===true,reviewer_policy:reviewerPolicy,reviews},
        {now:Date.parse(at)});
      gates.review={status:v?.status??'UNOBSERVED',blockers:v?.blockers??['REVIEW_GATE_NO_RESULT']};
      for(const g of gates.review.blockers) gaps.push(`REVIEW:${String(g).slice(0,160)}`);
      if (v?.status!=='REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK') gaps.push('REVIEW_GATE_BLOCKED');
    } catch { gaps.push('REVIEW_GATE_FAILED'); gates.review={status:'UNOBSERVED'}; }
    const ledgerPayload={repo,head:pinned.head,
      listRuns:async (r,h) => {
        if (r!==repo || h!==pinned.head) throw Error('run adapter identity mismatch');
        const pg=await readPages(get,`${path}/actions/runs?head_sha=${h}`,'workflow_runs');
        return {items:pg.items??[],complete:pg.complete===true};
      },
      listJobs:async (r,runId,attempt) => {
        if (r!==repo || !positive(runId) || !positive(attempt)) throw Error('job adapter identity mismatch');
        const pg=await readPages(get,`${path}/actions/runs/${runId}/attempts/${attempt}/jobs`,'jobs');
        return {items:pg.items??[],complete:pg.complete===true};
      },
      listSteps:async (r,jobId) => {
        if (r!==repo || !positive(jobId)) throw Error('step adapter identity mismatch');
        const job=await get(`${path}/actions/jobs/${jobId}`);
        if (!Array.isArray(job?.steps) || job.steps.length>maxSteps || job.id!==jobId) return {steps:null};
        return {steps:job.steps};
      },
      trustedStepNames
    };
    try {
      const v=await collectExactHeadEvidence(ledgerPayload);
      gates.ledger={complete:v?.complete===true,states:Array.isArray(v?.records)?v.records.map(x=>x.state):[],
        gaps:Array.isArray(v?.gaps)?v.gaps:[]};
      if (!gates.ledger.complete) gaps.push('LEDGER_INVENTORY_INCOMPLETE');
      for(const g of gates.ledger.gaps) gaps.push(`LEDGER:${String(g?.kind??'UNKNOWN').slice(0,100)}`);
      if(!gates.ledger.states.length || gates.ledger.states.some(s=>s!=='EXECUTED_PASS')) gaps.push('LEDGER_EXECUTION_NOT_PROVEN');
    } catch { gaps.push('LEDGER_GATE_FAILED'); gates.ledger={complete:false,states:[],gaps:[]}; }
    const protection=await read(`${path}/branches/main/protection`,'PROTECTION_API_UNREADABLE');
    const rule=protection?.required_pull_request_reviews;
    const statusRule=protection?.required_status_checks;
    const sourceProtection={
      protected:live?.protection?.branch_protected===true && !!protection,
      require_pull_request:!!rule,require_codeowners:rule?.require_code_owner_reviews===true,
      dismiss_stale_reviews:rule?.dismiss_stale_reviews===true,
      strict_checks:statusRule?.strict===true,enforce_admins:protection?.enforce_admins?.enabled===true,
      bypass_count:(()=>{const allowance=rule?.bypass_pull_request_allowances;
        if(!allowance || !['users','teams','apps'].every(k=>Array.isArray(allowance[k]))) return -1;
        return allowance.users.length+allowance.teams.length+allowance.apps.length;})()
    };
    const candidate={repo,number,head_sha:pinned.head,head_tree_sha:live?.target?.tree_sha,
      base_sha:pinned.base,base_ref:pinned.baseRef,draft:pinned.draft,mergeable:pinned.mergeable,
      state:pinned.state,author:pinned.author,protection:sourceProtection,
      reviews:reviews.map(r=>({login:r.login,state:r.state,commit_sha:r.commit_sha})),
      required_checks:(Array.isArray(statusRule?.checks)?statusRule.checks:[]).map(x=>({context:x.context,app_id:x.app_id})),
      checks:[], scope,test_receipts:[],lease:{expires_at:'UNVERIFIED'} // unknown lease is deliberately blocking
    };
    try {
      const v=qualifyCandidate(candidate,Date.parse(at));
      gates.qualifier={status:Array.isArray(v)&&!v.length?'SNAPSHOT_QUALIFIED':'BLOCKED',
        blockers:Array.isArray(v)?v:[{kind:'checks',reason:'UNOBSERVED'}]};
      if (!Array.isArray(v) || !v.length) gaps.push('QUALIFIER_UNEXPECTEDLY_FAVORABLE_WITHOUT_RECEIPTS');
      for(const g of gates.qualifier.blockers) gaps.push(`QUALIFIER:${String(g?.reason??'UNKNOWN').slice(0,100)}`);
    } catch { gaps.push('QUALIFIER_GATE_FAILED'); gates.qualifier={status:'UNOBSERVED'}; }
    const final=await read(`${path}/pulls/${number}`,'FINAL_PR_UNOBSERVED');
    if (!sameIdentity(pinned,identity(final)) || !SHA.test(pinned.head??'')) gaps.push('PR_IDENTITY_CHANGED_DURING_COMPOSITION');
    facts.head_sha=SHA.test(pinned.head??'')?pinned.head:null;
    facts.base_sha=SHA.test(pinned.base??'')?pinned.base:null;
    facts.tree_sha=SHA.test(live?.target?.tree_sha??'')?live.target.tree_sha:null;
    facts.review_count=reviews.length;
    facts.compiler_receipts_verified=false;
    facts.agent_lease_verified=false;
    gaps.push('TEST_RECEIPTS_AND_AGENT_LEASE_NOT_VERIFIED');
    return result(target,at,gaps,gates,facts);
  }
  async function auditWave({targets,get,readReviewerPolicy,scope='compiler',trustedStepNames=[],now}={}) {
    if (!Array.isArray(targets) || targets.length!==5 || typeof get!=='function' ||
      targets.some(t=>!t || typeof t.repo!=='string' || !REPO.test(t.repo) || !positive(t.number) || t.number>1_000_000) ||
      new Set(targets.map(t=>`${t.repo}#${t.number}`)).size!==5 ||
      new Set(targets.map(t=>t.repo)).size<3) throw new TypeError('wave contract: five unique PRs across three repos');
    const items=[];
    for(const target of targets) items.push(await auditPR({...target,get,readReviewerPolicy,scope,trustedStepNames,now}));
    return {schema_version:1,status:'BLOCKED',merge_authorized:false,compiler_guest_certified:false,
      count:items.length,distinct_repos:new Set(targets.map(t=>t.repo)).size,items,
      note:'Advisory, read-only composition only; needs independently authenticated policy/CI/negative receipts and live merge fencing.'};
  }
  return Object.freeze({auditPR,auditWave});
}
