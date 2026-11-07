# AttoLang v1: local Git fetch-boundary hardening (advisory)

This isolated draft hardening child stacks on unchanged conformance PR #544, preserving the earlier #535/#531 and separate reviewer/ledger/qualifier/collector branches. It adds a source-local boundary module, 110 targeted adversarial tests, this runbook, and updates only the existing source-owned five-real-gate workflow. No private source export, cross-organization mirror, main edit, token write, reviewer bypass, force ref update or merge is authorized.

## Vulnerability addressed

The earlier read-only same-repository immutable-commit fetch workflow prevented checkout token persistence but checked only **local** Git HTTP extraheaders. An inherited `GIT_CONFIG_COUNT/KEY_0/VALUE_0`, global `url.*.insteadOf`, credential helper, alternate object directory, Git object/index/worktree override, unsafe remote URL, process preload, or proxy could alter the behavior of a subsequent authorized `git fetch`, even when the local extraheader check passed.

These are **credible boundary weaknesses**, not evidence that any attacker actually exploited a workflow. The prior CI jobs failed before admission, so no real production fetch was compromised in the observed runs.

## Implemented

- New `tools/merge-wave-git-boundary-v1.mjs`: deterministic source-free inspection of the exact allowed canonical HTTPS origin, NUL-delimited Git configuration, suspicious protocol/HTTP/credential/URL rewriting and inclusion keys, duplicate config, inherited Git and token variables, proxy settings, malformed records and bounded input. It is designed for **local structural checks only**, and always returns `merge_authorized=false` and `guest_certified=false`.
- The real CLI snapshots Node's special `process.env` host object to a plain object before inspection (the Node 22 runtime does *not* expose `process.env` as a standard plain object), rejects unsafe inherited variables before invoking /usr/bin/git, and does not log sensitive config values. Git is read-only for preflight/postflight, with a 65,536-byte configuration cap and fatal UTF-8 decode.
- The existing workflow SHA-pins checkout/Node setup, checks out the original PR head with `persist-credentials:false`, runs boundary preflight **before** the `${{ github.token }}` environment is introduced, and rechecks immediately before/after each of the five immutable same-private-repo `git fetch` calls. The read-only credential is scoped to that fetch step via process-local `GIT_CONFIG_COUNT/KEY_0/VALUE_0` and unset before Node tests. A postflight check also runs prior to untrusted test execution.
- The workflow requires exact original head/tree and an exact **268/268 Node 22 tests, zero failed**: 140 existing five-real-gate cases + 18 previous mixed CI job/credential tests + 110 additional Git-boundary adversarial cases. The two original suites are unmodified.

## Evidence

New targeted cases: 36 inherited-environment denial vectors, 24 Git config/credential/redirect denial vectors, 13 noncanonical origin URLs, plus timestamp-independent positive fixtures, malformed/oversize config and env objects, spoofed prototype/getter, duplicate origin, raw origin mismatch, and workflow boundary placement assertions.

**110/110 new test callbacks passed** using isolated V8, calling the exact verified GitHub blob of the new pure boundary implementation and the exact revised workflow bytes. Five deliberate implementation mutations were each detected: unsafe Git-env acceptance (23 failures), URL rewrite acceptance (3), credential helper acceptance (2), arbitrary remote origin acceptance (13), and hostile environment-prototype acceptance (3).

This is **not** yet an actual native Node 22 execution of the full suite or a stepful private Actions receipt; the completed private workflow runs on prior heads had `runner_id=null` and `steps=[]`. The new PR must be inspected against its own exact final head for CI admission. The Git boundary module's CLI must be run by source-owned CI before any native success claim.

## Critical trust limits

The PR controls its own workflow and code. Even if the local Git boundary checks pass, they **cannot prove a malicious PR cannot change the workflow, start concurrent processes, or read a token while a Git process is executing**. Pre/postflight checks reduce accidental configuration hazards and narrow audit gaps; they do not establish an independently trusted execution environment, prevent every time-of-check/time-of-use race, authenticate privileged GitHub policy settings, or certify compiler-backed guest parity.

To authorize a true security gate, move credential-bearing fetch into a reusable workflow or similarly independent process **pinned to and reviewed from protected main**, enforce minimal permissions and independent code-owner review, and validate immutable exact-HEAD runner receipts. Until the trust boundary exists, this workflow remains advisory and this PR should stay DRAFT.

## Acceptance after administrator recovery

Restore same-organization private Actions runner admission and protected-main enforcement; have an eligible independent reviewer audit the code and effective policies. Run the source-owned Node 22 workflow at the audited exact head, verify 268 registered tests / 268 pass / 0 fail with nonzero executed step evidence, and separately verify actual compiler-backed AttoLang .atto positive/negative guest tests. Never substitute a source-free hosted canary for private guest parity.
