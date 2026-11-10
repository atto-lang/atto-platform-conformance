# AttoLang elastic actor heaps — source audit and certification gates (2026-11-09)

**Status: design and source audit, NOT cross-backend guest-execution certification.**
This document supplements draft ref32 contract #606. A source file, authored test,
or successful reference model is not executable actor-memory parity evidence.

## Core invariants

- Ref32 encodes `0 = null` and `word = byte_offset / 8 + 1`. The maximum
  aligned logical offset is 34,359,738,352 bytes (over 32 GiB), **not** a
  commitment of resident RAM. Current 64 MiB implementation ceilings remain
  explicit policy/allocator limits. Guest ref32 is not a raw native pointer,
  ActorRef capability, generation or foreign-FFI pointer.
- Distinguish actor **logical address space**, **hard allocation quota**,
  **native committed backing**, **live object bytes**, **temporary relocation
  peak**, and **host/runtime metadata**. Never count virtual reservation alone
  as physical RAM consumption. Account for platform page granularity, guard
  pages and allocator overhead in production limits.
- An idle dynamic actor may have zero native payload bytes committed. A
  class/profile-based first-growth target is a **proposal**, not evidence that
  each actor should eagerly allocate that much memory.
- Growth must be actor-scoped, quota-checked and failure-atomic. Reject overflow
  before modifying cursors or publishing handles. Keep ref32 logical offsets,
  ownership generations, live contents and borrow rules stable.
- A relocating allocator temporarily holds old **plus full new** backing.
  Reserve the entire replacement against tenant and process physical budgets
  before creating it. Scrub/free the old block before refund. If denied or
  allocation/copy fails, leave old data, accounting, handles and sibling actors
  unchanged. See .NET draft #412 and stacked hardening draft #436.
- Prefer virtual address reservation + incremental page commitment for
  supported native profiles when stable address space and OS API guarantees
  are proven. On systems that cannot support it, use a pointer-free indirection
  table or segmented pages, never raw pointers that survive reallocation.
- Do not grow while native raw views or unsafe loans remain outstanding.
  Actor stop/restart waits for admitted turns, pins, callbacks, guest instances,
  continuations and FFI users to quiesce. Scrub before reuse or release;
  generation/epoch-fence every dereference.
- Realtime-prefault actors commit/prefault fixed budgets **before admission**,
  do not allocate, relocate or fault in memory in an admitted turn, and
  fail admission if sufficient memory cannot be guaranteed.
- Allocation exhaustion must affect the owner/supervisor path, not crash a
  shared carrier or corrupt a neighboring actor. This needs executed guest
  tests, not just a model of a quota ledger.

## Source audit — implementation versus guest proof

| Target | Source boundary inspected | Growth status | Guest evidence |
| --- | --- | --- | --- |
| Java/GraalVM | `ActorNativeArena.java`, `ActorLinearMemory.java` | Lazy native regions; general object lowering not certified | NOT_EXECUTED for this contract |
| LLVM | `ActorArena.c`, `RealtimeActorArena.c`; new host draft #1631 | Existing RT/prefault path stays fixed; draft #1631 adds a **separate** elastic C11 actor-native host allocator, 4/4 GCC/Clang × O1/O2 sanitizer runs locally, **no compiled guest lowering** | NOT_EXECUTED |
| .NET NativeAOT | `ActorArena.cs`, `ActorNativeArena.cs`; draft #412 | Existing fixed arena; on-demand native backing in draft #412; double-backing accounting patched in stacked draft #436 | NOT_EXECUTED |
| Wasm | `src/actor-arena.mjs`; separate draft #452 | Main retains fixed private two-page host arena; draft #452 is a separately versioned elastic **host-only** prototype (8 prior Node tests; current 10-case head V8 simulated-memory verification only), **not** compiler guest memory | NOT_EXECUTED |
| Forge | `runtime/actor_arena.hpp`, `ActorIncarnationMemoryV1.hpp` | Fixed host capacities, aggregate budget; no general guest growth lowering | NOT_EXECUTED |
| Rust source (.rs) | `README.md`, scalar Cranelift native-object compiler | No actor runtime allocation in advertised scalar subset | NOT_EXECUTED |
| Independent Cranelift | `README.md`, state-region provenance types | Stage-0 scalar JIT deliberately rejects actors; not a Forge subsystem | NOT_EXECUTED |

