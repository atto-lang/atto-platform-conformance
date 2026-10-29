# Actor buffer ownership and cross-tenant copy contract v1

**Status:** SOURCE-FREE REFERENCE ORACLE ONLY. No LLVM, Java, Wasm, Forge or .NET guest compiler/runtime evidence has been supplied by this document or its Node tests.

The canonical v1 test vectors are in `contracts/actor-buffer-transfer-v1.json`; executable source-free reference checks are in `tests/actor-buffer-transfer-v1.test.mjs` and can be run with:

```shell
node --test tests/actor-buffer-transfer-v1.test.mjs
```

The reference tests verify eight situations: zero-payload-copy exclusive ownership move; actor incarnation mismatch; immutable loans blocking mutation/move/drop; scoped and reader-bound loan revocation; foreign-tenant handle rejection; heap/slot quota enforcement; retirement with outstanding loans; and explicit cross-tenant copy that remains independent of its source.

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
