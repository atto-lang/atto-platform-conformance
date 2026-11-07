# AttoLang TLS / TaskLocal / ActorLocal / RequestLocal receipt gate

Status: SOURCE-FREE, CANDIDATE-UNATTESTED. This change does not execute a compiler or prove any backend capability.

Run: node bin/verify-scoped-local-evidence.mjs RECEIPT.json [RECEIPT.json ...]

The verifier reads the canonical scenario IDs and kinds from
contracts/scoped-locals-v1.json. It checks that all scenarios have a
compile-positive, compile-negative and/or linked guest-run receipt consistent
with their kind. It rejects duplicate/missing scenarios, fabricated shape
substitutions, absent hashes, mismatched source/checked-out SHA, zero-step
jobs, compiler crashes presented as semantic rejection, unexecuted checks
and a host-only run presented as a compiled guest.

A receipt must contain:
- schema: attolang.scoped-local-evidence/1
- backend: java, llvm, net, wasm or forge, and the matching source repository
- headSha, checkedOutSha, rootTreeSha: 40-character Git IDs
- compiler.sourceHeadSha, compiler.binarySha256 and compiler.toolchain
- workflow.runId, workflow.attempt, workflow.headSha and a nonempty jobs array
- for each job: id, runnerId, conclusion, nonempty steps with names/conclusions
- for each canonical scenario: id, kind, checks with phase, executed, assertions,
  logSha256 and fixtureSha256; positive compile / guest run needs exitCode=0
  and artifactSha256; compile-negative needs exitCode=1, a nonempty diagnostic,
  stdoutBytes=0 and artifacts=[]

Classifications:
- RUNNER_ADMISSION_FAILURE: any workflow job has steps=[] or steps=null,
  runnerId=0, or missing runner allocation.
- UNVERIFIED_INCOMPLETE: missing or inconsistent executed scenario receipts.
- PARTIAL_BACKEND_CANDIDATE_FOR_INDEPENDENT_REVIEW: structurally complete
  self-reports for fewer than five distinct backend targets.
- FIVE_BACKEND_CANDIDATE_FOR_INDEPENDENT_REVIEW: structurally complete
  self-reports for five distinct targets, NOT verified cross-backend parity.

All outcomes set parityVerified=false and evidenceTrust=SELF_REPORTED_UNATTESTED.
A JSON shape check cannot independently authenticate GitHub job metadata,
the Git source tree, compiler executable, fixture bytes, checkout provenance,
linked guest or scheduler-issued permissions. Each artifact/signature must
be independently read back and checked by a trusted evidence publisher.
The file's claimed runnerId and step records do not establish real runner
allocation without a separate GitHub Actions API lookup.

Required semantic boundaries:
1. Physical TLS is not a Task/Actor/Request authority. Carrier migration
   does not transport physical TLS; threadless Wasm fails closed.
2. TaskLocal is attached to logical Task generations and does not inherit
   into children. Explicit immutable Sendable snapshot copying is separate.
   Java lexical task context propagation is a different API, not TaskLocal.
3. ActorLocal shares only inside an authenticated live actor incarnation.
   Supervisor restart and stale generation deny access.
4. RequestLocal requires authenticated first admitted supervisor mail,
   request-generation fences, non-inheriting callbacks and bounded Unicode.
5. rt borrow/share/take/copy, typed key identity, quotas and teardown must
   be checked by the compiler and actual runtime, not a host-only model.

Next execution gate: on LLVM draft PR #1389, run the real oreslang-llvmc
native_tasklocal_i64_compiled_guest fixture at its exact current head with
a linked binary exit of 42 and strict negative semantic rejection.
That implementation is a restricted i64 slice, not generic TaskLocal<T>.
Reconcile duplicate LLVM drafts #1389/#1391 and separately verify Java
PR #2623 TaskContext before claiming generic TaskLocal parity.

Do not transfer private source to an unapproved carrier. A source-free
canary can diagnose runner admission but cannot substitute for the linked
AttoLang guest or a source-authorized exact-tree receipt.

Input safety: the CLI opens receipt files with no-follow/nonblocking flags where
supported, requires regular files of at most 2 MiB, reads through a bounded
file descriptor and rejects observed truncation or growth. This is not an
attestation or a defense against adversarial concurrent same-UID mutation.


## Independent GitHub API metadata check (second stage)

After a trusted producer has written the self-reported receipt, run:

```sh
GITHUB_TOKEN=REDACTED node bin/verify-scoped-local-github.mjs path/to/receipt.json
```

Do not commit the token, echo it or attach it to the receipt. The token needs
read access to the source repository's PR/commit/Actions metadata; no write
or cross-organization private-source transfer is necessary.

The checker fetches the **current** PR head, Git commit/tree, workflow run,
and **attempt-specific** job list from GitHub's API. The receipt must add:
- \`prNumber\`, the current pull request number, matching the source repository
- \`scenarios[].checks[].jobId\` for each compile, negative or guest check

It rejects an unexpected repository, stale PR head, wrong tree, wrong run
attempt, fabricated runner ID, absent job steps, contradictory job steps,
job IDs absent from the verified run, and unbound scenario checks.

A successful result is exactly
\`GITHUB_METADATA_MATCH_GUEST_UNATTESTED\`.
It means the source/run/job metadata was independently re-read, **not**
that the PR checkout used that exact Git tree within the runner or that the
compiler binary was built from it. GitHub pull-request workflows may use a
synthetic merge commit for the workflow run itself: the checkout step must
explicitly check out the immutable PR head and emit a separate signed/read-back
checkout/tree/compiled-binary artifact receipt.

The \`GITHUB_METADATA_MATCH_GUEST_UNATTESTED\` label is not an official
release or parity gate. Promotion still needs independently authenticated
compiled .atto guest outputs, provenance, negative semantic controls,
compiler hash and mutation checks. \`parityVerified\` and
\`guestExecutionVerified\` always remain false.
