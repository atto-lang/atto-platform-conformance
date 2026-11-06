// Read-only evaluation of a complete review history. This is NOT live GitHub authorization.
const SHA = /^[0-9a-f]{40}$/;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const COMPLETED = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
const OPERATORS = new Set(['the1mills', 'oresoftware']);
const OPERATOR_IDS = new Set([2148448, 11139560]);
const MAX_REVIEWS = 1000;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 30_000;

const positiveId = id => Number.isSafeInteger(id) && id > 0;
const iso = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function snapshotFreshness(asOf, now = Date.now()) {
  if (!iso(asOf) || !Number.isSafeInteger(now) || now < 0) {
    return {ok: false, reason: 'SNAPSHOT_TIME_INVALID'};
  }
  const age = now - Date.parse(asOf);
  if (age > MAX_SNAPSHOT_AGE_MS) return {ok: false, reason: 'SNAPSHOT_STALE'};
  if (age < -FUTURE_SKEW_MS) return {ok: false, reason: 'SNAPSHOT_FROM_FUTURE'};
  return {ok: true, reason: 'SNAPSHOT_RECENT'};
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
  if (!SHA.test(input.head_sha || '') || typeof input.author !== 'string' ||
    !LOGIN.test(input.author) || !positiveId(input.author_id)) fail('REVIEW_IDENTITY_INVALID');
  if (input.reviews_complete !== true) fail('REVIEW_HISTORY_INCOMPLETE');
  if (!Array.isArray(input.reviews) || input.reviews.length > MAX_REVIEWS || input.reviews.length === 0) {
    fail('REVIEW_HISTORY_INVALID'); return result();
  }
  const ids = new Set();
  const identities = new Map();
  const loginIds = new Map();
  const latest = new Map();
  for (const r of input.reviews) {
    const login = typeof r?.login === 'string' ? r.login.toLowerCase() : '';
    if (!positiveId(r?.id) || ids.has(r.id) || !positiveId(r.reviewer_id) ||
      !LOGIN.test(login) || !COMPLETED.has(r.state) ||
      !SHA.test(r.commit_sha || '') || !iso(r.submitted_at)) {
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
    const prior = latest.get(r.reviewer_id);
    if (prior && prior.time === time) {
      fail('REVIEW_ORDER_AMBIGUOUS'); continue;
    }
    if (!prior || time > prior.time) latest.set(r.reviewer_id, { ...r, login, time });
  }
  if ([...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) {
    fail('REVIEW_CHANGES_REQUESTED');
  }
  const authorLogin = typeof input.author === 'string' ? input.author.toLowerCase() : '';
  const approved = [...latest.values()].some(r => r.state === 'APPROVED' &&
    r.commit_sha === input.head_sha &&
    r.reviewer_id !== input.author_id && r.login !== authorLogin &&
    !OPERATORS.has(r.login) && !OPERATOR_IDS.has(r.reviewer_id));
  if (!approved) fail('REVIEW_INDEPENDENT_APPROVAL_MISSING');
  return result();
}
