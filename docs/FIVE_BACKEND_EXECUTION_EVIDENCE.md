# Five-backend native-execution evidence ledger (draft v1)

This source-free ledger complements `src/five-backend-scalar.mjs`. The original checker proves **fixture source identity only**. The new `src/five-backend-evidence-ledger.mjs` validates the shape of a structured declaration of native execution evidence for **all five** `oreslang-source.*` backends.

It **does not authenticate GitHub API responses, inspect build logs, verify artifact contents, execute the Oreslang guest, certify parity, or authorize private-source transfer**. It deliberately returns `EVIDENCE_SHAPE_ONLY_NOT_AUTHENTICATED` and `parityCertified:false` even when all five backends contain apparently complete execution claims. Never promote a release from this offline checker alone.

**All five records remain release-blocked even when all five claim execution.**
A structurally complete manifest now reports `completeUnverifiedClaimSet:true`,
`authenticatedExecutionCount:0`, `independentlyAuthenticatableClaims:false`,
`releaseReady:false`, and a `blocked` entry for **every** claimed backend
with reason `SELF_REPORTED_EXECUTION_NOT_AUTHENTICATED`. Earlier shape-only
output used the misleading label `independentlyAuthenticatableClaims:true`
and omitted claimed backends from the blocked list. The revised result is
explicitly a breaking fail-closed change for callers that confused complete
self-reported fields with independent verification. Release controllers must
verify actual GitHub run/jobs and downloaded binary artifact bytes separately.


## Canonical scalar fixture

- File: `contracts/v1/semantics/fixtures/add.ores`
- Expected exact Git blob: `015f8b0f79aafa796a148d2adeff1574e8d6c491`
- Source: `pub fnc main(): int { return 40 + 2; }` followed by a newline
- Expected **executed** guest value: `42`
- Backend keys: `oreslang-source.java`, `.llvm`, `.net`, `.wasm`, `.forge`

See `contracts/v1/semantics/five-backend-evidence.pending.json` for the current explicit **pending** baseline.

## States and proof fields

Every manifest must contain exactly five distinct backend records. Each record is one of:

- `pending`: No conformance success claim. Requires a reason; forbids an execution object.
- `unsupported`: An explicitly unsupported feature or native backend path. Requires a reason; forbids an execution object.
- `executed-claimed`: A **declaration**, not verified truth. Requires a specific source blob, repository numeric ID, immutable head commit and tree, workflow ID/path/blob, run ID and attempt, exact workflow run path/ref, event, positive allocated runner ID, positive job ID, bounded runner name, native job and step, actual guest/compiler execution flags, native execution mode, toolchain, executed fixture ID and count, observed value 42, and test-log/artifact SHA-256 digests.

Boolean and zero-valued IDs, duplicate/missing backends, arbitrary workflow events, mismatched numeric repository IDs, wrong execution mode or result, empty test counts, missing digests, and source-only claims are rejected.

## Claimed runner/job provenance must be explicit

A record with `executed-claimed` status must now include all of
`workflowRunPath`, `jobId`, `runnerId`, and `runnerName`, in
addition to its previously pinned `workflowPath`, run, and attempt.
`workflowRunPath` must refer to that **exact workflow file** with
either no suffix or a validated `@ref` suffix (for example,
`@refs/pull/123/merge`). Numeric runner/job IDs must be positive safe
integers, not `0`, `null`, booleans, or strings. Job, runner, toolchain
and test-step display strings must be single-line and nonempty to avoid
fake multiline log lines.

These checks reject claims from GitHub jobs that never acquired a
runner, but **only at the metadata-shape level**. Even a plausible
nonzero ID and matching workflow run ref can be forged. The independent
release controller **must fetch** and compare the actual GitHub
`run.path`, run attempt, job ID, runner ID/name, step status, source
tree, native test logs, and artifact bytes itself. The ledger has
`authenticatedExecutionCount:0` and `releaseReady:false` regardless
of how complete a declaration looks. No private-source transfer is
authorized by these checks.

### Source-free hosted adversarial control

