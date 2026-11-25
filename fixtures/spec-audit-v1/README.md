# AttoLang specification audit — candidate fixture inventory v1

**Status: PROPOSED / NOT_EXECUTED.** This inventory is *not* proof of compiler acceptance, guest execution, or cross-backend parity. The source-free inventory test validates metadata and file presence only.

This set covers specification PR [#9](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/9), decisions [S-42, S-46, S-54, S-55, S-56 and S-57](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/issues/15), and existing canonical Guard/named-argument fixture files. Keep chapter 15 for nested actor pipelines and chapter 20 for Guard.

- `positive`/`negative`: an **intended** oracle, never a certified pass; negative cases require a named diagnostic class rather than a string guessed from a backend.
- `decision-candidate`: alternative or incompletely specified syntax. **Do not enforce admission/rejection until independently ratified**; these files are review inputs, not passing tests.
- A real run must pin the complete fixture hash set, spec and compiler source/tree SHAs, artifact hashes, nonempty executed steps and typed guest outcomes. Report per-backend `SOURCE_CHECK`, `GUEST_EXECUTED` or `NOT_EXECUTED` truthfully.
- Preserve the distinct deferred `Actor.pipe(...).start()` contract when exploring S-54; graph drop/lifetime in S-55 is still PROPOSED.
- Complete actor stage roles, constructors, port contracts and start/stop signatures with compiler owners before promoting pipeline examples to executable positives.
- Source-free Node inventory validation is **not** an AttoLang compiler test.

Existing Guard and named-argument fixtures are reused rather than copied, so one source carries the exact semantics into follow-up Java/LLVM, then .NET/Wasm/Forge verification.

## Pinned fixture identities and paired negative controls

Each source is pinned to a Git blob SHA-1. The source-free Node test recomputes
the Git object digest from the actual fixture bytes to catch accidental
substitution, truncation, or file drift. This is Git identity evidence, **not**
signed compiler provenance or guest execution. Positive `expected_guest_i64`
fields are target oracles, not observed values.

Before counting a negative on any backend, first compile its paired control
from the same pinned compiler build and require source admission. Then reject
the negative with the expected **semantic diagnostic class** rather than an
unrelated parser error, missing stage declaration, or generic nonzero exit.

The `pipeline-double-start` case uses unresolved Reader/Writer placeholders.
It remains a `decision-candidate` with the future target diagnostic
`MOVED_BUILDER_REUSED`; it is **not** a valid negative compiler witness until
concrete admitted actors and typed ports exist. No backend status has advanced
beyond `NOT_EXECUTED`.

## Same-feature differential controls

Each negative case has a `control_transform` with exactly one occurrence of
`from`, which becomes `to` in its control. Ignoring only full-line comments,
the source-free inventory enforces byte-for-byte equality everywhere else.
Guard fallthrough/else, duplicate named argument, and direct ActorRef method
tests therefore have minimal paired controls. A compiler rejection **never**
counts unless the corresponding same-head, same-toolchain control compiles and
the negative fails with its **specified semantic diagnostic class**, not a
generic parse error. This transformation check is only a structural source-free
oracle and does not establish guest behavior.

## Compiler-backed receipt contract (source-free validator only)

`lib/spec-audit-guest-evidence.mjs` exports
`validateSpecAuditGuestClaim(manifest, receipt, independentlyPinnedExpectations)`.
`tests/spec-audit-guest-evidence.test.mjs` exercises 23 structural and
adversarial cases locally, including missing runner steps, forged SHA/tree
identities, incorrect typed return values, missing or failing negative
controls, parser-only failures, incorrect diagnostic classes and attempts
to promote unratified decision candidates.

Required compiler details include a distinct Java/LLVM/etc source commit and
Git tree, compiler artifact hash, conformance head and tree, run/attempt/job/
runner identities, exact required successful non-housekeeping steps, and
per-fixture source blob IDs. A negative must be **semantic**, matching its
diagnostic category, with an admitted one-edit positive control in the same
compiler run. A positive must actually compile and run with the prescribed
typed integer value and a pinned guest artifact digest.

**The validator returns `REVIEW_REQUIRED` for any internally consistent
claim.** It is not an execution mechanism and cannot independently verify
GitHub API job metadata, compiled guest artifact bytes, source-owner
permissions or runner allocation. Do not use synthetic examples from tests
as authenticity receipts; all five backend entries stay `NOT_EXECUTED`
until independent compiler-backed evidence is available.

## Java/LLVM source-local compiler probe and authenticated API metadata check

First-wave adapters are intentionally **fail-closed** and **non-promoting**.
`lib/spec-audit-compiler-adapter.mjs` invokes independently configured absolute
compiler executables without a shell. It snapshots, hashes and isolates each
`.atto` source; requires a nonempty compiled artifact, verifies a typed
`int` result (process exit or clean integer stdout), compiles one-edit
positive controls before negative cases, and rejects parser-only or
wrong-diagnostic failures. It supports Java/GraalVM and LLVM as different
configuration values, not as observed guest-success claims.

Run with a **reviewed configuration stored outside the checkout**:
`node bin/run-spec-audit-compiler.mjs --config=/absolute/reviewed-probe.json`

The config schema is `atto.compiler-probe/1` with fields `backend`,
`compilerHead`, `compilerTree`, `conformanceHead`, `conformanceTree`,
`timeoutMs` (100..30000), `caseIds`, `resultChannel`
(`process-exit` or `stdout`), `compileArgv` with exact standalone
`{source}` and `{artifact}` tokens, and `runArgv` referencing
`{artifact}`. Both commands require absolute paths except the compiled
artifact when it is the run executable. There are **no automatic compiler
paths**, no external source checkout, and no source-free fallback on missing
compilers. The CLI verifies its current Git head/tree and clean raw worktree,
then emits `LOCAL_UNAUTHENTICATED_COMPILER_PROBE` on successful local
observation. That record cannot certify runner allocation or native parity.

`lib/spec-audit-github-evidence.mjs` independently queries authenticated
GitHub REST for compiler run, **attempt-scoped** jobs, compiler Git commit/tree,
conformance Git commit/tree and fixture blob identities. It compares those
responses against a reviewed workflow path/job name and an independently pinned
compiler/conformance SHA pair. Foreign head repositories, duplicate jobs,
truncated trees, unknown or empty steps, zero runner IDs and mismatched fixture
hashes fail closed. Read-only API calls use `GITHUB_TOKEN`; no arbitrary URLs
or redirects are accepted.

`node bin/verify-spec-audit-github.mjs --receipt=/absolute/guest-claim.json --expect=/absolute/reviewed-pins.json`

The independently prepared `reviewed-pins.json` must contain exactly
`{"expected": {...}, "ciPins": {"workflowPath": "...", "jobName": "..."}}`.
`expected` contains `backend`, both compiler SHA/tree pins, both
conformance SHA/tree pins, `requiredCaseIds`, and `requiredSteps`.
The script **exits 3 even when metadata matches** because the actual compiler
binary, guest artifact bytes, diagnostic transcripts and independent review
remain unverified. Exit 2 is invalid/unavailable evidence. Neither 0 nor 3
means guest parity, and a source-free mocked test is never a GitHub CI receipt.

The dedicated source-free CI checks 30 GitHub metadata-denial tests and 15
mock-command adapter tests (plus previous candidate and receipt tests).
Host-only execution or a fabricated JSON receipt cannot promote any backend
from `NOT_EXECUTED`. The exact-head hosted workflow itself is blocked by
runner admission until nonempty executed steps are available.

## 2026-11-07 evidence hardening

The independent GitHub CI pins now require `workflowGitBlob` (the exact
Git blob SHA-1 of the reviewed compiler-source workflow). The authenticated
metadata checker fetches the compiler's *entire untruncated exact-head Git tree*
and confirms that the named workflow file is a single matching blob. It also
rejects failed non-required steps. A matching job without authentic compiler
and guest artifact bytes still returns an **unverified** result.

The source-local Java/LLVM adapter now SHA-256 hashes compiler executables,
guest runners and compiled artifacts using bounded 64 KiB reads rather than
allocating the full 512 MiB cap. It rejects symlinked fixture-parent paths and
re-hashes the compiler/runner around invocations and guest artifacts after
execution. It also fails closed if a compiler mutates an isolated source or
prints error-severity diagnostics despite an exit status of zero.

The source-free local regression suites include adversarial workflow-blob,
compiler replacement, artifact mutation, source-tampering and symlink-path
cases. Tests and code paths are authored but **hosted exact-head execution is
still blocked until GitHub Actions jobs have nonempty executed steps**.
