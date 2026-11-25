# LLVM + conformance private-CI incident reconciliation (2026-11-14)

**NON-AUTHORIZING / HOLD.** Metadata-only independent-review packet. It does **not**
copy, inspect or export private source, modify a publisher allowlist, close any
incident, approve a carrier, replace existing eight-incident registry, or
relax the exact source main protection requirements.

## Finding: two nonidentical incident policy gates

- Current LLVM V3 publisher `scripts/publish-private-ci-source-v3.py`, reviewed
  at LLVM `main` `542545deb87a769bcf91b698227bb183df68956e`:
  **#22 #77 #127 #212 #222**.
- Platform-conformance review registry `docs/security/private-ci-incident-disposition-review-v1.json`,
  reviewed at `main` `5b3f1d388498f4bc067673aab29908b0cdd4cecf`:
  **#22 #77 #127 #171 #172 #198 #200 #252**.
- Union is **10 distinct incidents**, with only #22/#77/#127 in both. #212/#222
  are absent from the eight-incident review registry; #171/#172/#198/#200/#252
  are absent from LLVM's current publisher gate. **All ten incidents are OPEN**
  at this readback. This is a cross-policy coverage discrepancy, not proof that
  all ten must automatically become source-level publisher requirements without
  independent owner review.

The exact IDs, membership and non-authorizing status are pinned in
`docs/security/private-ci-cross-policy-incident-review-v1.json`; the
source-free test `tests/private-ci-cross-policy-incident-review.test.mjs`
rejects missing gates, reordered or forged IDs, fake closed statuses,
unauthorized policy promotion, reviewer identity drift, and changed closure
requirements. It is an OFFLINE model, not a substitute for authenticated live
GitHub issue reads immediately before any source-bearing operation.

## Review and remediation queue

| Issue | Scope | Required remaining independent disposition |
| --- | --- | --- |
| #22 | Historical public Java source carrier | Visibility history, Git Support purge/retention decision, forks/clones, credentials, audit logs |
| #77 | Repeated Scintilla private source-bearing carriers | Full Java/LLVM/.NET/Forge refs and artifacts inventory; authorization-at-transfer classification |
| #127 | Dummy-stack unprotected approval window | Reconcile exact origin and all-a provenance; retained historical Git objects and review window |
| #171 | Agent-pontifex runtime/recovery carrier | Independent original placement classification and residual-object review |
| #172 | LED-Dynamo LLVM carrier | Exact-tree placement and authorization disposition |
| #198 | ClaimGraph copied private Java CI-script blobs | Third-party workflow/data exposure, scope, retention and authority |
| #200 | ClaimGraph retained private Java governance blobs | Credential and policy exposure, artifacts, cleanup and authorization |
| #212 | Honeypot private LLVM exact-root-tree execution | Confirm source-tree identity vs authorization; retained objects/Actions/audit |
| #222 | Daedalus source-bearing refs | Preserve evidence, decide supervised purge, re-audit reachability |
| #252 | Honeypot alternate carrier source placement | Independent full-scope review, authorization, artifacts and retention |

No issue is safe to close solely because its destination is currently private,
a CI job ran, a branch was deleted/reset, or this packet is merged. Provider
retention, historical source exposure and preexisting copies must be assessed.

## Independent owner decisions required

1. `@ORESoftware` (immutable user ID 11139560) investigates each issue and
   writes incident-specific findings covering source placement, contemporaneous
   authorization, Git-object/ref lifetime, Actions caches/artifacts/logs,
   credentials, external copies, provider retention, cleanup decision and
   source-export resumption.
2. Use the issue-specific exact resolution markers and independent closure
   requirements of the existing conformance policy; LLVM additionally requires
   exact issue IDs and immutable `closed_by` identity with
   `state_reason=completed`. No retroactive claim of authorization.
3. The owner must explicitly decide whether to unify or keep distinct
   per-source publisher incident lists. Such a decision needs protected-source
   review and negative tests; **this packet makes no permission change**.
4. Protect source `main` with enforced CODEOWNER review, required approvals,
   stale-review dismissal, admin enforcement and no bypass/force-push/delete;
   approve exact PR-specific private carrier/workflow/test-plan SHA, verify
   visibility and numeric repository identity immediately before transfer.
5. Only after every applicable gate is independently satisfied may a trusted
   publisher transfer an approved exact source tree, then record actual
   checkout/compile/test job steps, sanitizer results, provenance and retention.

At this review the LLVM source `main` reports `protected:false` and the
carrier contract does not authorize class-oracle PR #1816. Prior successful
**source-free** runner smoke tests are capacity evidence, **not** source-copy
authorization. There is deliberately no fallback, skip, or transfer mode in
this packet.

## What a reviewer can do now without source transfer

Review the issue threads and past retention decisions, request organization
audit logs and GitHub Support cleanup guidance through authorized processes,
record evidence and disposition in individual issues, and decide on a single
reviewed policy scope. Keep source-bearing carrier refs untouched until
forensic evidence preservation and deletion policy are approved.
