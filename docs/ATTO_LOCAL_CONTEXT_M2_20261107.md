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
6. Implement the 30 candidate cases in contracts/atto-local-context-m2-20261107.json as compiled .atto guest tests, then port the exact fixture bytes across Java/GraalVM, LLVM, .NET NativeAOT, Wasm and Forge.

## Evidence classification

- steps=null, steps=[], or only skipped/pending steps: RUNNER_ADMISSION_FAILURE.
- Stepful failed compile/job: EXECUTED_NONPASS, with failure stage preserved.
- Structurally valid reported compiler+guest evidence: UNATTESTED_GUEST_RECEIPT_CANDIDATE, **never verified** from JSON alone.
- Genuine negative compiler admission requires exact semantic exit 1, stderr diagnostic, no IR/files, and no crash; still UNATTESTED_NEGATIVE_RECEIPT_CANDIDATE until readback.
- Source-free JS and host-only C++ tests cannot prove guest backend parity.
- Five unverified backend receipts do not prove parity; retain PARITY_UNPROVEN.

The new Node tests are source-free assurance gates. All 30 scenario entries are NOT_EXECUTED. Keep LLVM #1389 and #1391 draft until exact-head, stepful, compiler-backed runtime receipts and independent review are obtained.
