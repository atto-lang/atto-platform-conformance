# State-region backend parity gate — 2026-10-30

This matrix is an evidence boundary, not a feature-completeness claim.

## Canonical authority tuple

A region-backed loan/release must preserve the exact tuple:

`region_id, region_generation, runtime_domain, execution_id,
execution_slot, execution_generation, loan_id, place, access_mode`.

The machine-readable schema/TypeSpec and positive/negative vectors in this
directory are normative for cross-backend parity. A backend that does not
enforce one field must reject region-backed admission rather than report a pass.

Physical worker/carrier identity is intentionally absent. Logical execution may
migrate physical threads as long as its generation-fenced execution identity
remains valid.

## Required semantic gates

| Gate | Requirement |
| --- | --- |
| Owned mutation | Local/exclusively owned mutation needs no shared-state lock |
| Shared read | Multiple compatible readers may coexist |
| Shared write | One writer excludes every other read/write loan |
| Identity | Foreign task/domain/slot/generation/region/loan/place/mode rejects |
| Reentrancy | Acquire/release are potential actor admission boundaries |
| Cooperation | `rt cooperate` rejects actor-visible admission with incompatible live access |
| Budget yield | Scheduler budget checkpoint never unlocks state or changes logical authority |
| Suspension | Live protected access cannot suspend unless an explicitly verified protocol permits it |
| Cancellation | Cancellation is not physical retirement; live callbacks/tasks/pins must finish |
| Reclamation | Reclaim only after all real loans and lifetime pins retire |
| Allocation | Capabilities should erase/value-lower; no mandatory per-mutation snapshot/guard allocation |
| Evidence | Zero-step/skipped-only workflows never count as backend success |

## Current draft implementation boundary

| Backend | Draft | Implemented on branch | Still required before parity |
| --- | --- | --- | --- |
| Java/GraalVM | oreslang-source.java #2296 | Symbolic compiler requirement + runtime-materialized provenance; generation-fenced ExecutionHandle; actor-state authority follows logical execution across carrier migration; exclusive and fair bounded RW arbiters bind permanently to one actor allocation incarnation; private injected mutable representation tests | Execute private JDK25/Graal tests for the new RW runtime; connect source/HIR lowering; allocation measurements/scalar replacement or pooling; Native Image evidence |
| LLVM | oreslang-source.llvm #1192 | Fixed-capacity task-bound RW ticket wrapper over OresStdSyncAdmission; authenticated execution-store binding; ownership CFG carries symbolic region requirements only; concrete task/generation authority stays in runtime; adversarial native tests authored | Execute exact private CTest/sanitizers; source lowering that emits provenance; connect real owned arenas and retirement barrier; allocation/leak/hard-RT evidence |
| .NET | oreslang-source.net #261 | Allocation-friendly readonly provenance value type; canonical vectors wired into existing self-test; existing ActorArena already has unmanaged arenas/read loans/pins/generation fences | Execute exact .NET10/NativeAOT head; wire provenance into compiler + ActorArena admission; write-loan/shared-container semantics; allocation/latency evidence |
| WASM | oreslang-source.wasm #187 | Frozen host/compiler provenance metadata; canonical Node tests; existing ActorArena hides fixed linear memory and stale handles | Execute exact Node head; source lowering/runtime admission; shared RW region semantics; physical memory release remains host/GC dependent and must not be described as deterministic native reclamation |
| Cranelift (independent Rust JIT) | oreslang-source.cranelift #35 | Scalar-only Cranelift JIT with actor/async/critical syntax fail-closed native tests; actor mutable-state guest cannot yet execute | Implement actor parser/IR/runtime, sealed state critical read/write loans, async/task scheduler, and actual pinned guest compilation; do not substitute Forge or native scalar results |
| Forge | oreslang-source.forge #148 | Compact non-owning C++20 provenance value; canonical authority test registered in CTest | Execute exact private CTest; compiler lowering; task-bound runtime RW admission; deterministic region reclamation and allocation evidence |

## Independent source-free evidence

The common contract is also executed independently in
`honeypot-r-us-test/hnpt-e2e`, branch
`test/state-region-source-free-canary-20261030`. Latest exact carrier head
`a180baab84d54318ef13e7302d3034ecdf73216f` has two real hosted successes:

- run `41006539729`: JDK 25 concrete-provenance canary, 13-test Python
  contract including the compile-time/runtime split, optimized C11 NDEBUG/Werror,
  ASan + UBSan — PASS;
- run `41006539775`: Node 22/WASM, .NET 10, C++20/Forge independent
  requirement + provenance canaries — PASS.

These runs prove the independent contract and toolchain/runner capacity, but
never prove a private backend head.

No private source tree may be copied to an alternate organization solely because
that organization has Actions capacity. The source repository's reviewed export
policy must authorize the exact destination and exact source snapshot first.

## Portable mutable-state guest executable gate (2026-11-01)

The source code of `mutable_state_write_then_read.ores` is pinned by immutable
commit and Git blob SHA in `mutable-state-container-guest-v1.json`.
It performs two writes under a critical-write loan, then reads back 42 under
a critical-read loan and prints `mutable-state-container-ok`.

- Run `node --test tests/mutable-state-container-guest-v1.test.mjs` to validate
  the **metadata**, source-content-hash algorithm, negative fixture coverage,
  and fail-closed test driver. That test never compiles Oreslang.
- Within an **approved** private source checkout with an actual backend driver,
  run `node tests/run-mutable-state-container-guest-v1.mjs <backend> <local-fixture.ores> <trusted-compile-and-run-driver> @SOURCE@`.
  The driver must compile the exact pinned source and run the produced guest.
  The source blob is hashed before invoking any process. The resulting receipt
  says `local-diagnostic-not-ci-parity` deliberately.
- For each backend, attach exact compiler SHA, runner identity, stepful compiler
  build and guest runtime logs, exit status, stdout and execution profile.
  Run all eight negative guest fixtures as *real compiler rejects*.
  Zero-step workflows, scalar-only stubs, echoed expected output, source-only
  model tests and host language wrappers **never** establish backend parity.
- Cranelift is **not Forge**. Its scalar-only stage-0 currently rejects actor
  syntax, so this guest is not runnable there until actual actor/ownership
  lowering and runtime support land. No amount of scalar JIT success upgrades
  its mutable actor-state status.

Physical lifetime differs across targets: LLVM/C++ must defer native free until
all physical task/FFI pins retire; Java/.NET/Wasm must enforce the same logical
lifetime admission and stale-generation rules while honoring their respective
managed or native memory-reclamation semantics. No backend may infer actor
lifetime completion from a cancellation request alone.
