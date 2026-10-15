# Real compiler smoke evidence — non-promoting adapter

The shared platform-conformance harness currently tests its own runner with a fake checker; this is not backend parity evidence. Independently, the **private** Java/GraalVM and LLVM source repositories now have proposed CI changes that invoke actual Oreslang compiler builds and produce compatible JSON reports.

## Producer workflows

- Java/GraalVM: `oreslang-source.java/.github/workflows/graal-conformance.yml` executes `scripts/ai-conformance-smoke.py` using the built Java launcher through the reviewed Python probe.
- LLVM: `oreslang-source.llvm/.github/workflows/llvm-conformance.yml` executes `scripts/ai-conformance-smoke.py` using `build/oreslang-llvmc`, then asks clang to link the generated IR and runs the resulting executable.
- Each producer tests `main()` returning 42 and a rejected reference to `nonexistent_symbol`. Positive source acceptance plus runtime result, and a real negative compiler diagnostic, are separately required.
- Producers record exact argv, process outputs and exit status, selected backend, source fixture SHA-256, compiler artifact digest (native executable for LLVM, Java launcher class for Graal), process-invoker digest, source checkout SHA and CI run identity. Timeouts and truncated results fail closed. Process output is captured in temporary files to avoid unbounded in-memory buffering; these are not OS-level network or filesystem sandboxes.

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

The tool reads run and job metadata without mirroring private code, creating runners, or accessing billing. It classifies NO_EXECUTED_STEPS distinctly from EXECUTED_STEPS_WITH_FAILURE and refuses to infer a billing root cause. It always returns root_cause_established=false and permits_merging=false; a failed or incomplete run produces a nonzero exit code.

An administrator still needs the GitHub Actions run-summary banner and org-level billing, spending-limit, Actions policy, and runner-capacity checks. A private carrier without executing steps is not a working substitute. Never copy private compiler trees into public or unapproved repositories.

The six offline unit tests are included in npm test. They are diagnostic-tool tests, not compiler conformance evidence.

## 2026-10-14 additional audit: execution and source-identity classification

The GitHub Actions diagnostic classifies steps using execution evidence rather than the mere presence of entries in the steps array. A completed job that contains only skipped or queued steps is classified as NO_EXECUTED_STEPS. Missing step details yield UNKNOWN_STEP_DETAILS and incomplete pagination yields INCOMPLETE_JOB_LIST; neither permits a CI-success inference.

The real Java and LLVM producers independently run git rev-parse --verify HEAD in their source worktrees, reject --source-sha when it differs, and record actual_git_checkout_sha in the report. The shared validator requires that recorded checkout SHA to equal the declared commit SHA. Under pull_request workflows, github.sha may identify GitHub's synthetic merge commit; the source identity must be interpreted as the checked-out tree, not automatically as the PR branch head.

These comparisons do not independently authenticate the report or prove that an executable was built reproducibly from that commit. They do not allow public example promotion or merging without real successful source-repository CI.
