# ETS + local pg v1: six-backend promotion gates

Status: **source-free reference and draft backend slices, not guest parity**.

## Canonical runtime arrangement

- OresVM owns global quotas, root supervision and CONTROL priority; it does not require a dedicated OS master thread.
- IsolateVM owns tenant memory, authenticated actor/table handles and lifetime/quiescence. LLVM in-process trusted domains do not by themselves sandbox hostile native code.
- ActorGroup **membership** is many-to-many and may survive unrelated group close; actor lifecycle ownership, supervisor parentage and socket ownership remain separate.
- ETS is bounded, typed shared storage **outside actor-private mutable heaps**. Private/protected/public modes, owner-death/heir, versioned CAS, per-key atomicity, generation fencing and physical resource-loan retirement require compiler/runtime enforcement.
- Local pg discovers members and performs bounded **best-effort** fanout through each owning actor mailbox; snapshot admission is not a processing acknowledgment and is not an atomic transaction across recipients. Membership can change between snapshot revalidation and send, so every mailbox must check the real actor generation and STOP/quota/authorization independently.
- Mailman is a logical serial CONTROL consumer, not one OS thread per ActorGroup. NIO reactors can wait in kernel readiness APIs, but never execute guest actors; completions enqueue owning-scheduler continuations.
- Default throughput cold start targets zero VM-created carrier, reactor, completion, Mailman, per-actor, per-ActorGroup and per-table threads. Explicit fixed user schedulers and certified RT prestart are separate configurations. Zero tracing GC does not prove hard-real-time WCET.

## GitHub implementation and review references

| Backend | Current draft work | Evidence category | Guest claim |
| --- | --- | --- | --- |
| Java | [#2419](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2419) | ActorGroup snapshot/permit JUnit, existing runtime mailmen | Unverified ETS/pg source |
| LLVM | [#1243](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1243) | ETS scalar host table + versioned CAS; group snapshots; real NativeOresVM mailbox test; cold threads | Unverified ETS/pg source and IsolateVM integration |
| Wasm | [#240](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/240) | Lexer preflight denial before artifact publication | Explicitly unsupported |
| Cranelift | [#45](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/45) | Native CLI run/IR negative checks | Explicitly unsupported |
| .NET Native AOT | [#302](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/302) | Scalar and structured CIL frontend denial tests | Explicitly unsupported |
| Forge | [#164](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/164) | Interpreter/IR/bootstrap denial tests | Explicitly unsupported |

Forge and Cranelift remain distinct backends, even though many older plans call them a single fifth engine.

## Source-free evidence

- Run \`node --test tests/pg-local-reference.test.mjs\`. The exact two GitHub blobs were locally executed with Node 22: **14/14** passing. Includes group ID ABA, late joiners, registry identity collision, permit leak cleanup over 1,000 turnovers, callback throw/Promise rejection and per-recipient partial admission.
- Run \`node --test tests/ets-lifecycle-parity.test.mjs tests/batch-03-ets-stm-reference.test.mjs\` to check ETS ACL, owner/heir revocation, quota, zero-valued entries and versioned CAS. The added ETS reference suite still needs an exact-head executed result; don't borrow Node pg evidence for it.
- Run \`node --test tests/ets-pg-six-backend-gate.test.mjs\` to require every backend guest status remain unverified until real compiler+runtime receipts exist.
- Wasm's exact patched policy and test blobs separately passed **5/5** local Node 22 cases. This is a source-gate result, not Wasm guest execution.

## Native/guest promotion sequence

1. **Restore source-org stepful runner admission.** Failed jobs with \`steps=[]\` are not compilation verdicts. Do not mirror private source to another organization until exact numeric repository ID, reviewed source-tree allowance and security incident closure authorize transfer.
2. Execute LLVM PR #1243 **exact head** GCC/Clang strict C++17 and full CMake/CTest; the ETS CAS race, actual \`NativeOresVM\` mailbox STOP/backpressure test and Linux cold-boot census require ASan/UBSan, interleaving stress and usable test logs. Resolve conflicts with concurrent IsolateVM PRs before integration.
3. Wire ETS authentication to the live \`IsolateVM\` principal (not a guest-provided numeric identity), physical finalization receipts and independent table loans; wire pg snapshots through the typed actor-ref registry and generation-checked mailbox ingress. Bind concurrent close/cancel/restart ordering to explicit linearization points.
4. Execute Java PR #2419 JDK 25 JUnit and Native Image/hybrid guest gates. Compare room membership snapshots, stale capabilities and group closure, not merely host API names.
5. Execute Wasm/Cranelift/.NET/Forge negative guest fixture suites at exact heads and assert failure before runnable IR/wasm/CIL/publication, while harmless text/comments remain accepted.
6. Only after a backend implements guest syntax, typed ownership, isolation and shutdown may the matrix change \`source_guest\` to a verified status. Require identical source fixtures and runtime outcome traces across Java, LLVM, Wasm, Cranelift, .NET and Forge; no source-free model can authorize that promotion.

All PRs should remain **draft** pending stepful exact-head results, isolation/lifecycle proof and full compiled guest parity.
