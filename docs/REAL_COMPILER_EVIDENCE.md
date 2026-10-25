# Real compiler smoke evidence — non-promoting adapter

The shared platform-conformance harness currently tests its own runner with a fake checker; this is not backend parity evidence. Independently, the **private** Java/GraalVM and LLVM source repositories have merged compiler-smoke producer changes (Java PR #953 and LLVM PR #383) that can generate compatible JSON reports. Their merged status alone does not authenticate an executed build on a current exact commit.

## Producer workflows

- Java/GraalVM: `oreslang-source.java/.github/workflows/graal-conformance.yml` executes `scripts/ai-conformance-smoke.py` using the built Java launcher through the reviewed Python probe.
- LLVM: `oreslang-source.llvm/.github/workflows/llvm-conformance.yml` executes `scripts/ai-conformance-smoke.py` using `build/oreslang-llvmc`, then asks clang to link the generated IR and runs the resulting executable.
- Each producer tests `main()` returning 42 and a rejected reference to `nonexistent_symbol`. Positive source acceptance plus runtime result, and a real negative compiler diagnostic, are separately required.
- Producers record exact argv, process outputs and exit status, selected backend, source fixture SHA-256, compiler artifact digest (native executable for LLVM, Java launcher class for Graal), process-invoker digest, source checkout SHA and CI run identity. Timeouts and truncated results fail closed. Process output is read incrementally with bounded in-memory buffers (32 KiB per stream); these are not OS-level network or filesystem sandboxes.

## Ingesting an approved, sanitized artifact

The report inspection command checks **schema consistency only**, not provenance or truthfulness of self-reported process results:

```sh
node bin/inspect-real-evidence.mjs path/to/approved-ci-report.json
```

A report passes consistency validation only if the expected fixture digests, positive runtime outcome, diagnostic rejection and build fingerprints are present. The command returns `authenticity_attested: false` and `publicly_promotable: false` **even for an internally consistent report**. A forged JSON document can satisfy format checks.

Before publicly promoting an example, independently verify the exact GitHub Actions run and artifact provenance; establish that the compiler build came from the claimed commit (not just a declared SHA), validate fixture bytes and toolchain configuration, review stderr/logs for secrets, and obtain a human-reviewed publication decision. A mock runner, a successful node test, or a report lacking a successful real compiler build is never proof of language support.

## Access / security

Private source repositories must remain private. Do not clone, mirror or publish them into public repos merely to obtain GitHub Actions minutes. Artifacts can contain filesystem paths and captured process output; treat them as private until reviewed and sanitized.

## Current status

No backend has yet been admitted into the public supported-feature matrix by this adapter. Even a successful two-case smoke only proves **that narrow fixture subset under one configuration**, not ownership, actors, portable runtime behavior, or Java/LLVM semantic parity.

## Cross-repository audit corrections

- Real LLVM output executes a zero-argument native binary; the report validator permits a single-element runtime argv and rejects an empty argv. The prior >=2-argument rule was incorrect.
- Real Java reports use Python as the process invoker and the compiled OresMain class as the limited compiler-artifact fingerprint. The validator does not mistake the Python hash for the compiler digest.
- Report consistency now links compiler invocation to the exact positive/negative fixture paths and links LLVM's output binary to the Clang link target. These syntactic checks **do not authenticate a forged JSON report**.
- The producer subprocess runner enforces bounded output capture and terminates process groups on timeout. This does not provide a sandbox: private CI hosts still need explicit limits on privileges, network and filesystem.

## Read-only GitHub Actions pre-step diagnostics

Run the repository's Node 22+ diagnostic on the exact failed run from a machine with a securely configured Actions:read token (GH_TOKEN or GITHUB_TOKEN):

    node bin/diagnose-actions.mjs ores-truffle-oreslang/oreslang-platform-conformance 38661631910

The tool reads run and job metadata without mirroring private code, creating runners, or accessing billing. A failed job with `steps:null` is **UNOBSERVED_FAILURE**; one with an explicitly empty `steps:[]` array is **OBSERVED_NO_STEP_FAILURE**. Only an observed completed, failing step qualifies as **EXECUTED_STEP_FAILURE**; its name and whether it is runner housekeeping remain visible. A failed job with successful steps but no observed failing step is **FAILED_JOB_WITHOUT_FAILED_STEP**, not a failing test. These labels never establish billing, runner admission, or compiler parity. The tool always returns `root_cause_established:false` and `permits_merging:false`; failed or incomplete runs exit nonzero.

An administrator still needs the GitHub Actions run-summary banner and org-level billing, spending-limit, Actions policy, and runner-capacity checks. A private carrier without executing steps is not a working substitute. Never copy private compiler trees into public or unapproved repositories.

The diagnostic test file currently defines 34 synthetic/offline regression tests. They are included in `npm test`, but a successful source-org exact-head execution has not been observed for draft PR #91. Their mere presence is not an executed test result or compiler conformance evidence.

## 2026-10-14 additional audit: execution and source-identity classification

The GitHub Actions diagnostic distinguishes skipped/cancelled/pending jobs, failing runner-setup steps, completed failing execution steps, jobs with only skipped steps, explicitly empty steps arrays, and wholly unavailable step details. If any job has unavailable step details, aggregate counts are unknown (`null`), with partial observed counts reported separately. Jobs are collected across pages using `filter=latest`, with unique numeric IDs; the run is read before and after job collection to detect attempt/head/workflow drift. Exact job head SHA, run ID, run attempt and actual allocated runner information are separately checked. Missing identity fields are **UNKNOWN**, not automatically verified, and explicit identity conflicts yield **JOB_IDENTITY_MISMATCH** regardless of apparent job success or failure. None of these checks independently certifies compiler tests or source-export authorization.

The real Java and LLVM producers independently run git rev-parse --verify HEAD in their source worktrees, reject --source-sha when it differs, and record actual_git_checkout_sha in the report. The shared validator requires that recorded checkout SHA to equal the declared commit SHA. Under pull_request workflows, github.sha may identify GitHub's synthetic merge commit; the source identity must be interpreted as the checked-out tree, not automatically as the PR branch head.

These comparisons do not independently authenticate the report or prove that an executable was built reproducibly from that commit. They do not allow public example promotion or merging without real successful source-repository CI.

## IR and native executable fingerprints

For the LLVM positive fixture, the producer now hashes the exact UTF-8 LLVM IR bytes written to the linker input and the generated native executable both before and after guest execution. The shared adapter requires the IR digest to match recorded compiler stdout and the two executable digests to match, rejecting omitted or inconsistent fields. If Clang reports success but produces no regular executable, the producer fails closed.

These checks detect unintended modification during an observed run but do **not** authenticate self-reported JSON, link the source tree cryptographically to compiler binaries, or prove the absence of a time-of-check/time-of-use race. Java continues to report only the launcher class digest rather than an entire Maven/JDK dependency closure. Public promotion still requires independent CI artifact/run verification.

## Malformed report admission

The shared validator requires exactly two non-null, plain-object case records
before reading the case IDs or any process fields. A `null`, array, string,
boolean or missing case is rejected with an explicit `untrusted compiler evidence`
error rather than allowing an incidental JavaScript `TypeError`. This is a
fail-closed report parsing boundary, **not** a compiler or binary provenance
attestation.

The case-shape regression was executed against the exact branch validator with
both Java and LLVM valid fixtures: **2/2 valid reports accepted**, **14/14
malformed case variants rejected**. These targeted checks use a deterministic
mock hash implementation, not the complete Node unit suite or native
compiler execution. The previous private carrier's 74-pass result predates
this change and must not be misrepresented as an exact-head pass.

## 2026-10-16 report-admission hardening and exact-file CI

The validator now shares the harness's conservative, case-sensitive
`isExpectedCompilerDiagnostic` matcher. A rejected source must identify
`nonexistent_symbol` as the **primary diagnostic subject**; seeing that
text in a source echo, filename, secondary hint, warning or unrelated error
does not qualify. A zero-exit successful compile/link is rejected if its
reported output carries an error-severity diagnostic. The 42-exit guest
execution must likewise not emit an error-severity diagnostic. These checks
guard against inconsistent reports; no self-reported JSON can prove
authenticity or compiler binary provenance.

The narrowly scoped, private cross-organization carrier
[Voxletra PR #13](https://github.com/voxletra/voxletra-e2e/pull/13)
tests the exact Git blobs for this harness and validator without assuming
full compiler-source access. The carrier is *not* an approved complete
compiler mirror, and its unit tests are not Java/LLVM runtime parity.
Real compiler admission requires independently verified, exact-head
producer runs, raw compiler logs, binary provenance and reviewed artifacts.
