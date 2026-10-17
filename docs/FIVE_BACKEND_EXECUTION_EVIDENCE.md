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