The independent private hosted run
[ClipTown #38995444439](https://github.com/cliptown/cliptown-e2e/actions/runs/38995444439)
executed **six** source-free Node runner/ref-shape tests, **four**
source-free five-backend false-certification tests, six CTest-admission
model tests and GCC/Clang O0/O2 synthetic ABI checks successfully.
Its runner ID was `1000005505`, its exact carrier HEAD was
`497ca57e7811a62ba5ee57615939ee9fd617ddd1`, and the 3-day
metadata-only artifact
[`source-free-ci-evidence-38995444439-1`](https://github.com/cliptown/cliptown-e2e/actions/runs/38995444439/artifacts/12086683920)
has artifact ID `12086683920`.

These were **independently authored model tests**. The actual private
platform-conformance ledger code, the five compiler backends, and their
native guest test suites did not execute on ClipTown. No private source
was copied across GitHub organizations; the source-org CI blocker and
cross-org security policy remain unresolved. This hosted run cannot
upgrade any backend from pending to executed.

The follow-up [ClipTown run #38995591028](https://github.com/cliptown/cliptown-e2e/actions/runs/38995591028),
on carrier SHA `1642ac839326d640a9fcc75980a92ecfb93ebd3d`,
also passed: **7/7** independent runner/ref and Unicode separator
negative cases, **4/4** five-backend claim cases, six CTest admission
cases and the source-free ABI controls. GitHub allocated runner
`1000005506`; evidence
[artifact #12087062030](https://github.com/cliptown/cliptown-e2e/actions/runs/38995591028/artifacts/12087062030)
was uploaded. This still is **not** execution of the real ledger's
Node tests or of any Oreslang native compiler.

## Offline shape check

From the repository root (Node 22+):

```sh
npm test
node --input-type=module -e '
  import {readFileSync} from "node:fs";
  import {validateFiveBackendEvidenceManifest} from "./src/five-backend-evidence-ledger.mjs";
  const m = JSON.parse(readFileSync("contracts/v1/semantics/five-backend-evidence.pending.json", "utf8"));
  console.log(JSON.stringify(validateFiveBackendEvidenceManifest(m), null, 2));
'
```

The static example has zero claimed executions and five blocked records. There is no release-ready `pass` conclusion.

## Required independently authenticated release gates

1. Verify private source confidentiality, protected-main review, destination numeric repository ID and explicit cross-org source-transfer approval. No branch-local allowlist can authorize transfer.
2. Fetch the GitHub run and attempt directly through a read-only authenticated API; independently pin source repo ID, HEAD commit/tree, workflow bytes, path/ref, event, job and step names, and reject zero-step runs. Use the five-backend `verify_ci_run.py` for the applicable source evidence.
3. Verify **real backend-native guest execution** and test count in each backend's own logs and outputs; check artifact SHA-256 from downloaded bytes, not just a filename or claimant-provided digest. Do not confuse compiler invocation with `--validate` or source-only checks.
4. Require explicit result `42` for the common scalar fixture plus backend-appropriate negative cases. Pending/unsupported does not count as executed parity.
5. Only an independent release controller combining authenticated provenance **and** inspected native test execution artifacts may report five-way parity certified. This module never does so.

Current background blockers: [private-source exposure incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22), [source protection #994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994), and [publisher authorization #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962). These are not bypassed by available alternate-org GitHub Actions minutes.

## Second cross-backend scalar contract — arithmetic precedence

Canonical fixture: `contracts/v1/semantics/fixtures/precedence.ores`

```oreslang
pub fnc main(): int { return (2 + 3) * 8; }
```

The file includes a trailing newline and has exact Git blob
`2d09e697ad4eeac4ee263c3656b92998c67f0bfc`. Java and LLVM's
existing semantics manifests require **executed result 40**. The .NET
conformance PR #19 adds Windows Native AOT executable execution;
Forge PR #11 requires both real IR and interpreter results; WASM
[PR #61](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/61)
requires pinned LLVM compiler and actual Wasm guest execution.

`verifyFiveBackendScalarPairSourceIdentity(workspace)` now validates
**both** pinned fixture bytes across five adjacent private source checkouts
(10 ordinary regular files) using the existing bounded, nonblocking,
no-follow descriptor checks and pre/post read identity guards.
It returns `SOURCE_IDENTITY_ONLY_NOT_EXECUTION` and
`parityCertified:false`. Seven adversarial Node unit tests exercise
correct source identity, mutation, missing fixture or backend, swapped
files, symlink rejection and invalid workspace input.

**Parity status: PENDING execution.** This source identity extension is
not proof the five backends accepted or ran the fixture. The current
single-fixture `EVIDENCE_SCHEMA` remains scoped to `native.add`;
do not fold a precedence-only source manifest into that schema or
declare five-way numeric parity until independent native result-40
receipts, matching source/commit/tree pins and negative tests are
authenticated for all five.


## Verified source-free CI provenance receipt — 2026-10-17 (UTC)

The distinct **source-free verifier** test lane has one independently inspected,
successful run. It does **not** satisfy any of the five native-backend
`executed-claimed` records above, and must never be entered as such.

- Private carrier: `scintilla-run-test/gleam-runner-conformance` (numeric repository ID `1323598260`)
- GitHub run: [#38994382119](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38994382119), attempt `1`, job `source-free-provenance` (job ID `117283556982`)
- Carrier commit: `4ed1d2cdf1a6c7a67e4a21ea22404933ba137886`; carrier tree: `4e6d5b9ecb6772c8caa4c4508e3b8fc93159202e`
- Reviewed verifier Git blob: `a5c90f2f6b74b7ff61f7f22339b5c7ee2bab13c6`
- Reviewed verifier test Git blob: `735823056232643772db389f5e3e5837dfb46ca0`
- Workflow Git blob: `57553b4cc24676a123849eeb29a69b9f00d5354d` (`.github/workflows/oreslang-source-free-73-evidence.yml`)
- Execution: `73 + 73 + 73 = 219` Python regression tests; `0` failures, `0` skips recorded, with real completed runner job steps and logs
- Artifact ID `12086447209`: `oreslang-source-free-exact73-38994382119-1`; ZIP SHA-256 `56c6e85cf07a4e71d415ee470958a9995a404353d773054f333ff83e1f8e7248`
- Downloaded ZIP metadata was independently hashed and the included `oreslang-source-free-73-report.json` examined. The report's two pinned Git blobs matched the five source-verifier draft PR heads checked on October 17, 2026 UTC.
- Artifact expires on `2026-10-20T02:18:15Z` under the recorded 3-day retention setting. Preserve a separately authorized and integrity-checked copy if later audit requires it.

**Scope boundary:** the report declares
`classification: SOURCE_FREE_CI_SECURITY_REGRESSIONS_ONLY`,
`private_compiler_source_exported: false`, and
`guest_compiler_parity_certified: false`. These are **self-reported**
attributes of the carrier; they are not proofs of repository privacy policy,
runner network behavior, private source authorization, or guest execution.
The GitHub job and downloaded ZIP establish that the *source-free tests*
executed against the recorded source-free blobs, not that any private
compiler/runtime/actor code was built, tested, or allowed to be transferred.

This evidence must be kept **outside** `five-backend-evidence.pending.json`:
all five native compiler/guest records remain `pending` until separately
authenticated exact-head native jobs, tests, logs, and artifacts exist.
Source incident [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and the protected-source publishing policy [Java #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962)
remain distinct security gates. Never mirror private source into a
different organization solely because a source-free carrier has available
GitHub Actions minutes.


## Updated five-backend source-free receipt — 77 regression cases (2026-10-17 UTC)

The exact source-free verifier/test blobs now match across **Java, LLVM, .NET,
Forge and WASM** at their `ci/exact-gh-run-evidence-v1-20261016` review branches,
and match the actual GitHub-hosted carrier bytes:

- `scripts/verify_ci_run.py` Git blob: `de7b3921a66c32f50115ee9933ef4e391ec34f8f`.
- `scripts/test_verify_ci_run.py` Git blob: `b73b3c06da3170294b5dfb589ba2131af217d268` (77 test methods).
- Actual private-carrier [run #38996750516](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38996750516) used `scintilla-run-test/gleam-runner-conformance`, `push` event, attempt `1`, with `source-free-77` job ID `117290889613`, **8 executed steps** and successful completion.
- Carrier HEAD `cb37064568d13cd2b051940d01f148a5a13d1b07` and tree `b73b0af44ef5c1ba60d5186901f213bfaa7bd5ad`. Carrier workflow `.github/workflows/oreslang-sourcefree-77-parity-20261016.yml`.
- Log contains three distinct rounds of **77/77** successful tests; **231/231** executions, zero skipped cases or failures.
- [Artifact ID 12087306517](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38996750516/artifacts/12087306517), ZIP SHA-256 `f6f2f42fbb614ca5f7b9b5defa5e6eace150ffeeb29be268059b9a93efcea901`; independently downloaded ZIP matched GitHub metadata. Included `77-parity.json` reports `schema: oreslang.source_free_ci_verifier_77.v1`, `source_free_only:true`, `guest_runtime_certified:false`, `source_repository_native_ci_certified:false`, and `private_runtime_or_compiler_source_transferred:false`.
- GitHub-reported artifact expiry: `2026-10-24T02:54:52Z`.

An identical, source-free-only receipt exists as
`docs/CI_RUN_SOURCE_FREE_77_RECEIPT.md` on each of the five backend verifier
review branches. This document and the five backend receipt files are audit
metadata, not an executable native test. The real source organization workflows
continue to report failed-before-execution (zero-step) jobs on relevant branches.
**Keep all five `five-backend-evidence.pending.json` records pending.**
Neither a successful alternate-runner job nor matching verifier blobs authorizes
a cross-organization private compiler tree export or qualifies as a native
compiler/guest execution.

Do not carry these source-free artifact IDs or digests into the ledger's
`executed-claimed` native records. Independent GitHub source-run/job/step
verification, actual backend-specific guest logs, exact SHA/tree pins and artifact
hashes remain necessary for release certification. Private-source disclosure
incident [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and independently reviewed protected-main export approval remain separate
required gates.

## Corrected source-free 82-case receipt — 246/246 verified

**Detected integrity regression:** Earlier hosted [run 38997306268](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38997306268)
ran an 82-test suite three times, but the produced JSON incorrectly recorded
`tests_per_round:82`, `rounds:3`, `expected_total:231`. The correct
total is **246**, not 231. That artifact's ZIP hash matching GitHub did not
make its *contents* internally valid; reject it as an 82-case proof.

**Fixed and rerun:** The source-free carrier workflow was corrected in
[commit 3620481](https://github.com/scintilla-run-test/gleam-runner-conformance/commit/36204819e5439de6964b8d3b297ba4c75420b9d2)
to persist the three actually completed counts, require `[82,82,82]`, compute
the total from those counts, enforce `82*3=246` and validate serialized JSON
before upload.

- Verified private-carrier [run #38997728835](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38997728835), attempt `1`, successful with eight executed steps including the three-round test suite and artifact upload.
- Exact HEAD: `36204819e5439de6964b8d3b297ba4c75420b9d2`; tree: `07f7164cd1f802ee6c46b0102649819592504d29`. Job `source-free-82` ID `117293864666`.
- `scripts/verify_ci_run.py`: Git blob `1d7b03db64a8576b5c4271b6f7571df503dffd81`.
- `scripts/test_verify_ci_run.py`: Git blob `45ada59ac6001254897edf9f8cd3b75ef4f58acc`. Both blobs match **all five** backend verifier PR branches.
- Source-free reference workflow Git blob `c62d13b3c3e9d666d90f752bcf96cbe07588a648`.
- [Artifact #12087892537](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38997728835/artifacts/12087892537): downloaded ZIP SHA-256 `377f9566dc24c4e014723032d7cba3579b0ec6bc55329711ada87c42e3bed80d` equals GitHub metadata. `82-parity.json` has `schema:oreslang.source_free_ci_verifier_82.v1`, `tests_per_round:82`, `rounds:3`, `expected_total:246`.
- The JSON explicitly records `source_free_only:true`, `guest_runtime_certified:false`, `source_repository_native_ci_certified:false`, `private_runtime_or_compiler_source_transferred:false`.
- The five backend evidence branches each now include the same Git blob `636658d7e6c431cda3dd9ca6a7d9a64af8e07d48` at `docs/CI_RUN_SOURCE_FREE_82_RECEIPT.md`. Earlier 77-case receipts remain historical.

A new `validateSourceFreeVerifierReceipt` shape gate checks required JSON keys,
strict source-free/non-native flags, bounded positive IDs and rounds, three
source-free Git blob SHA-1s, and the **arithmetic consistency** of the schema,
tests per round and execution total. It returns
`SOURCE_FREE_RECEIPT_SHAPE_ONLY_NOT_AUTHENTICATED` and always reports
`parityCertified:false`, `releaseReady:false`, and
`externalVerificationRequired:true`. This parser does **not** authenticate
downloaded ZIP bytes or the GitHub API; independently inspect artifact hashes,
runner jobs and execution logs for those claims.

The central ledger still reports **all five native backends pending**. Do not
promote Java, LLVM, .NET, Forge or Wasm guest/runtime parity because a
source-free verifier executed. Private-source transfer remains blocked until
the outstanding exposure incident and independently reviewed protected-main
approval policy have been resolved.

## Current source-free 85-test byte parity and verified 255/255 proof

All five `oreslang-source.*` verifier review branches now have identical:
- `scripts/verify_ci_run.py`, Git blob `b59a7880f060582694ed4a9862caede5e5f3e8b9`;
- `scripts/test_verify_ci_run.py`, Git blob `84eedb6beec2e8fbe81b7539095ef4550a09b0cf`, with 85 unittest methods;
- `docs/CI_RUN_SOURCE_FREE_85_RECEIPT.md`, Git blob `ee9c2d7f00e702f1633e51f28e1023278303fbb5`.

Independent carrier [run 38998088804](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998088804) executed those two script blobs in 3 rounds of **85** source-free regressions: **255/255 passed**, 8 real successful job steps. Carrier HEAD `ba78a09a767a43acf9f248d1999fa41456c1c5a4`, tree `eca4be6b8e286955733bdc31d8d8570535632ba1`; job ID `117294970323`. Exact source-free reference workflow blob `78bd3f8e95f2097d244468d80833f696fed46141`.

[Artifact #12087253307](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998088804/artifacts/12087253307) has independently verified downloaded ZIP SHA-256
`cf6076b613f70b9098915ef4724bcc0f18c3f31c6c06dfb0b4749f8d22da67c0`. Its `85-parity.json` states
`schema:oreslang.source_free_ci_verifier_85.v1`,
`tests_per_round:85`, `rounds:3`, `expected_total:255`, and all
native/guest-source transfer certification flags are **false**.
This receipt is distinct from the earlier invalid 82-case report and from the
corrected historical 82-case receipt. It is still **SOURCE-FREE ONLY**.

The ledger's `validateSourceFreeVerifierReceipt` performs fail-closed
schema, arithmetic, Git-blob-format and non-native-classification checks.
A valid *shape* is not proof that the GitHub API, artifact bytes or test logs
are authentic; those require separate independent review. All five native
records are still `pending`. No successful source-free proof, no alternate
organization's runner budget, and no reviewer request can certify Java,
LLVM, .NET, Forge or Wasm compiler execution or authorize private source export.

## Runner-housekeeping denial in native evidence declarations

For an `executed-claimed` record, `testStep` must name an **executable**
native guest/fixture test. The ledger rejects GitHub runner lifecycle labels
`Set up job`, `Complete job`, `Initialize containers`, `Start containers`,
`Stop containers`, and any `Pre ` / `Post ` step. This aligns the offline
shape gate with the five source backends' independently executed
`verify_ci_run.py` eligibility check. A run whose only completed steps are
housekeeping cannot support a native guest execution claim.

This gate checks the **reported step name**, not its truthfulness. Do not infer
native parity from an `executed-claimed` record even if the step name passes:
release controllers must independently retrieve job and step metadata,
logs, artifact bytes and actual `.ores` compiler+guest results. Current
source-org GitHub Actions runs remain blocked before runner allocation, while
the private alternate-org source-free 73-case evidence run covers verifier
regressions only. Source export is still prohibited without independent,
protected-main policy approval and security incident containment.

## Fourth verified source-free CI receipt — 86 × 3 (2026-10-17 UTC)

The latest private-carrier [GitHub Actions run #38998516318](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998516318) succeeded with `86` source-free security regressions in **three rounds**: `258` executed test cases. The job `source-free-86` ID `117296273366` completed its checkout, immutable-blob checks, regression step and artifact upload.

- Private carrier GitHub repository ID `1323598260`; exact carrier head `2019cb7895e1c098b3692916876c28d92add3185`, tree `4f5b6938dac0041c15fd71a613717f4c2ae7edde`.
- [Artifact #12088435863](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998516318/artifacts/12088435863): downloaded ZIP SHA-256 `2728c4a06f228235b6c3e28c962ebab08252bfcd960eecbac8c87627066a1866` exactly matches GitHub metadata. Its `86-parity.json` report says `source_free_only:true`, `guest_runtime_certified:false`, `private_runtime_or_compiler_source_transferred:false`, and `source_repository_native_ci_certified:false`.
- Three pinned Git blobs: verifier `26868f6f8e423a038e32ed56ef09da7fcdb43b52`, tests `9d268ba9fa019fa96d3439b64dee0b9fadfdf0cf`, workflow `3af5567b01dfa757b52c31bd6da09711bd780593`.
- **15/15 blob rechecks** passed after bringing LLVM, .NET, WASM and Forge forward to the Java verifier revision: each backend draft PR has identical verifier/test/workflow blobs. This is *source-free verifier file parity*, **not** native guest or feature-level language parity.
- New scoped receipt: `evidence/source-free-ci-86-38998516318.json`; new regression module `tests/source-free-ci-receipt-86.test.mjs`. These three new ledger tests are committed but have **not** themselves executed in the carrier run above. Only the pinned Python verifier's 86 tests are GitHub-hosted-tested.
- Previous `77 × 3 = 231` receipt is preserved for audit history and remains source-free only. The original `five-backend-evidence.pending.json` stays five-pending, with `parityCertified:false`.

No private compiler tree was mirrored by this work. **Open P0 incident #22** still documents a separate public source carrier, and Java #904/#962 still prevent approved cross-organization private source export. The source organization continues to show zero-step failed Actions jobs. Mere availability of alternative-org budget does not satisfy source privacy, independent review, protected policy or exact-tree authorization.
