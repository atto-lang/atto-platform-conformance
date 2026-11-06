// Read-only evaluation of a complete review history. This is NOT live GitHub authorization.
const SHA = /^[0-9a-f]{40}$/;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const COMPLETED = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
const OPERATORS = new Set(['the1mills', 'oresoftware']);
const OPERATOR_IDS = new Set([2148448, 11139560]);
const MAX_REVIEWS = 1000;
const MAX_ELIGIBLE_REVIEWERS = 64;
const ATTO_REPO = /^ores-truffle-oreslang\/(?:oreslang-source\.(?:java|llvm|wasm|net|forge)|oreslang-platform\.(?:mobile|iot|embedded|desktop|fpga|asic)|oreslang-platform-conformance)$/;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 30_000;

const positiveId = id => Number.isSafeInteger(id) && id > 0;
// Never allow RegExp.test to coerce a caller-controlled object into a repository or Git ID.
const validSha = value => typeof value === 'string' && SHA.test(value);
// Date.parse normalizes impossible calendar dates (e.g. Feb 30 -> Mar 2).
// Validate actual calendar fields and timezone offsets before comparing timestamps.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;
const iso = value => {
  if (typeof value !== 'string') return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const year=Number(m[1]), month=Number(m[2]), day=Number(m[3]);
  const hour=Number(m[4]), minute=Number(m[5]), second=Number(m[6]);
  const leap=(year%4===0 && (year%100!==0 || year%400===0));
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (month<1 || month>12 || day<1 || day>days[month-1] ||
      hour>23 || minute>59 || second>59) return false;
  if (m[8]!=='Z' && (Number(m[9])>23 || Number(m[10])>59)) return false;
  return Number.isFinite(Date.parse(value));
};

export function snapshotFreshness(asOf, now = Date.now()) {
  if (!iso(asOf) || !Number.isSafeInteger(now) || now < 0) {
    return {ok: false, reason: 'SNAPSHOT_TIME_INVALID'};
  }
  const age = now - Date.parse(asOf);
  if (age > MAX_SNAPSHOT_AGE_MS) return {ok: false, reason: 'SNAPSHOT_STALE'};
  if (age < -FUTURE_SKEW_MS) return {ok: false, reason: 'SNAPSHOT_FROM_FUTURE'};
  return {ok: true, reason: 'SNAPSHOT_RECENT'};
}

// Structural policy readback binding only. It cannot authenticate caller-supplied data.
// Require a live, independently verified branch-protection/CODEOWNERS readback upstream.
function boundReviewerPolicy(input) {
  const p = input.reviewer_policy;
  if (!p || typeof p !== 'object' || Array.isArray(p) ||
      (typeof input.repo !== 'string' || !ATTO_REPO.test(input.repo)) ||
      !validSha(input.base_sha) ||
      p.repo !== input.repo || p.base_sha !== input.base_sha ||
      p.base_ref !== 'main' || p.protection_readable !== true ||
      p.protected !== true || p.require_codeowners !== true ||
      p.dismiss_stale_reviews !== true || p.bypass_count !== 0 ||
      !Number.isSafeInteger(p.required_approvals) ||
      p.required_approvals < 1 || p.required_approvals > 6 ||
      !Array.isArray(p.eligible_reviewer_ids) ||
      p.eligible_reviewer_ids.length < p.required_approvals ||
      p.eligible_reviewer_ids.length > MAX_ELIGIBLE_REVIEWERS) return null;
  const eligible = new Set(p.eligible_reviewer_ids);
  if (eligible.size !== p.eligible_reviewer_ids.length ||
      p.eligible_reviewer_ids.some(id => !positiveId(id) ||
        id === input.author_id || OPERATOR_IDS.has(id))) return null;
  return {required_approvals:p.required_approvals,eligible};
}

