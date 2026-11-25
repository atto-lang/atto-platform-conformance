# PR blocker ledger V1 — separate engineering proposal

This is **not** the active four-hour read-only WATCH. No watch automation, GitHub workflows,
branch protections, reviews or source-export permissions are changed by this proposal.
The library calls no GitHub write APIs, triggers no CI runs, and never transfers private source.

## Input adapter contract

- Repository enumeration: a read-only authenticated adapter returns
  an object with items (full owner/repository names) and complete=true only if ALL
  accessible repository pages were read. Missing permissions and rate limits must
  be surfaced as gaps, never an empty successful result.
- Per-repository, per-UTC-day search: a searchPage callback accepts
  (repo, day, page, perPage, sort, order) and returns items, totalCount,
  and optionally incompleteResults. The library pages in order, deduplicates
  by repository and PR number, and explicitly records unknown counts and
  GitHub's 1,000-result search ceiling. A day at that ceiling requires a
  subsequent time-window subdivision using supported API semantics, or
  remains INCOMPLETE. Never extrapolate completeness from one truncated query.
- Current SHA: a readHead callback must use canonical GitHub PR metadata and
  return head_sha and state=open. Search metadata is not itself exact-head proof.
- CI: listRuns, listJobs and listSteps are read-only callbacks; each must paginate
  independently and mark complete=true only after all relevant pages/attempts.
  A connector returning only the first page is NOT exhaustive. Every returned
  job receives its own listSteps call. Missing/null steps are UNOBSERVED;
  failed, completed, explicit [] steps are OBSERVED_NO_STEP_FAILURE.
  Executed failure/pass needs completed named execution steps matched to a
  separately reviewed trustedStepNames manifest and a real assigned runner.
  Step display names alone are not signed compiler/guest evidence.
  Successful host execution does not prove five-backend guest execution.
- Blocker alerts: alertDelta fingerprints the root cause, scope and impact,
  not the head SHA. Material status or severity changes remain alertable.
- Persistence: persistSnapshot is an explicit opt-in local JSON snapshot writer,
  using restrictive permissions and a temporary-file rename; it never writes
  to GitHub or external storage. An authorized orchestrator must persist and
  load its prior state for scheduled incremental operation.

## Source-transfer invariant

The current source-export prohibition stays in effect. Conformance security
incidents #22, #77 and #127 require independent incident resolution. Destination
identity, private visibility, permissions and retention need verifiable evidence,
as does an independently reviewed MERGED PROTECTED destination-specific source
policy and exact source/destination binding. Source-free canaries cannot certify
compiler runs or authorize source mirroring.

The pure exportCandidateGate function is an advisory prerequisites checker,
NOT authorization to export: caller-provided booleans are not trusted proof.
There is intentionally no export operation. The TLA+ abstraction in
formal/private-source-transfer-v1.tla states an invariant about exported
states; it has NOT been model-checked and is NOT implementation refinement proof.

## Integration and release boundaries

The library is a testable kernel, not a deployed, exhaustive scheduled poller.
Remaining engineering tasks: authenticated installation-scoped repository
pagination; read-only GitHub REST adapters with retry/rate-limit accounting;
timestamp subdivision of saturated per-day partitions; full workflow run
attempt/job pagination; branch/ruleset policy reads where authorized; an
independently validated guest receipt verifier; a durable operational
store; and independent security approval. Do not connect it to the existing
four-hour watch until these gates have been reviewed.

Local Node >=22 test command:
    node --test tests/pr-blocker-ledger-v1.test.mjs

The test file contains mock-provider classification, pagination, deduplication,
local persistence, and fail-closed policy cases. No executed exact-head GitHub
Actions, compiled AttoLang guest, TLC or Apalache proof is claimed by this PR.
Keep this integration DRAFT pending stepful execution and independent review.
