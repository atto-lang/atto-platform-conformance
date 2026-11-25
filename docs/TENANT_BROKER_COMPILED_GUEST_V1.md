# Canonical five-backend tenant broker compiled-guest conformance v1

This is an acceptance contract, NOT implemented guest enforcement.

Contract: contracts/tenant-broker-compiled-guest-v1.json
Contract-only tests: node --test tests/tenant-broker-compiled-guest-v1.test.mjs
Source evidence gate: https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/449 (stacked on #448).
Verified structural-only source-blob carrier run: https://github.com/voxletra/voxletra-e2e/actions/runs/42663785722 (26/26 Node tests).

## Backend integration ledger

| Backend | Required compiler-produced guest integration | NOT sufficient |
| --- | --- | --- |
| Java/GraalVM | Atto source through Java/Truffle compiler into real tenant isolate; broker authentication and dispatch | Host reference, context creation alone |
| Wasm | Atto compiler-produced module in bounded per-tenant Store, actual broker import and delivery | Handcrafted Wasm, Node Worker-only |
| LLVM | Atto compiler-produced isolated guest, authenticated broker ingress and bounded native/validated boundary | C11 trusted domain ID alone |
| Forge | Admitted isolated JIT/AOT worker with broker and revocation fences | In-process untrusted native JIT |
| .NET | NativeAOT-produced Atto actor dispatch with trusted broker and tenant isolation | AssemblyLoadContext or host NativeMemory checks |

Required cases: aggregate tenant quota survives actor restart; revocation immediately before dispatch denies and refunds; forged, stale or replayed ActorRef is denied; authorized broker DATA delivers exactly once; neighbor tenant remains live after a denial.

## Existing policy conflict that must be resolved

The existing contracts/tenant-isolation-v2.json explicitly selects validated Wasm or Truffle isolates in a shared OS process and says process sandboxing is optional. LLVM/.NET untrusted tenants use validated Wasm; Forge currently has no untrusted path. This new conformance contract does NOT silently supersede that choice. The newer LLVM/Forge/.NET OS-process containment proposal requires a reviewed backend policy decision and new executed proof. NativeAOT, CIL or in-process JIT are not automatically safe as hostile guest boundaries.

Until this review, keep untrusted direct native/CIL guest entry denied, Forge cross-tenant access denied, and all guest-supplied tenant identity claims untrusted. Host-only or synthetic receipts are NOT_VERIFIED.

## Evidence chain

Atto source -> compiler -> guest artifact -> isolated tenant runtime -> authenticated broker -> verified quota/revocation/delivery.

Each missing stage is NOT_VERIFIED even when a source-free unit test exits zero. The private-carrier CI above verified five mirrored Git blobs, NOT the full source tree or actual compiled-guest enforcement. Complete source/carrier provenance, executed guest jobs and independent trust-boundary review remain required.
