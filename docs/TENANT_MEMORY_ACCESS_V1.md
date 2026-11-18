# TenantVM accidental-memory-access contract v1

**Status:** proposal, source-free conformance only. Parent: [tenant-isolation-v2.json](../contracts/tenant-isolation-v2.json). Machine-readable requirements: [tenant-memory-access-v1.json](../contracts/tenant-memory-access-v1.json). Run `node --test tests/tenant-memory-access-v1.test.mjs` to validate the contract's structure, **not** a backend's memory safety.

## Threat model and decision

Target V8-like *logical isolation* between mutually independent tenant heaps in **one OS process**. We primarily prevent accidental reads/writes and alias retention by correctly compiled, safe-language actors. Untrusted actors cannot use native code, FFI, arbitrary host imports or unsafe pointer operations. CPU cache/side channels, a compiler or host-runtime compromise, and native memory-corruption exploits remain outside the guarantee. Threads are shared scheduling carriers, never security identities.

The trusted runtime can use native pointers internally. **Untrusted compiled guest code must not have unrestricted native addressing.** Object and actor references are opaque at the language boundary and scoped to (root authority, tenant incarnation, actor/region owner, generation). The pointer-width or handle layout is not a security mechanism unless the compiler and runtime actually enforce its checks.

## Implementation stages

1. **Frontend/HIR/MIR:** reject borrow escapes across actors or TenantVMs; forbid implicit `share!`; `copy!!` must sever every mutable nested alias (support shared/cyclic graphs or explicitly reject them). `take!` across TenantVMs must copy or use a trusted atomic ownership protocol that revokes previous aliases; otherwise refuse. Forbid integer-to-pointer forgery in guest code.
2. **Guest lowering:** validate the guest and every load/store effective address, including offset+length arithmetic, actor subregion bounds, and host-call buffers. A guard page alone is insufficient: an invalid address may land in mapped host or neighbor memory without faulting. Only a trusted validator/producer may mark a module eligible for untrusted execution. No arbitrary native shared-library admission based only on a caller-supplied checksum.
3. **Runtime host calls:** treat guest-provided offsets, actor IDs, sizes and capabilities as untrusted. Checked addition precedes every copy. **A host message-copy source must lie within the sending actor's region, not merely within committed pages of its TenantVM:** otherwise the host becomes a read oracle for a sibling's private state. Never return a raw host pointer or hold a guest pointer after a suspension, cancellation or memory growth. Distinguish immutable globally shared code from mutable tenant data. See [LLVM regression #1891](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1891) (stacked on #1343; not yet executed).
4. **Scheduler:** pin execution authority to the turn, not the pthread. On *every* carrier switch (including exception, cancellation and early return), rebind the tenant heap base and actor context and invalidate previous guest TLS/cached state. A suspended continuation's owning tenant and generation remain explicit; never resume under the next tenant's context.
5. **Retirement:** close admission, await physical carrier termination/quiescence and resource-loan drain, invalidate handles, then release or scrub recycled memory. Never refund quota while code may still reach memory.

## Backend consequences

- **LLVM native:** existing [LLVM #1343](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1343) uses actor bounds checks and a tenant cage, but explicitly demonstrates a C guest breaking its addressing rule can read mapped host memory. The direct native ABI is **not a production untrusted boundary**. Validate real Wasm/lowering output and pin provenance before claiming confinement. Treat the existing `rule_breaking_read_is_contained_only_if_it_faults` case as evidence of the remaining limitation, not a successful sandbox check.
- **Java/Graal:** require a real Graal isolate with per-tenant heap and permission controls, not merely one `Context` per tenant in a shared engine. Verify compiler code paths and cross-context host reference denial.
- **Wasm:** validate module memory/import rules; ensure tenant actor instance/store state cannot cross between carriers. A Node Worker alone is not an untrusted safe-language sandbox when it exposes host APIs.
- **.NET:** use a validated Wasm tenant execution substrate where necessary; `AssemblyLoadContext` and trusted NativeAOT domains do not independently protect mutually untrusted tenants.
- **Forge/Cranelift/native JIT:** fail closed for untrusted actor execution until confinement is independently proven. Trusted actor execution remains supported according to backend policy.

## Promotion requirements

Every backend claiming untrusted TenantVM must execute all `mandatoryScenarios` from the JSON contract against real compiled safe-language guest code, including two simultaneously active tenants, independent actors, negative out-of-bounds cases, deep-copy graphs, pthread reuse and cancellation, retirement, and neighbor survival. Publish compiler/runtime digests, source commit/tree, platform, CI steps and logs. Structural Node tests here and a zero-step Actions run are **NOT_EXECUTED** backend evidence.

**Non-goals:** claiming ordinary native pointers are hardware-protected; adding an OS process per tenant by default; accepting an unsafe guest merely because FFI keywords are unavailable in the source language.
