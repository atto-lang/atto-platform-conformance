# AttoLang SSA loan-use and LLVM field-store evidence gate — V1

**DRAFT. Candidate source-only reconciliation. NO SSA soundness proof, NO compiler-backed guest execution, NO field-store proof.**

This child of conformance #576 extends the closed-world source token model with a separate, strictly bounded checker at `src/ownership-ssa-effect-inventory-v1.mjs`. It is **not** wired to guest lowering or merge approvals.

## What this checker actually establishes

- A caller-supplied straight-line source operation stream has exactly matching typed SSA `indexedUses` entries, with no missing, duplicated, shifted, forged-place, or wrong-mode use sites.
- Unsupported SSA effects such as borrowed call arguments, closure captures, exception/unwind cleanup, task cancellation, suspension frames, actor sends, borrowed returns, phi joins, and branches are rejected until *compiler-authenticated* effect coverage exists.
- A candidate field restoration must have a one-to-one matching `sourceReinitializations`, `mirWrites`, and `llvmStores` record sharing a unique nonzero `writeId` and the same projected field place. Write IDs cannot impersonate issued lexical loan IDs. These JSON records are **claims** — not parsed LLVM IR, IR store dominance proof, or executed guest output.
- It defers to `inspectCandidateClosedWorldLoanUses` for the existing lexical token, move-before-borrow, overlap, opaque-read, and suspension fences.
- Every result, including a syntactically complete candidate, is `ok:false`, `verified:false`, `guestExecutionVerified:false`, and `emittedStoreVerified:false`. Neither a caller's `verified:true` field nor matching synthetic store records can promote the result.

**Unsoundness boundary:** the source can omit an instruction/effect or fake an operation's identity in **both** inventories. No source-only JSON checker can detect that. Source-to-SSA and SSA-to-IR mappings must be minted and checked by the real compiler (including alias/projection paths, calls/captures, exceptional/cancellation edges, phi joins, suspension spills and resumption). Only after real LLVM IR is compiled, read back, inspected for the correct dominating store, Clang-linked and executed on the *same exact head/tree*, can a separate guest execution proof be considered. The Java/GraalVM, .NET NativeAOT, Wasm and Forge/Cranelift families require independent matching guest receipts.

## Authored tests and CI

`tests/ownership-ssa-effect-inventory-v1.test.mjs` contains 30 named source-only checks: 2 candidate examples plus adversarial omissions, duplicates, mismatches, call/capture/exception/cancellation/suspension/actor-send/return/phi/branch effects, missing field stores, forged loan/write IDs, prototype projection, and status spoofing.

- Focused test run: **30/30** executed on fetched exact module/test text in an **isolated V8** harness with a Node assertion shim. This does NOT demonstrate hosted Node or real GitHub Actions execution. No source compiler was executed.
- Existing **193** pre-child source-only groups have **not** been rerun on this child head. The updated source-owned GitHub Actions workflow must execute 30 new groups on actual Node, for **224 total hosted Node groups including the existing CLI subprocess test**, with no skipped/failed test groups. The workflow binds new source and test hashes to the immutable head/tree.
- Source organization Actions pre-job admission has been independently observed to fail with `steps=null`; the infrastructure issue #315 now records a literal GitHub provider annotation identifying a billing/payment-or-spending-limit condition. Do not assert native CTest, compiler guest or five-backend parity success from a workflow that did not start.

## Required next gate

1. Authorized org billing owner identifies and resolves the account payment/spend-limit condition without an unapproved charge, then runs a no-checkout same-source-org canary with nonzero steps.
2. Execute the exact child head/tree in hosted Node; separately execute ten focused LLVM native CTests in LLVM #1524 and all 50 real LLVM+Clang guest programs. Run pinned Java JUnit and guest tests, with matching receipts.
3. Integrate a genuinely complete compiler-generated typed SSA def-use/effect index. Reject unknown edge kinds, multi-block CFG joins, and unproven suspend/cancel/exception/actor ownership cases.
4. Bind explicit field restoration to emitted LLVM store, IR dominance/projection check, runtime output and cancellation/cleanup traces on all five backends. Keep every PR **DRAFT** until independently reviewed.

No private source has been transferred to another organization and no branch protection or review gate has been relaxed.
