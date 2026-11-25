# Supervisor-crash-tree v1 — bounded conformance gate

Status: **MODEL_ONLY**. This is an additive trusted-host reference model and proposed cross-backend contract, **not** production supervisor execution, unbounded verification, or compiler-backed AttoLang guest parity.

## Crash containment rule

Topology: trusted guardian **R** owns supervisor **S** and unrelated actor **B**; **S** owns supervisor **T**; **T** owns actor **A**. Every managed node has a stable logical ID, a generation, logical phase, admission fence, simulated physical loan, and exactly one pending per-incarnation terminal notice slot.

1. A crash of S, T, or A is an **atomic** transition: mark that incarnation FAILED; fence new DATA/child admission throughout that node's subtree; deposit a generation-tagged failure receipt in independent trusted CONTROL escrow.
2. The nearest **live and unfenced** ancestor handles the notice. If S has failed while T's notice is unacknowledged, R becomes T's CONTROL authority. The failed process never invokes its own panic recovery hook.
3. A fenced running descendant can finish in-flight work only to reach a trusted shutdown barrier. STOPPING → RETIRED needs a separate physical-completion receipt; RETIRED → RECLAIMED requires zero owned loans, acknowledged failure escrow, and all children RECLAIMED.
4. Restart a reclaimed supervisor only while its parent is live and unfenced, with a new incarnation/generation. Restore children top-down using **new** generations; no old direct ActorRef, state loan, message, or callback gains new-epoch authority. Crash of one subtree does not fence the sibling B.
5. A failure of the runtime guardian R or the entire process is **not recoverable by code running in the same failed process**. This requires an externally supervised host process and, for durable restoration, a crash-consistent journal/commit protocol. Do not call in-memory escrow durable across host power loss.

## Current formal evidence

- `check.mjs` is dependency-free, exhaustively explores the fixed 5-node topology with epochs 1..2 and one simulated outstanding physical loan per node. It checks 715 reachable states and 2,216 transition edges in the author-side V8 execution, with a full subtree-recovery witness and an already-pending child-notice/parent-crash witness. Three deliberately corrupted states are rejected, along with wrong-generation and unauthorized acknowledgments.
- `SupervisorCrashTreeV1.tla` models the same topology and release guards independently. `SupervisorCrashTreeV1.cfg` declares safety invariants. **TLC has NOT been executed for this candidate**, so the TLA+ checks are authored rather than proved.
- Run the executable reference oracle with `node formal/supervisor-crash-tree-v1/check.mjs`. A dedicated restricted Actions workflow runs this only when a runner actually starts; a zero-step workflow is NOT_EXECUTED.

## Known proof limitations

The models assume an infallible **in-process guardian** R, atomic registration/fencing/CONTROL escrow, immutable topology during a recovery cycle, bounded failure count/epochs, and a trusted physical-retirement receipt. They do **not** model supervisor hot-reparenting, changing tree shape, restart intensity/time windows, mailbox drain races, arbitrary actor-owned FFI leases, physical stack-overflow behavior, or an operating-system failure. State exploration is not a proof for arbitrary tree depth or scheduler fairness. The existence of a recovery path is not a liveness guarantee.

TLA+ and Java/LLVM implementation trace refinement remain separate requirements. Control messages must not be forgeable via guest DATA; the authoritative failure mailbox and receipt ledger must outlive a supervisor policy actor's execution. A supervisor actor MUST NOT own another actor's sealed state.

## Required production parity gates

- **Java/GraalVM:** reconcile source `define supervisor` admission with Java #1924 → #1962 → #1965 and child/physical receipts; run JDK25 reducer, TLA+ TLC, compiled guest, Native Image and hot-restart traces on exact PR heads.
- **LLVM:** compare native registry transitions from LLVM #864 against the same oracle; run native compiler guest + CTest, GCC/Clang ASan/UBSan and physical-loan/stack tests.
- **.NET NativeAOT, Wasm, Forge:** expose a compiler-owned typed supervisor CONTROL transition, not an ordinary guest actor message, and provide the exact same generation-fenced full-subtree traces. Missing guest lowering remains **NOT_EXECUTED/NOT_CERTIFIED**.
- **All backends:** adversarial matrix must cover nested supervisor crashes, child notice in escrow before parent crash, forged/stale notice/ack, sibling survival, shutdown versus restart, duplicate terminal receipts, out-of-order cleanup, CONTROL coordinator fault, and guardian-process crash/reboot recovery.

Related draft PRs: [Java #1924](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1924), [Java #1962](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1962), [Java #1965](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1965), [LLVM #864](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/864), [Conformance #459](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/459).

Do not promote this model-only PR as production certified, and do not mirror private source to another organization without approved provenance and destination authorization.
