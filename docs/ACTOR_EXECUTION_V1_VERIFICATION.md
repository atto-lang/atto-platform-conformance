# Actor execution v1: exact-head acceptance and private CI safety

Status (2026-11-01): **SOURCE CONTRACT ONLY — no backend runtime verified.**

This runbook distinguishes source-only tests, unsupported syntax rejection,
true guest execution and GitHub Actions infrastructure failures.

## Canonical lifecycle fixture

Source: fixtures/actor-execution/v1/spawn-send-receive-stop.ores
Git blob SHA-1: 7b358d4871f931f21d1a874a15802ac3dd32ba64

The actor receives an integer 41 through ActorMail<int>, sends 42 through
its output stream, ends, and lets its caller await get_done. The lifecycle
is spawn -> get_ready -> send -> receive -> output -> end -> get_done.

The source bytes were copied unchanged to the Java, LLVM, Wasm and Cranelift
PRs; Forge and .NET include the same text as negative compiler cases.

- Java PR #2425 contains a real guest-execution test **candidate**.
- LLVM PR #1278 explicitly rejects unlowered typed ActorMail output.
- Wasm PR #249 rejects the lifecycle source at its scalar bridge.
- Forge PR #167 denies actor declaration lowering.
- .NET PR #312 rejects unlowered source actors before CIL.
- Cranelift PR #63 refuses the guest source in both run and IR paths.
- Platform conformance PR #301 holds the immutable fixture and audit gate.

These source-only / rejected cases establish NO runtime-parity pass.

## Required order to get a genuine pass

1. Obtain independent security/code-owner review for the protected private-CI
   allowlist and exact carrier workflow/test-plan provenance. A source-free
   canary is a capacity check, not permission to transfer private source.
   An empty allowlist means DO NOT mirror private code cross-organization.
2. At execution time, read the exact HEAD and Git tree SHA of each PR; do not
   trust historical copied SHAs or moving branch names. Record source repo ID,
   exact workflow blob, PR and destination identity where authorized.
3. Run source-free conformance checks with Node 22:
   node --test tests/actor-execution-baseline.test.mjs tests/actor-execution-run-gate.test.mjs
4. Run the backend's actual compiler suite at the pinned head:
   Java JDK 25/GraalVM + Maven selector SourceActorLifecycleBaselineTest and
   ActorHierarchyAdmissionTest; LLVM CMake/CTest including
   native_actor_canonical_lifecycle_unsupported; Wasm Node/compiled bridge;
   Forge native verification/CTest; .NET structured parser and Native AOT;
   Cranelift cargo fmt --all -- --check, cargo test --locked --all-targets
   and cargo clippy --locked --all-targets -- -D warnings.
5. Read actual GitHub Actions run metadata, job metadata, and independently
   fetched job steps via the authenticated API. Join the steps onto the job
   and evaluate with auditActorExecutionJob in
   bin/actor-execution-run-gate.mjs. An unassigned runner or zero job steps
   is classified as infrastructure/admission. A failed test with executed
   steps is an execution failure, NOT an infrastructure failure.
6. Even a candidate-only result is NOT runtime proof. Independently inspect
   executed job logs, exact checked-out tree, test selector, output, negative
   cases, guest artifacts, expected termination, no mandatory skipped steps,
   and actual runner step execution before any evidence promotion or merge.

## Forbidden shortcuts and unverified behavior

- Never transfer private source to an unapproved carrier.
- Never count a source-free Node test as compiled guest execution.
- Never count scalar JIT rejection as actor support.
- Never treat a green synthetic job snapshot as a signed attestation.
- Java legacy actor fields are NOT the promised sealed state schema.
  Inherited hooks, sealed state loans, critical-read/critical-write,
  mailbox races, cancellation and supervision require separate tests.
- Keep the manifest's verified backend list EMPTY until independent,
  exact-head real guest execution is observed and reviewed.