`NOT_EXECUTED` in this table means **no exact-head compiled-actor heap
execution evidence for this new contract**, not a claim that all existing
host tests are absent. Rust/Cranelift are unsupported actor language targets
today and must remain fail closed until compiler/runtime work is implemented.

## Portable profile candidates (not approved defaults)

Tiny: first-growth target 16 KiB, hard 1 MiB.
Standard: first-growth target 64 KiB, hard 64 MiB.
Large: first-growth target 1 MiB, aspirational hard 256 MiB **only after**
backend allocator/tenant/OS cap support is implemented.
Realtime: explicit admitted fixed-size and prefault budget; no turn-time growth.
Actual birth-time native payload commitment for lazy actors can be zero.
Use measurement-driven resizing with bounded geometric growth, per-tenant
admission, and no shrink of live or pinned pages; avoid resizing just because
a temporarily idle turn ended. Limit the number of concurrent growing actors.

## Target-specific hazards

- **Java:** distinguish FFM/direct off-heap allocation from managed wrappers,
  and Native Image host AOT from compiled AttoLang guest AOT. Verify real
  object/collection lowering and native-store escape prevention; offset cursor
  must fail closed at the unsigned ref32 bound.
- **LLVM:** host slab/POSIX allocation correctness cannot certify guest
  ownership/drop insertion or hard realtime. Run GCC/Clang with ASan/UBSan;
  RT tests must measure and reject page faults/allocation after admission.
- **.NET:** `NativeMemory` is unmanaged, but managed handles/control objects
  are not GC-free. During relocation count physical peak, not net delta.
  Run .NET NativeAOT, failure-injection and concurrent disposal tests.
- **Wasm:** `WebAssembly.Memory.grow` may invalidate cached typed-array
  views; reobtain buffers after growth. It normally does not shrink linear
  memory, so dropping guest objects does not prove RSS refund. The current
  two-page persistent/scratch partition and guest import layout must be
  redesigned/versioned before any growth path is enabled. Require explicit
  memory maximums, per-instance budgets and termination/quiescence before reuse.
- **Forge:** fixed `std::array` host arena is not a dynamic guest heap.
  Avoid native callback stack exhaustion; integrate object lowering, logical
  stacks and deterministic destructor paths before reporting parity.
- **Rust / Cranelift:** retain parser/compiler fail-closed actor rejection.
  Do not award actor heap or zero-GC parity based on scalar Cranelift execution.

## Smallest exact-head, read-only verification order

1. Execute source-free Node reference tests on this PR head. They validate
   the contract/model **only**, not backend behaviors.
2. Execute .NET #436's newly authored `ActorNativeArenaSelfTest` on the
   exact stacked head, preserving a real job/step log and original source SHA.
   Follow with no-fallback NativeAOT host tests; compiled AttoLang guest
   object placement remains a separate gate.
3. For Java and LLVM, compile one actual AttoLang actor with a persistent
   root and repeated allocation growth. Verify root bytes/offset stability,
   another actor's survival, hard-quota rejection and retirement after loans.
4. Run Wasm/Forge guest-produced fixtures only after implementing versioned
   growth/partition rules and bounded supervisor stop/reclaim. For Rust and
   Cranelift, execute negative actor admission until real actor IR exists.
5. Re-run under forced allocator failure, tenant/process exhaustion, OOM
   races, cancellation, suspension, hot restart, stale references and
   sanitizers, with explicit exact-head runner, artifact SHA and guest binary.
   Preserve `NOT_EXECUTED` and `NOT_CERTIFIED` until that evidence exists.

## Existing work references

- Shared ref32 contract: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/606
- .NET on-demand prototype: https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/412
- .NET transient peak accounting: https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/436
- Java 32-bit offset guard: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2675
- LLVM ActorRegionV1 host bridge: https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1599
- Wasm independent private memory: https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/120
- Forge heap and stack integration: https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/210

## 2026-11-09 Wasm host-only follow-up

