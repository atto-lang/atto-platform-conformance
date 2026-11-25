# AttoLang local-context M2 — executable proof plan (candidate)

This is an additive, source-free receipt gate and semantic reconciliation plan. It is **not** a cross-backend parity certificate, not proof of a passing hosted compiler, and not authorization to transfer private source.

## Current source pins

- LLVM [PR #1389](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1389) (candidate canonical owner), reviewed head 30861ebd6b0770c64b71ec388e54348218e86713, Git tree cfa881bf11bc2badd12d8dd3ee3f7bfcb1c9c04e. Recheck before execution; newer heads invalidate this pin.
- LLVM [PR #1391](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1391), reviewed head 07b6a746ebe97095d3b456c56ac0bfb8e86057d8, has an overlapping host store. **Do not merge ScopedLocalStorageV1.hpp alongside LocalContextDomainsV1.hpp** as if they were one authenticated guest API.
- Existing positive compiler guest fixture: tests/fixtures/tasklocal-i64-source.atto, Git blob 7d3fe3b57154f0c780e26283a7467b31f3782561. Expected compiled executable exit 42 and trace markers SOURCE_TASK_RUNTIME_PASS and producer_on_carrier=1.
- Existing LLVM tests/tasklocal_i64_e2e.rs already authors two native positive binaries and 14 compiler-negative cases. These are not new tests in this conformance PR, nor hosted execution evidence.
- LLVM [runner issue #159](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/159) tracks source-local Actions admission. Workflow 42392407658 attempt 2 reported six jobs with steps=null, so classification is RUNNER_ADMISSION_FAILURE, not a compiler failure.

## Semantics to preserve

| Scope | Owner | Migration | Inheritance | Retirement |
| --- | --- | --- | --- | --- |
| ThreadLocal | Physical OS thread + attach generation | Not guaranteed after await | None | Scrub before carrier reuse, destructor at physical exit |
| TaskLocal | Logical task + generation | Survives continuation migration | Explicit immutable Sendable copy only, no implicit child inheritance | Task completion after physical continuation cleanup |
| ActorLocal | Runtime, tenant, isolate, actor incarnation | Survives actor turns and migration | Admitted same actor only | Revoke generation, then quiescence, preserving sealed-state rules |
| RequestLocal | Trusted ingress, original mail and request generation | Authenticated request continuation | Not ambiently inherited by detached tasks | Cancellation/revocation before final reclamation |

Java's inheritable task context(...) remains distinct from TaskLocal<T>. Host caller-supplied ExecutionStamp fields do not independently grant guest access. Compiler-owned key descriptors, scheduler-issued authority and tenant/isolate identity must be authenticated. Physical TLS is not a substitute for TaskLocal or RequestLocal. ActorLocal must not bypass actor-state critical read/write admission.

## Ordered smallest missing receipts

1. Restore LLVM source-org Actions admission: inspect failure annotations, hosted-runner and organization policies, and billing/spending eligibility. First prove one source-free/no-checkout canary executes at least one step. No blind rerun loop and no unapproved private-source mirror.
2. Recheck exact PR head/tree and run native host CTest and sanitizer jobs. Capture run ID, attempt, job ID, actual steps, compiler versions and logged artifact identity. Keep host-only classification.
3. Run existing LLVM native_tasklocal_i64_compiled_guest: two native exits 42, corresponding carrier marker, and 14 compiler semantic rejects with exit 1, no emitted IR/files, no crash diagnostics.
4. Independently read back source GitHub job/attempt and artifact hashes; compare pinned fixture bytes and compiled outputs. Refuse self-attested JSON as final proof.
5. Review the #1389 / #1391 crosswalk: canonical store, typed keys, payload quota, nested container rejection, Unicode, RequestLocal original-mail binding, foreign actor/tenant access, teardown and scheduler-issued stamps. Forward-port *only* independently justified non-overlapping fixes.
6. Implement the 32 candidate cases in contracts/atto-local-context-m2-20261107.json as compiled .atto guest tests, then port the exact fixture bytes across Java/GraalVM, LLVM, .NET NativeAOT, Wasm and Forge.

## Evidence classification

- steps=null, steps=[], or only skipped/pending steps: RUNNER_ADMISSION_FAILURE.
- Stepful failed compile/job: EXECUTED_NONPASS, with failure stage preserved.
- Structurally valid reported compiler+guest evidence: UNATTESTED_GUEST_RECEIPT_CANDIDATE, **never verified** from JSON alone.
- Genuine negative compiler admission requires exact semantic exit 1, stderr diagnostic, no IR/files, and no crash; still UNATTESTED_NEGATIVE_RECEIPT_CANDIDATE until readback.
- Source-free JS and host-only C++ tests cannot prove guest backend parity.
- Five unverified backend receipts do not prove parity; retain PARITY_UNPROVEN.

The new Node tests are source-free assurance gates. All 32 scenario entries are NOT_EXECUTED. Keep LLVM #1389 and #1391 draft until exact-head, stepful, compiler-backed runtime receipts and independent review are obtained.

## M7 evidence-validator hardening

The source-free candidate classifier now requires a terminal job with a positive runner ID and completed steps before even returning an `UNATTESTED` receipt candidate. A job that is still queued/in-progress is `PENDING_NO_EVIDENCE`, whereas a **completed** job with `steps=null` or `[]` is `RUNNER_ADMISSION_FAILURE`. Failed executed steps remain `EXECUTED_NONPASS`.

SHA lengths are verified separately from regex anchors to exclude trailing newline ambiguity. Artifact paths reject absolute paths, traversal, drive paths, backslashes and control characters. These checks prevent unsafe metadata from being accepted; they **do not** independently prove that GitHub ran or produced an artifact. The local Node receipt suite now has 67 source-free cases, including the new hostile mutations; all 38 language scenarios remain unexecuted pending trusted compiler/backend runs.

The authoritative source-org CI check remains blocked before any step, so all changes stay in DRAFT.

## M9 cross-scheduler ActorLocal retirement evidence

The candidate manifest now has **36** scenarios, including LC-M2-35/36. A native actor callback executing on scheduler A must not synchronously perform an ActorLocal terminal-fenced close on scheduler B, even when the target's actor generation is correct and B has already completed STOP; this prevents carrier starvation and cross-scheduler blocking cycles. An external CONTROL thread with no native carrier may perform that exact-generation close after the real target terminal fence, and a denied foreign attempt must leave the scope/value unchanged.

The LLVM companion draft [PR #1521](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1521) includes an authored C++ host regression and a third negative mutation that restores the former same-scheduler-only gate. These are **not** compiler-backed AttoLang cases, and all backend evidence entries remain `NOT_EXECUTED`. Native GCC/Clang, sanitizer, guest compiler, and independent review gates must run on exact source heads before promotion. Generic STOP-versus-set/erase linearization remains unproven.

## M10 bounded scheduler commit carrier authority

The candidate manifest now has **38** local-context scenarios across five backend families. LC-M2-37 denies a bounded actor-local mutation from a foreign physical OS thread holding the exact live ActorRef without the authenticated carrier claim. LC-M2-38 permits a preallocated lock-free scalar callback from the correct RUNNING actor carrier only when its scheduler-lifecycle commit linearizes before STOP; when STOP wins first, the callback must be denied. Sibling actor progress must remain independent.

The LLVM companion [PR #1521](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1521) contains a narrow native C11 bounded-commit admission fix, one new host regression and two negative mutations. This is **NOT** the generic ActorLocal map implementation; it does not permit arbitrary host set/erase under the scheduler lock or grant guest `.atto` lowering. All 38 scenario/backend cells remain `NOT_EXECUTED` awaiting real compiler/native receipts.
