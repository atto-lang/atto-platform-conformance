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
| Java/GraalVM | oreslang-source.java #2296 | Compiler provenance record; generation-fenced ExecutionHandle; actor-state authority follows logical execution across carrier migration; fair bounded ActorStateRwLoans baseline authored with concurrent readers/writer exclusion/cancellation fairness; private injected mutable representation tests | Execute private JDK25/Graal tests for the new RW runtime; connect source/HIR lowering; allocation measurements/scalar replacement or pooling; Native Image evidence |
| LLVM | oreslang-source.llvm #1192 | Fixed-capacity task-bound RW ticket wrapper over OresStdSyncAdmission; authenticated execution-store binding; ownership-CFG region/task provenance; adversarial native tests authored | Execute exact private CTest/sanitizers; source lowering that emits provenance; connect real owned arenas and retirement barrier; allocation/leak/hard-RT evidence |
| .NET | oreslang-source.net #261 | Allocation-friendly readonly provenance value type; canonical vectors wired into existing self-test; existing ActorArena already has unmanaged arenas/read loans/pins/generation fences | Execute exact .NET10/NativeAOT head; wire provenance into compiler + ActorArena admission; write-loan/shared-container semantics; allocation/latency evidence |
| WASM | oreslang-source.wasm #187 | Frozen host/compiler provenance metadata; canonical Node tests; existing ActorArena hides fixed linear memory and stale handles | Execute exact Node head; source lowering/runtime admission; shared RW region semantics; physical memory release remains host/GC dependent and must not be described as deterministic native reclamation |
| Forge | oreslang-source.forge #148 | Compact non-owning C++20 provenance value; canonical authority test registered in CTest | Execute exact private CTest; compiler lowering; task-bound runtime RW admission; deterministic region reclamation and allocation evidence |

## Independent source-free evidence

The common contract is also executed independently in
`honeypot-r-us-test/hnpt-e2e`, branch
`test/state-region-source-free-canary-20261030`. Exact carrier head
`1b5e265ac56c6fbc88dc97fe6bdc3549604c7d2c` has two real hosted successes:

- run `41005574007`: JDK 25 provenance, 12-test Python contract/canonical
  vectors, optimized C11 NDEBUG/Werror, ASan + UBSan — PASS;
- run `41005574006`: Node 22/WASM, .NET 10, C++20/Forge independent
  provenance canaries — PASS.

These runs prove the independent contract and toolchain/runner capacity, but
never prove a private backend head.

No private source tree may be copied to an alternate organization solely because
that organization has Actions capacity. The source repository's reviewed export
policy must authorize the exact destination and exact source snapshot first.
