# Actor buffer ownership and cross-tenant copy contract v1

**Status:** SOURCE-FREE REFERENCE ORACLE ONLY. No LLVM, Java, Wasm, Forge or .NET guest compiler/runtime evidence has been supplied by this document or its Node tests.

The canonical v1 test vectors are in `contracts/actor-buffer-transfer-v1.json`; executable source-free reference checks are in `tests/actor-buffer-transfer-v1.test.mjs` and can be run with:

```shell
node --test tests/actor-buffer-transfer-v1.test.mjs
```

The reference tests verify eleven situations: zero-payload-copy exclusive ownership move; actor incarnation mismatch; immutable loans blocking mutation/move/drop; scoped and reader-bound loan revocation; foreign-tenant handle rejection; heap/slot quota enforcement; retirement with outstanding loans; explicit cross-tenant copy that remains independent of its source; bounded mailbox backpressure preserving sender ownership; and terminal mailbox close reclaiming admitted DATA while preserving rejected sender values.

## Normative semantics for target adapters

- **Same trusted tenant:** `take` moves a unique buffer handle to exactly one new actor identity. Once the move is committed, all old owner handle aliases fail, regardless of any integers supplied as an alleged actor identity. No data bytes are copied by the ownership move itself.
- **Borrow:** only immutable readers can coexist. Any live read loan blocks mutation, ownership transfer, slot replacement, and destruction. The receiving actor incarnation is explicitly bound to each read loan. Suspensions require a separately proven pin/revocation rule; initially deny loan crossing `await`.
- **Cross tenant:** a buffer handle is not a wire value and cannot be dereferenced or transferred to another IsolateVM. The default is authenticated schema-checked serialization/copy into the recipient's owned heap. Host native pointers, CONTROL capabilities, FFI handles and nested foreign references cannot be sent.
- **Admission:** mailbox byte/slot reservation and valid receiver generation must precede ownership publication. Any failed send leaves ownership with the sender and does not publish new recipient handles. Queue close/cancellation races require one linearization point.
- **Accounting:** both source and destination charge the correct bytes; an immutable cross-process shared-page optimization is a future separately authorized and bilaterally charged feature, never assumed by `take`.
- **Retirement:** stop admissions, revoke handles, fence outstanding callbacks and in-flight messages, then reclaim. Physical reuse is not permitted before pinned readers and continuations complete.
- **Evidence:** tests must execute *real Oreslang code compiled by the respective backend*, verifying results/error kinds and source artifacts at exact commit SHA. Java/GraalVM, LLVM, .NET AOT, Forge and Wasm require separate executed receipts. Reference-Node tests and compiler-only IR checks are non-certifying.

## Required implementation milestones

1. LLVM: connect the trusted host-only buffer pool in draft PR #1161 to authenticated actor tickets and a real mailbox reservation/commit path; add true `.ores` fixtures.
2. Java/GraalVM: same owned and immutable-loan semantics with FFM/native memory lifetimes and explicit per-tenant quotas; Java's GC-backed wrappers cannot be described as globally zero-GC.
3. Wasm: memory isolation, typed export/import gate and resource limits, with copied DATA across different tenants and no raw pointer interchange.
4. .NET Native AOT and Forge: implement the same handle-generation, borrow, mutation/drop and process boundary rules, preserving native AOT/no-hidden-serialization expectations.
5. Run differential and negative tests across all five, with sanitizer/TSan stress where available. Do not promote `PENDING_REAL_GUEST_EVIDENCE` in the JSON until those exact runtime receipts exist.

Read alongside the LLVM host contract in `docs/TRUSTED_ACTOR_BUFFER_MOVE_V0.md`, the actor DATA vs network codec rules, and the isolate research/admission plan. This specification is not authorization to export private source to an alternate CI organization.

## Mailbox acceptance and rejection (reference-only extension)

Two additional v1 source-free vectors add `queue_send`, `queue_receive`, and `queue_close` semantics: full inboxes reject before any generation/owner change; accepted moves invalidate old sender aliases; closing the mailbox reclaims admitted unread bytes, frees their tenant allocation quota, and rejects future DATA without taking the sender's ownership. They model **sequential** linearization points only. They do not demonstrate racing shutdown, real scheduler tickets, lock correctness, or actual Oreslang source execution. The LLVM host-side admission gate and race CTest are in draft PR #1161.

At this revision the local exact-blob Node reference oracle passes **13/13** tests. Every listed backend remains `PENDING_REAL_GUEST_EVIDENCE`.

## Reader-incarnation lifetime gate

The latest source-free case `reader-incarnation-retirement-pinned-by-foreign-loan` establishes that a borrower cannot retire/reincarnate while holding an immutable loan against another actor's owned buffer. The oracle now tracks retired actor IDs per tenant, forbids future loans to that retired incarnation, and requires release before retirement. Local exact-Git-blob Node execution passed **13/13**, including the negative mutation tests. **No compiled `.ores` or backend runtime evidence** is implied. LLVM native pool/gate regression tests are maintained separately under draft PR #1161.
