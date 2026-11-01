# Canonical compiled actor-private heap acceptance v2

This directory is the single six-backend compiled `.ores` actor ownership contract. It consolidates the stronger runtime trace from this PR with the exact execution-step and semantic-negative evidence rules previously explored in conformance #210. #210 is no longer a competing canonical fixture.

## Canonical guest source

`two-same-kind-actors.ores` uses sealed actor state. Mutable state is accessed only through `handle_state(critical-write |s| -> ...)`; direct actor-state access is forbidden. Two same-kind Workers receive interleaved messages:

- A: 1,2,3,4 -> 2,8,22,52
- B: 5,6,7,8,9 -> 10,32,78,172,362

The guest's exit code 43 is only a sentinel. It is never isolation proof.

The same execution must also produce runtime ownership evidence over the actual compiled guest heaps:

1. A and B have distinct actor and heap identities.
2. Foreign B -> A read and write attempts fail for owner-authority reasons.
3. A genuine `critical-read` loan over A prevents A mutation.
4. B still executes payload 8 while A is loan-pinned.
5. A graceful stop requests retirement but physical reclaim is deferred while the loan is live.
6. The trusted runtime closes that loan; A is then physically reclaimed exactly once.
7. B executes payload 9 and retains value 362 after A's physical reclamation.
8. B then retires physically.

A disjoint host-only arena model does not satisfy these events.

## Semantic negative fixtures

Two canonical negatives are part of the same contract:

- `foreign-state-reject.ores` must fail with `FOREIGN_ACTOR_STATE_DENIED` and emit no artifact.
- `read-loan-write-reject.ores` must fail with `WRITE_WITH_READ_LOAN_DENIED` and emit no artifact.
  This negative uses the otherwise supported `on_message` handler, so rejection must come from its illegal `critical-read` mutation—not from an unsupported actor method name.

A backend that merely does not parse or lower the required actor/state construct is `UNSUPPORTED_OR_NOT_VERIFIED`; generic unsupported syntax is not a semantic pass.

## Receipt gate

`tools/verify-compiled-actor-heap.mjs` requires:

- exact source Git blob, source commit and source tree identities;
- distinct compiler and emitted-artifact SHA-256 identities;
- a concrete GitHub run/job/attempt and job URL;
- individually recorded successful executed steps for `compiler_build`, `guest_compile`, `guest_execute`, `reject_foreign_access` and `reject_read_loan_write`;
- both semantic-negative receipts with zero output artifacts;
- the exact 23-event ownership/loan/reclamation trace.

Even a structurally valid receipt returns `CANDIDATE_TRACE_ONLY`. The verifier does not authenticate GitHub, independently attest the compiler, prove publication admission, or convert self-reported JSON into release evidence.

```sh
node --test tests/compiled-actor-heap.test.mjs tests/compiled-actor-heap-status.test.mjs
node tools/verify-compiled-actor-heap.mjs \
  fixtures/actor-memory/compiled-guest-v1/two-same-kind-actors.ores \
  /path/to/backend-receipt.json
```

## Backend order and current blockers

1. **LLVM**: adapt the existing compiled source-actor path to this exact source. The acceptance oracle must require the complete A/B handler sequence; the existing generic source actor test permits `processed=0` for cancellation-oriented cases and cannot certify this fixture.
2. **Java/GraalVM**: route compiled actor fields through the actor-owned native arena and prove the same trace under JDK 25 and Native Image.
3. **.NET NativeAOT**: implement nominal actor/state lowering before attempting the receipt.
4. **WASM**: reconcile the pooled source-actor branch with current arena hardening, then implement source `spawn`/`send`/lifecycle lowering required by this fixture. JS-driven lifecycle exports alone do not count.
5. **Cranelift**: currently scalar-only. Reject actor/heap source without guest output until actor-owned heap implementation, compiler lowering, and an executed guest receipt exist. Cranelift is not Forge.
6. **Forge**: implement compiled sealed actor-state and loan lowering and emit the same receipt.

Only after synchronous ownership/reclamation passes on all six backends should phase 2 add suspension, cancellation, timer/FFI callbacks and receiver/state loans pinned until physical quiescence.

Zero-step Actions, source-free canaries, host-only storage tests, unverified mirror output and compiler-only checks remain non-evidence for this compiled guest contract. Cross-organization private-source publication requires separate independently reviewed authorization.

## Backend-specific physical storage is mandatory

All six toolchains must eventually satisfy **the same actor-language semantics**,
but must not share one host heap implementation or mistake a logical actor ID
for independent memory. The fail-closed architecture manifest is
[`physical-domains-v1.json`](physical-domains-v1.json), validated with
`node --test tests/actor-heap-physical-domains.test.mjs`. Those tests assert
requirements and current unsupported states, **not execution parity**.

| Toolchain | Required actor-owned physical backing | Distinct tenant boundary |
| --- | --- | --- |
| GraalVM/Java | One bounded, off-heap native arena plus custom actor-relative linear heap per actor incarnation; managed Java facades cannot be treated as actor-private GC heaps. | Trusted JVM process; Graal context alone is not an OS sandbox. |
| LLVM | Native allocator/arena per actor incarnation under tenant IsolateVM ownership; deterministic lifetime and zero-GC turn budget subject to separately executed RT tests. | IsolateVM native regions; not process-crash/security isolation. |
| Wasm | Dedicated actor linear memory/instance or owner-checked nonoverlapping regions within a tenant; one Store/Instance per *tenant* does not automatically provide one heap per *actor*. | Separate Wasmtime Store/Instance per tenant; in-process Wasm isolation, not OS process isolation. |
| Cranelift | **Deny** actor heap and loan lowering until a separately owned native actor arena, compiler lowering and runtime are implemented. | Stage-0 scalar JIT does not implement tenant or actor isolates. |
| .NET Native AOT | One actor-owned **unmanaged** allocation domain/arena with generation-fenced handles, process budget, lifetime pins, deterministic reclaim; not separate CLR GC heaps. | Host IsolateVM admission is a logical boundary, not an OS/CLR sandbox. |
| Forge | Per-actor reserved native scalar heap under actor-turn admission, rather than Java arenas or Wasmtime Stores. | Trusted native host unless independently sandboxed. |

An individual backend can report host heap substrate execution without promoting
compiled `.ores` state/loans/actor scheduling. The canonical 23-event guest
oracle and two semantic negatives remain mandatory for **every** backend.
A complete promotion additionally requires authenticated exact-head runner
provenance, nonzero executed steps, independent review, negative receipts and
the required physical-retirement/continuation-fence evidence.
