# Universal hot-load ABI (UHL-1) — five-backend release gate

**Status: all 40 cases blocked unless actual backend evidence proves otherwise.** This gate complements, and does not replace, `src/actor-hot-reload-matrix.mjs` (the older Graal/LLVM eight-mode, SHARED/PRIVATE slice) and draft ETS/pg work PR #284. Normative proposal: [common-source UHL-1 PR #206](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/206).

## Scope

The matrix is five backends × eight independently required scenarios: Java/Graal; LLVM native AOT/PIC/ORC; Wasm; .NET NativeAOT; Cranelift, each with code-only stable refs; supervisor subtree update; ETS code-only table retention; ETS owner-death heir acknowledgement; suspended await/FFI/ETS generation pins; typed state+table migration; untrusted placement; and delayed unload/quarantine.

A backend is **not conformant** because it cleanly rejects an unsupported feature. `unsupported_confirmed` is meaningful safety evidence but still blocks feature parity. For source backends without actors/ETS, first require native compiler rejection with no generated guest artifact, then implement and exercise the positive end-to-end feature later. A test built from Node, Python, Java host infrastructure, scalar `main()`, a fake compiler or a staged artifact pointer is not a hot-upgrade guest run.

## Contract and receipts

Run `node --test tests/universal-hotload-matrix.test.mjs` to verify receipt *structure and denial behavior*, not runtime parity. `pendingUhl1Report()` is all NOT_EXECUTED. Each executed row requires exact source commit/tree; compiler and guest image SHA-256; CI job/run/attempt/head and at least one executed step; backend-linked guest vs compiler execution distinction; scenario-specific positive and negative receipts. Never silently copy a Java/Graal pass to LLVM, Wasm, .NET or Cranelift. A source-free model can at most report `structurally_passing`; `authenticated_execution` and `production_hot_load_certified` always remain false. Only an independently pinned/executed attestation can change those external conclusions.

## Immediate repair order

1. Reconcile Java current-main #1967/#1972 with runtime supervisor #476 and OTP ETS #1700/#1701; require real stable logical actor and table identity, not only host-only generation gates.
2. Reconcile LLVM #595/#602/#627/#607, add compiler-generated Task/FFI/ETS pin accounting and actually loaded PIC/ORC guest code with the same contract.
3. Keep Wasm #245, .NET #308 and Cranelift #56 explicitly unsupported until their actor and ETS source feature foundations exist. Their initial gate must *execute the native rejection*, not silently accept a candidate.
4. For every backend, prove supervisor crash vs planned upgrade, heir receipt ABA/tenant isolation, empty-mailbox/await/FFI races, malformed image and state/table schema incompatibility, precommit rollback, postcommit fencing and physical unload quarantine. Confirm no dual writer and no split code/route/child/ETS publication.
5. Require stepful exact-head tests and independent review. A zero-step GitHub Actions failure is runner allocation evidence, not a failed guest test or pass. Private cross-org mirrors require explicit independent authorization and exact Git tree/blob readback.

The UHL-1 C header is an in-process *host adapter*, not a universal binary code image or an implicit Wasm import. `query_capabilities` must report the actual supported mode combinations and refuse unimplemented upgrade paths.
