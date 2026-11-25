# AttoLang actor-private native object graph: five backend parity contract v1

**Status:** `SOURCE_ONLY_NOT_CERTIFIED`. This contract is a precise parity
target, not a claim of compiler or executable guest parity. The following
five repositories are the scope: `oreslang-source.java`, `.llvm`,
`.wasm`, `.forge`, `.net`. The older October five-target layout
snapshot included JavaScript instead of Forge. It is preserved as historical
evidence and is not changed by this contract.

## Normative behavior

1. The canonical `node_graph.atto` creates `Node(42, none)` and
   `Node(99, first)` in an actor-private heap. The link is a nullable,
   typed, local reference and `second.next?.value` is exactly `42`.
2. Actor identity **and incarnation** scope ownership. SHARED actors
   still own independent heaps. Matching local reference words across
   actors do not make a transferable authority.
3. A typed `int` is a checked signed 64-bit value for this contract.
   Encoded typed-field operations must not be partially written, read
   with the wrong field type, straddle fields or alias reference bytes.
4. References must reject stale generations, dropped slots, forged
   handles, incompatible nominal targets and generation wraparound.
   The physical encoding of a reference is backend-private:
   compressed 32-bit per-object indirection is a .NET candidate, not a
   transport format or a mandatory identical allocator structure.
5. Borrow checking rejects use-after-take and drop/mutation under live
   incompatible loans; runtime read loans and lifetime-only pins do not
   confer out-of-turn byte access.
6. STOP closes admission first. Physical memory cleanup happens only
   after active turns and outstanding loans/pins have retired, with exact
   refunds. Allocation failures must preserve quota and handle integrity.
7. `panic`, `raise` and `throw` must preserve their distinct
   propagation and supervisor semantics while cleaning up actor-owned
   native objects. An actor cannot intercept its own panic.
8. Cross-actor references, raw pointers, FFI aliases and wire messages
   must not smuggle private-heap authority. Sharing uses separately
   proven capabilities and synchronization, not numeric pointer equality.
9. NativeAOT/JVM/LLVM/Wasm/Forge guest execution means compiled AttoLang
   code exercising these semantics, not merely an equivalent host model.
   A native host allocator test cannot promote source-compiler coverage.
10. Zero-GC and hard-real-time certification are separate measured gates.
    No backend inherits them from this contract.

## Current implementation and evidence observations

| Backend | Candidate substrate | Next compiler-backed gate |
|---|---|---|
| Java/GraalVM | Actor-owned native/FFM regions and JVM actor lifecycle contracts | Real checked `.atto` `Node` allocation, native layout access, and executed JDK/native-image test |
| LLVM | Native owned arena, lifecycle and borrow infrastructure | Actual frontend-to-native `Node` allocation and read/write/drop, GCC/Clang sanitizer run |
| Wasm | Actor-local WebAssembly.Memory arena, turn and lifetime pin modeling | Wasm guest `Node` execution in isolated/disjoint linear-memory actor region |
| Forge | ActorIncarnationMemoryV1 native heap/frame host implementation | Independent Forge codegen of typed `Node` guest and native actor test, not an LLVM rerun |
| .NET | [runtime draft #437](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/437) and [stacked opt-in emitter draft #449](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/449) | Stepful exact-head compilation, generated guest NativeAOT on Linux and Windows, then general nominal/ownership lowering |

This is a **candidate-feature comparison**, not a claim that code on `main`
has these functions or that a test was executed. As of the contract, no
backend has a qualifying exact-head, source-to-guest execution receipt
for every mandatory case. Where case fixtures are `null`, a compiler
negative/positive `.atto` fixture is still required; do not treat a host
negative test or a prose oracle as compiler evidence.

## Existing draft implementations to reuse rather than duplicate

These are **candidate PRs**, not verified parity. Some are stacked on
earlier draft branches, so integrate in dependency order and verify the
latest actual source heads rather than cherry-picking by PR number.

- Java/GraalVM: [#328](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/328)
  restores SHARED actor-local heaps; [#2651](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2651)
  mints per-dispatch execution contexts. The next native guest gate needs
  compiler-emitted `Node` allocation and typed field accesses in these
  authenticated domains.
- LLVM: [#1215](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1215)
  already adds a narrow **source compiler lowering** for synchronous sealed
  actor scalar state; [#1541](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1541)
  targets actor-owned scalar frames. Extend these paths to typed object
  graph allocation; do not treat their different scalar fixtures as the
  canonical `Node` graph already passing.
- Wasm: [#120](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/120)
  binds pooled guest execution to private actor heaps;
  [#445](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/445)
  adds compressed32 *access grants*. Those checked-offset grants are
  different from .NET's generation/slot words: prove equivalent
  **authority and lifetime semantics**, not bit-identical references.
- Forge: [#214](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/214)
  has a closed-world `.atto` scalar actor AOT bridge;
  [#210](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/210)
  integrates actor heap and logical stack host infrastructure. Extend
  the bridge to nominal object graphs independently of LLVM.
- .NET: [#437](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/437)
  adds typed actor-native Ref32 runtime and
  [#449](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/449)
  is the opt-in generated `.atto` two-node actor guest bridge.
  Exact-head compilation and Linux/Windows NativeAOT execution are required.

Reconcile dependencies and exact Git blobs before integrating overlapping
actor-memory implementations. Never merge these drafts based solely on
source-free contract tests or an unexecuted CI badge.

## Certification algorithm

For **each** backend and every mandatory case, collect an immutable
evidence bundle containing:

- Exact backend source commit SHA and root tree; exact fixture Git blob
  (not just a filename); static toolchain version and configuration.
- Source compiler invocation, independent type/borrow/ownership
  diagnostics, and proof that a negative case emitted **zero executable
  guest IR/binary bytes**.
- Output executable or Wasm artifact digest, full command, relevant
  execution stdout/stderr and exit status. NativeAOT requires both
  Linux x64 and Windows x64 on the .NET track.
- GitHub Actions run ID, attempt, jobs, nonempty actual steps, source
  checkout identity and non-skipped pass receipt. Zero-step failures
  never count as compiler/test failures or passes.
- For memory lifecycle and stack containment: stale/foreign reference
  denial, peer actor survival, STOP/loan cleanup and native budget refund.
- For .NET steady-state allocation, measure warmed guest payload
  *separately* from scheduler, metadata and whole-process managed GC.

A source-free runner may validate only this contract's encoding and
negative-control integrity. It must never mark a backend as executed,
certified, zero-GC or hard-real-time. Evidence promotion must use a
separate independently reviewed, exact-head receipt schema.

## Security gate for private source

Never mirror private source to another GitHub org merely because it
has Actions budget. Check the **source repository's** protected-main
policy, independently reviewed destination allowlist, and exact
source commit/root tree-to-destination approval. Once permitted, a
temporary private branch and local test-org `GITHUB_TOKEN` are
acceptable with exact Git blob verification; until then, use
source-free tests only. This contract changes no source repository
private-CI policy.

## Near-term completion order

1. Execute the source-only conformance validator and negative tests
   without claiming guest parity.
2. Obtain approved, stepful CI execution for .NET runtime PR #437
   and stacked compiler PR #449, execute generated `.atto` guest
   NativeAOT on Linux/Windows and separate host/guest receipts.
3. Land an independently compiled Java and LLVM `Node` guest and
   fail-closed ownership tests. Verify compiler/type/borrow checking.
4. Add Wasm and independent Forge guest codegen and real execution.
5. Fill all null source fixtures, run all mandatory cases at exact heads,
   and only then consider an independently reviewed promotion contract.
