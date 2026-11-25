# AttoLang tenant isolation: proof classes and offline receipt checks v1

This **source-free, non-promoting** policy is coordinated under [oreslang-platform-conformance #616](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/616). It does not modify the nine existing backend isolation PR heads. Oreslang repository names, legacy `.ores` files and AttoLang language naming coexist.

## The security boundary

- **Host model** (`host-model`): the trusted-host allocation-grant helper rejects wrong allocation, actor, tenant, incarnation, overlap, overflow, retirement and ABA. It proves *neither* actual compiled guest enforcement *nor* tenant isolation.
- **Compiler guest** (`compiler-guest`): actual compiled `.atto` guest memory loads, stores, indirect access and FFI/imports are forced through a verified confinement check, without raw pointer escape. Every backend must demonstrate the compiler lowering and executed negative tests.
- **Tenant memory** (`tenant-memory`): a compromised guest can freely corrupt its permitted guest heap but cannot corrupt another tenant, executable code, host metadata, capability tables or broker; sibling crash survival, memory quotas and CPU budgets are exercised in a real containment environment.
- **Process fault** (`process-fault`): an independently protected process or microVM denies disallowed host resources, survives native crashes and cleans up descendants. A Graal `Context`, Graal Native Image isolate, JS Worker, allocator object registry, or shared scheduler carrier is **not** this OS-fault domain.

Actor-owned heaps and borrowed references are static ownership guarantees, not hardware/OS memory protection. Runtime/allocator/supervisor must separately quiesce actor turns, scrub retired allocations, invalidate capability generations, and fence any FFI pins. Native code with arbitrary pointers can bypass the host helper. A shared Wasm linear memory does not provide per-actor protection against arbitrary guest memory reads.

## Threat-test checklist

The versioned `contracts/tenant-sandbox-evidence-v1.json` fixes **22 required case identities** across the four proof classes. Claims at higher classes require the cases from every lower class. Each case must identify whether it ran in a host model, compiled guest or real fault environment. No backend can claim unimplemented guest actor execution based solely on the shared host helper, especially `oreslang-source.hdl`.

Execution provenance must be pinned to exact repository/head, nonzero steps, non-skipped success, a specific Actions job/attempt (or host-local **host-only** run), and a compiled artifact digest for non-host claims. An offline JSON file is **self-attested** even if it says `success`; the inspector can validate its shape, not authenticate GitHub, prove which compiled artifact ran, validate source confidentiality, or prove the claimed exploit really executed.

Run locally:

```sh
node --test test/tenant-sandbox-evidence-v1.test.mjs
node bin/inspect-tenant-sandbox-evidence-v1.mjs /path/to/receipt.json
```

The output has `shapeValid` and `classification`; `independentlyVerified`, `promotionAllowed`, and `untrustedPlacementAllowed` are **always false**. Do not turn `shapeValid: true` or a CLI exit code of zero into a merge approval, an untrusted deployment authorization, a release certificate, an independent review or proof of real guest isolation. Other independent source-owned and authenticated CI gates remain required.

## Handoff to backend agents

1. Java/GraalVM: connect actor-grant authority to actual compiled memory ops, imported host access, and tenant isolate lifecycle. Test actual Native Image and reject unsupported `UNTRUSTED` host contexts.
2. LLVM, Forge, Rust, Cranelift: prove complete guest load/store and indirect-control-flow confinement at AOT/JIT boundaries, stack guards, no raw host base/FFI escape, plus process fallback for hostile native code.
3. .NET NativeAOT: enforce grants on real dispatch frame/object paths and imports; keep hostile-tenant admission disabled until a verified physical barrier exists.
4. Wasm/JS: pin actual compiled guest + Node/browser runtime evidence; enforce real instance-bound memory/host imports. Browser Workers and Node worker threads alone are not tenant OS isolation.
5. HDL: limit receipts to host reference proof until compiled actors exist.
6. Volucro: keep tenant process, broker, resource and OS domain claims separate from trusted-host `DomainId` labels; independently verify syscall, filesystem, network and process-tree containment.

Do not modify other agents' draft branches or export private source into public CI mirrors. Exact-head executed tests, independent security review and existing release holds govern every backend.
