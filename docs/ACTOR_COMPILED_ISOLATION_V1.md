# Compiled Oreslang actor isolation — contract v1

**Status: DRAFT / SIX BACKENDS PENDING.** This is a single canonical `.ores` fixture with separate compiled guest and host-instrumentation acceptance requirements. This PR adds no backend lowering, compiler toolchain artifact, or authenticated runtime pass.

## One source fixture, six strict checks

Fixture: `contracts/v1/actor-isolation/actor-isolation-v1.ores`, pinned Git blob `2120772dea0e55bff6af95fec059555d9f4ea99b`. The backend adapter must compile the **same source bytes**, instantiate A and B from the same emitted actor type, and run both as actual guest actors—not fabricated host models or embedded precompiled IR. The fixture intentionally uses the currently existing scalar `on_message` ABI as a bootstrap; portable actor message syntax and scoped state-loan lowering still need backend implementation. Do not change the fixture in one backend while keeping its receipt marked compatible.

The six mandatory case IDs (in order) are:

1. `independent_private_state` — guest A/B independently mutate and retain state, including equal logical offsets backed by distinct physical actor allocations.
2. `foreign_actor_access_denied` — the compiler must reject an attempted foreign actor state reference with no output IR (negative companion source/adapter required).
3. `read_loan_blocks_A_mutation_B_progresses` — a live A read loan makes conflicting A mutation fail or defer while B continues executing guest code (backend-specific state loan emission required).
4. `destroy_A_preserves_B` — guest B proceeds after A's physical retirement, corroborated by host lifecycle instrumentation.
5. `stale_handle_after_reclamation_denied` — a generation-stale handle to retired A cannot alias a recycled slot and B remains valid; guest plus host evidence.
6. `private_state_scrub_before_physical_free` — host instrumentation observes private bytes zeroized immediately **before** the real allocator release and only after pinned loans and callbacks physically quiesce; no dereference after free.

Cases 2–6 are **not implemented merely because the source fixture compiles**. Each backend must add its corresponding compiler-negative, guest-state and authorized host probes. Reports omitting those checks fail. The first guest binary alone cannot satisfy the complete contract.

## CI and independent evidence

`src/actor-isolation-evidence-v1.mjs` validates the pending manifest and an *untrusted claim document*. Claimed records require: exact Git source commit/root tree/fixture blob; LLVM compiler source SHA/root tree, exact executable SHA-256 and proof of a pinned checkout; normal hosted-run workflow/attempt/job/runner identifiers; **separate executed compiler and guest steps**; all six registered cases; positive guest assertions or an explicit no-IR negative; and host pre-free scrubbing evidence. Missing registrations, all-zero provenance, skipped executions, synthetic-only host tests, and deliberate isolation violations must be rejected.

As of the v1 evidence hardening, `ci.executedSteps` must be an array of **objects**, not a list of strings. Each step has exactly `name`, positive `number`, `conclusion: "success"`, UTC `startedAt`, and UTC `completedAt`. Names and step numbers must be unique; numbers and timestamps must be ordered; the compiler step must appear **before** the compiled guest step. This shape gate rejects skipped, failed, pre/post, substituted, missing, duplicate and temporally inconsistent step claims. It does not authenticate claims: a separate verifier must fetch actual GitHub run/job/step metadata using approved credentials and bind every reported value to the run, commit and artifact receipts.

A JSON `builtFromPinnedCheckout: true` flag is **a claim, not independent proof**. Independent gate logic must fetch GitHub's immutable commit and tree, verify the exact compiler source build logs and executable digest, confirm run/job steps actually executed and inspect native/guest logs and host allocator hooks. `validateIsolationClaim` deliberately always returns `guest_runtime_pass: false` and `authenticatedGuestExecutions: 0`, even for a structurally complete claim. Do not promote the result to verified without independent authentication and full trace inspection.

The `npm test` conformance workflow automatically picks up `tests/actor-isolation-evidence-v1.test.mjs`. It checks pinned fixture bytes, all-six-pending status, and adversarial provenance, registration, skipped-job, false-negative-rejection, stale-handle, read-loan, and scrub scenarios. These are **source-free shape tests**, not backend execution.

## Execution matrix and rollout

- Java/GraalVM → LLVM native → .NET Native AOT: bring the full actor-heap, scoped-loan, generation and physical reclamation probes online in that order.
- WASM: existing LLVM-generated wasm32 source-actor and fixed two-Worker pooled gate proves only a subset (independent state and terminal guest handler); add genuine foreign-access, loans, stale handle and scrub instrumentation. Do not conflate one Wasm instance with an OS security sandbox.
- Forge and separate Cranelift: each has its own pending status; host tests are not a substitute for compiled `.ores` execution.
- Suspension/cancellation extension is a future contract version: pins across `await`, timeout, cancellation, code/heap generation changes, carrier migration and physical quiescence. Do not count logical completion as physical retirement.

The LLVM `.github/workflows/ci.yml` on draft PR #1088 originally had an unterminated source-actor CTest command, repeated test stages and malformed tail; repair is tracked there separately. The WASM AOT workflow must build or obtain an independently pinned compiler **through an authorized source-local or approved private path**; the existing unprovisioned variables cannot make it pass. Do not copy private source into an unapproved cross-organization carrier merely because Actions minutes exist. The unresolved runner-admission issue is separate from a compiler or contract failure.
