# Actor Memory Contract v1 (draft)

Status: proposed; no backend parity or executable CI certification.

## Memory domains
Every actor, including SHARED actors, owns a distinct mutable memory domain. A domain has immutable identity (actor ID, epoch), allocation metadata, and states ACTIVE, DRAINING, RETIRED. Runtime scheduler threads never own the domain. A domain cannot be retired until all tasks, mailbox deliveries, async frames, borrowed views, foreign callbacks, and read-only leases that can access its storage are quiescent.

## References
Guest references are opaque (domain ID, allocation slot/offset, allocation generation, domain epoch). Validate domain and generation before dereference; overflow-check offset+size and alignment. Recycled slots increment generations. Do not expose raw cross-domain mutable pointers. No handle may be valid after retirement. Fast-path check elimination requires compiler proof of lifetime, provenance and exclusive access.

## Ownership lowering
Canonical operations: `rt take`, `rt copy`, `rt share`, `rt borrow`, `rt mut borrow`. Reject `rt borrow mut`. Unique mutable ownership; shared regions are deeply immutable unless an explicit synchronized abstraction is used. Transfers revoke the sender's access atomically with successful receiver admission; failed admission leaves ownership with sender. Suspend-aware borrow checking forbids invalid borrow survival across await. Shared cycles require a defined ownership/reclamation policy; no claim that borrow checking alone collects cycles.

## Allocation classes
TURN_TEMP: message-turn-local scratch; bulk reclaim only after no escaped borrows or suspended frames.
ACTOR_PERSISTENT: actor state, collections, closure environments, and continuation frames that outlive a turn.
SHARED_READONLY: explicitly frozen immutable storage with ref-count/epoch/lease tracking.
HOST_PINNED: runtime handles, scheduler bookkeeping and FFI roots, not guest-object payloads.
UNTRUSTED: separately enforced isolation, not established merely by an arena.

## Backend mapping
- GraalVM: off-heap actor-native arenas with generated accessors and offset handles; preserve three global scheduling pools and pooled untrusted isolate.
- LLVM: native actor-local allocator and deterministic destructor/drop paths; no tracing GC in strict zero-GC profile.
- .NET Native AOT: per-actor unmanaged regions via native allocation; CLR GC only for host bookkeeping; ordinary CLR objects are not actor-private.
- Wasm: actor-owned checked linear-memory regions or separate instances; memory bounds alone do not enforce actor provenance.
- JavaScript: Worker-owned actor state, transferable buffers with sender detachment, and explicit structured-message ownership; JS engine GC remains.

## LayoutStore<T>
One authoritative physical representation per store. AoS: row-contiguous records. SoA: field columns. AoSoA: tile-local columns. SoAoS: arrays of grouped subrecords, distinct from AoSoA. Conversions are explicit and transactional, invalidate or remap generation-safe row handles, and cannot proceed with live incompatible borrows. ECS entities are generational IDs, not actors.

## Required adversarial fixtures
1. Two actors allocate independently; retiring one never invalidates the other.
2. Stale allocation generation and stale actor epoch reject access.
3. Overflow, alignment, out-of-bounds and forged-domain handles reject access.
4. Failed ownership transfer retains sender ownership; successful transfer revokes it.
5. Mutable alias and cross-await invalid borrow are compile errors.
6. Concurrent cancellation, mailbox drain, callback, and actor teardown never free live storage.
7. Immutable sharing persists until final lease retires; mutable cross-domain alias rejected.
8. Each layout preserves values across insertion, swap-delete, conversion and handle invalidation.
9. Actor ECS stores support disjoint field borrows and reject conflicting writes.
10. Native AOT, browser/Node, JVM, native LLVM and wasm32 execute generated guest fixtures.

## Evidence gate
Record repository, exact head SHA, compiler invocation, guest executable artifact, runner/job ID, actual executed test steps and result. Distinguish NOT_EXECUTED (observed empty steps), UNOBSERVED (steps unavailable), source-free synthetic canary, and executed guest tests. No source-bearing cross-org mirror without a merged protected-main destination-specific allowlist and independent security containment approval. Review alone never authorizes transfer.