Wasm draft [#452](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/452) adds an isolated actor-private growable page pool and tests without touching the existing fixed guest-host layout. Local source-identical Node v22 tests: **8/8 passed**; actual AttoLang guest object lowering, full repo Actions, worker/FFI quiescence and physical RSS evidence remain **NOT_EXECUTED**. The model conservatively retains accounting for pooled Wasm pages rather than assuming GC immediately frees backing. Do not advance the Wasm certification field until the compiled guest ABI is versioned and actually executed.

## 2026-11-10 LLVM and Wasm hardening evidence boundary

LLVM draft [#1631](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1631) implements a **separate C11 host-only** elastic actor backing (max 64 MiB, initial native payload zero, transient old+full replacement quota, actor-relative ref32 plus out-of-line slot/incarnation/generation). On 2026-11-10 the source-identical native test compiled and executed under GCC and Clang at both O1 and O2 with ASan/UBSan, 4/4 passes; GH blob identities matched. This does **not** execute compiler-produced `.ores` actors and does not integrate into LLVM source actor lowering. In particular, its host-control slot metadata, allocator metadata, stacks and RSS are not included in its payload-byte ledger.

Wasm #452 has since privatized `grow`/`recycle` host methods and added two additional regression tests. The **previous eight-case** source head passed in real Node; the **current ten-case** source head passed only in a V8 harness with an **emulated WebAssembly.Memory** (10/10), not a real Node/Wasm run. Both remain `NOT_EXECUTED` as compiled AttoLang guest evidence. Do not transfer the previous Node certificate to the changed head.

## 2026-11-10 runner-admission checkpoint (source-free carrier only)

**DO NOT EXPORT Oreslang private source.** P0 [security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and related #77 remain open. Live LLVM `main.protected` was **false** at this checkpoint. A destination appearing in `.github/private-ci-approved-repositories.txt` is not sufficient authorization: no protected-main independently reviewed exact-source-snapshot release was verified. Do not bypass through manual Git-tree/connector writes, artifact caches or a private test repo.

Read-only verification identified private, writable carrier `streempilot-test/browser-studio-e2e` (GitHub immutable repository ID `1323599136`). A **new source-free synthetic** [draft PR #18](https://github.com/streempilot-test/browser-studio-e2e/pull/18) was executed with these facts:

- Carrier exact HEAD `114728b304c051d0707e6c77142e7cb5e0e5da61`, not an LLVM/Atto source SHA.
- GitHub [run #42849732229](https://github.com/streempilot-test/browser-studio-e2e/actions/runs/42849732229), job `129946777084`: **SUCCESS**, nine recorded successful steps, confirmed independent step logs.
- Clang 18.1.3 and GCC 13.3.0 at O1/O2, ASan+UBSan: **4/4 synthetic budget-oracle binaries executed successfully**. .NET 10.0.403 SDK setup succeeded. These are toolchain and runner probes only.
- The carrier branch contains *only newly authored synthetic C11 code* and its local preflight workflow. No LLVM/Atto private source, compiler files, source tree hashes, internal manifests, or source-bearing artifacts were copied. Status: `SYNTHETIC_ONLY_NOT_PROMOTABLE`.

A source-org retry of LLVM native [run #42841049701](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/42841049701) was accepted, but the latest job again concluded failure without runner allocation or any executed steps. **NOT_EXECUTED**, not a compiler/test failure.

**Next authorized path:** independent administrator/security team closes or disposes of the incident, enforces source `main` protection, approves the exact source commit/root-tree plus immutable PRIVATE destination ID and retention controls, and records two independently verified signoffs on the protected source branch before any source-bearing mirror. Alternatively execute the original source directly on a repaired source-org or trusted source-local runner. Until then, host-only tests do not promote any `evidence[*]` guest status.

Wasm draft #452 now also preallocates a bounded (default 64, maximum 4096) host-only idle-memory reference table; retirement publication no longer performs dynamic array `push`. The updated ten-test exact source blobs are runtime `fc11a69711d77d1a95a7e540fde6ebf3081c0e7c` and tests `09e083ef84be0a84d43cf2ceb1d2887626859af4`. **10/10 isolated V8 tests with fake WebAssembly memory** passed; real Node/Wasm exact-head guest evidence remains `NOT_EXECUTED`.