// Input is deliberately identity-based, never only a username:
// { head_sha, author, author_id, as_of, reviews_complete, reviews: [{id, login,
//   reviewer_id, state, commit_sha, submitted_at}] }.
// Caller-supplied completeness and timestamps are advisory until verified by a live adapter.
export function qualifyReviewTimeline(input, {now = Date.now()} = {}) {
  const problems = new Set();
  const fail = code => problems.add(code);
  const result = () => ({
    status: problems.size ? 'BLOCKED' : 'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK',
    blockers: [...problems].sort(),
    note: 'Advisory snapshot only. Refresh GitHub reviewer identities, complete paginated review history, branch protection and exact head before merging.'
  });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('REVIEW_INPUT_INVALID'); return result();
  }
  const freshness = snapshotFreshness(input.as_of, now);
  if (!freshness.ok) fail(freshness.reason);
  if (!validSha(input.head_sha) || typeof input.author !== 'string' ||
    !LOGIN.test(input.author) || !positiveId(input.author_id)) fail('REVIEW_IDENTITY_INVALID');
  if (input.reviews_complete !== true) fail('REVIEW_HISTORY_INCOMPLETE');
  const policy = boundReviewerPolicy(input);
  if (!policy) fail('REVIEW_POLICY_INVALID');
  if (!Number.isSafeInteger(input.review_count) || input.review_count <= 0 ||
      !Array.isArray(input.reviews) || input.review_count !== input.reviews.length) {
    fail('REVIEW_HISTORY_INCOMPLETE');
  }
  if (!Array.isArray(input.reviews) || input.reviews.length > MAX_REVIEWS || input.reviews.length === 0) {
    fail('REVIEW_HISTORY_INVALID'); return result();
  }
  const ids = new Set();
  const identities = new Map();
  const loginIds = new Map();
  const latest = new Map();
  const seenReviewerTimes = new Set();
  for (const r of input.reviews) {
    const login = typeof r?.login === 'string' ? r.login.toLowerCase() : '';
    if (!positiveId(r?.id) || ids.has(r.id) || !positiveId(r.reviewer_id) ||
      !LOGIN.test(login) || !COMPLETED.has(r.state) ||
      !validSha(r.commit_sha) || !iso(r.submitted_at)) {
      fail('REVIEW_RECORD_INVALID'); continue;
    }
    ids.add(r.id);
    const time = Date.parse(r.submitted_at);
    if (Number.isFinite(Date.parse(input.as_of)) && time > Date.parse(input.as_of)) {
      fail('REVIEW_AFTER_SNAPSHOT'); continue;
    }
    if ((identities.has(r.reviewer_id) && identities.get(r.reviewer_id) !== login) ||
        (loginIds.has(login) && loginIds.get(login) !== r.reviewer_id)) {
      fail('REVIEW_IDENTITY_CONFLICT'); continue;
    }
    identities.set(r.reviewer_id, login);
    loginIds.set(login, r.reviewer_id);
    // Enforce unique timestamps across ALL reviews by one identity, not just
    // adjacent records or the current latest event. Input order is untrusted.
    const timestampKey = `${r.reviewer_id}:${time}`;
    if (seenReviewerTimes.has(timestampKey)) {
      fail('REVIEW_ORDER_AMBIGUOUS'); continue;
    }
    seenReviewerTimes.add(timestampKey);
    const prior = latest.get(r.reviewer_id);
    if (!prior || time > prior.time) latest.set(r.reviewer_id, { ...r, login, time });
  }
  if ([...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) {
    fail('REVIEW_CHANGES_REQUESTED');
  }
  const authorLogin = typeof input.author === 'string' ? input.author.toLowerCase() : '';
  const approved = new Set([...latest.values()].filter(r => r.state === 'APPROVED' &&
    r.commit_sha === input.head_sha && r.reviewer_id !== input.author_id &&
    r.login !== authorLogin && !OPERATORS.has(r.login) &&
    !OPERATOR_IDS.has(r.reviewer_id) && policy?.eligible.has(r.reviewer_id))
    .map(r => r.reviewer_id));
  if (!policy || approved.size < policy.required_approvals) {
    fail('REVIEW_INDEPENDENT_APPROVAL_MISSING');
  }
  return result();
}
