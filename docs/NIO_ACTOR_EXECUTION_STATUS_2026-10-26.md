# NIO / physical actor-turn implementation status — 2026-10-26

This file is **non-normative implementation status and review evidence** for the portable contract in `contracts/v1/NIO_ACTOR_EXECUTION_V1.md`.

Do not copy implementation-specific statements from this file into the portable contract. A backend carrying the normative contract does not thereby claim feature completion.

## Exact review identities

| Backend | Repository / review item | Exact commit | Exact Git tree | Contract blob at that commit | Capability classification |
| --- | --- | --- | --- | --- | --- |
| Java/GraalVM | `oreslang-source.java#2074` | `778057cd7b7f0418c75e1ccb29a8e1a9ae9d5861` | `287bcd69f77bffc4850477ac05add5b46b2cfc4e` | `e411882d9eccd3445485705a395f217b0a9ecfef` | Candidate: NIO/carrier/Future slice implemented; runner qualification pending |
| LLVM | `oreslang-source.llvm#880` | `a19f908555043ba5039a32104e344a6f99bd61d4` | `6042d6b86b158d76b08836c2f1b8b142d177edd9` | `547a2dbf7119eb90f56da3931b68fb8d8e3fd485` | Native epoll/lifecycle implemented; source Future/await incomplete |
| .NET | `oreslang-source.net#58` | `4a1c26dec79100823c21a45ede263ad9d0d41ca6` | `49897d1626e52c3249ed4e4db24074176cba47a1` | `547a2dbf7119eb90f56da3931b68fb8d8e3fd485` | Host turn credits only; guest NIO/source actors fail closed |
| WASM | `oreslang-source.wasm#54` | `58b8b03865baf146087fcf6e29520179ccc3b8de` | `ba79cf3e61d777f77d08edd5af29299c6e4aab24` | `547a2dbf7119eb90f56da3931b68fb8d8e3fd485` | Guest NIO/reactors/source actors fail closed |
| Forge | `oreslang-source.forge#52` | `e615f7cea2098022c8afdee41b9c75e3ec28ab33` | `612af9723745028f24e0579b1c304f7f31343326` | `547a2dbf7119eb90f56da3931b68fb8d8e3fd485` | Host mailbox/turn credits only; guest NIO/source actors fail closed |

## Java-specific implementation classification

The following are Java implementation details, not portable language semantics:

- `-Dores.runtime.carriers.global.max=N` accepts 5..256 only for the eligible JVM/non-affine topology.
- Java's permit coordinator currently accounts CONTROL, PRIVATE, SHARED, UNTRUSTED, and LIFECYCLE/bootstrap host workers, with protected reserve/borrowing rules.
- bounded VM-owned physical-STOP virtual-thread revokers are not dedicated platform carriers and therefore do not consume the Java platform-carrier permit pool; if their worker class changes, the accounting/disclosure must change with it.
- current Java CONTROL startup/prestart policy, standalone completion-pool compatibility behavior, cold bootstrap mechanics, and exact close/self-join implementation are Java topology details.
- Java's concrete shutdown realization drains VM NIO completion delivery before actor/native physical retirement.

## Portable decisions proposed by platform-conformance #173

Pending independent ratification, the proposed portable interpretation is:

- bounded/prestarted CONTROL is permitted as an implementation/profile policy; zero CONTROL residency is not a source semantic;
- completion isolation is defined by bounded host bookkeeping, no guest execution on reactor/completion workers, owning-scheduler resumption, and truthful worker accounting rather than an absolute zero-helper rule;
- a claimed VM-wide carrier budget must be one real aggregate authority for every included domain;
- LOW/default remains single-flight; MEDIUM/HIGH require proven per-turn isolation or fail closed;
- Future-to-await race, generation, cancellation, and owning-scheduler guarantees are portable when the capability is implemented;
- admitted async work must settle/cancel/account before the owning execution domain retires, while exact backend teardown phases remain implementation-specific.

## Metadata discrepancy retained for audit

The prose descriptions of .NET #58, WASM #54, and Forge #52 have referenced contract blob `9d4d6d3d7638022a5570618f824f3182b1ffe641`. Direct Git-object reads at the exact commits above produced `547a2dbf7119eb90f56da3931b68fb8d8e3fd485`. Use exact Git objects, not PR prose, as immutable evidence.

## Java qualification status

Java #2074 remains DRAFT. Fresh exact-head source-org runs on `778057cd7b7f0418c75e1ccb29a8e1a9ae9d5861` failed before executing any job step (`steps=null`). They are classified NOT_EXECUTED / runner-admission failures and provide no compiler/runtime pass or fail verdict.

Required implementation qualification remains separate from semantic ratification: focused carrier/NIO/Future/retirement/heap proofs, full Maven verify, Graal conformance, and Native Image/AOT/hybrid/isolate execution on the exact reviewed candidate.

This status ledger grants no private-source transfer authority and does not supersede active security incident/approval gates.
