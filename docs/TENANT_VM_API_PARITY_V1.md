# TenantVM API parity v1 — all source toolchains

**Status:** draft, source-free cross-backend contract; **NOT** untrusted TenantVM certification.
**Updated:** 2026-11-11.
**Machine-readable source:** [tenant-vm-api-parity-v1.json](../contracts/tenant-vm-api-parity-v1.json).

## Canonical contract

The trusted **OresVM** root owns one **TenantVM** per tenant incarnation.
One TenantVM owns multiple independently governed **actors**. The TenantVM's
identity includes tenant principal, monotonic generation and unforgeable
root-issued authority. Actors maintain sealed state and private mailboxes.
Cross-tenant references and pointers are rejected; any cross-tenant message
must pass an authenticated, bounded serialized host broker.

**Do not** mistake `TenantVM` names or compatibility aliases for verified
isolation. Native/JIT code, ordinary JVM/CLR contexts, Node Workers and actor
arenas do not by themselves meet the shared-process untrusted isolation v2
contract. Unsupported backends refuse hostile tenant admission.

## Source changes proposed in independent backend draft PRs

| Backend | Canonical integration surface | Honest status |
| --- | --- | --- |
| Java/GraalVM | `open_trusted_tenant_vm` delegates to existing `open_trusted_tenant` | Trusted polyglot Context; not verified untrusted VM |
| LLVM | `TenantVM`/`TenantVMConfig` type aliases, `OresVM::TenantVMHandle`, `create_tenant_vm` | Trusted native host cage prototype |
| Wasm | `TenantVMHandle`, `TenantRegistry::admit_tenant_vm` | Experimental Wasmtime Store/Instance scalar host |
| Forge | `TenantVMHandle`, `OresVM::create_tenant_vm`; rejects `.` and `..` tenant IDs | Trusted native host only |
| .NET Native AOT | `CreateTrustedTenantVm` delegates to `CreateIsolate` | Trusted CIL host; protected NativeVmIsolate still refused |
| Cranelift | `TenantVMHandle`, `OresVM::create_tenant_vm` | Trusted scalar native JIT only |
| JavaScript | Explicit rejection of `tenant-vm` and `TenantVM` worker modes | Trusted Workers only |
| Rust scalar compiler | `TENANT_VM_RUNTIME_SUPPORT = UNSUPPORTED` | No tenant VM/actor lowering |
| HDL | `TENANT_VM_RUNTIME_SUPPORT = UNSUPPORTED` | No hosted actor VM or tenant execution |

The historical functions and type names remain exported. The new aliases
route through *existing* trust checks; they must not create a new permission
path. ABI/wire/schema IDs remain unchanged.

## Promotion gates

1. Execute the **real** AttoLang compiler/checker and generated guest (at
   immutable PR heads) with two tenants, multiple actors per TenantVM and
   private state/mailbox checks. Host-only or source-free simulations do not
   establish guest parity.
2. Prove an untrusted guest is validated against an actual private memory
   boundary and effective authority. Untrusted native/CIL must remain
   refused until proved safe.
3. Test cross-root/cross-generation stale and forged tokens, quotas,
   queued/cancelled work, borrowed I/O loan retirement, secure serialization
   and tenant restart.
4. Interrupt a spinning or trapping TenantVM *independently* and verify
   its neighbor survives without process termination.
5. Verify CI jobs recorded **nonzero** executed steps on exact tested heads.
   Zero-step failures mean `NOT_EXECUTED`, not a runtime regression.

Current status: `untrustedTenantParity=NOT_VERIFIED` for all toolchains.
Citing the status table is **not** a claim of production support.

## Quiescence hardening checkpoint (2026-11-11)

Wasm [draft PR #478](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/478)
now prevents actor admission and stop callbacks from refunding host actor
slots during TenantVM quiescence, quarantine, or carrier failure. Reservations
are reclaimed only after confirmed physical Worker termination, and the
host's aggregate ledger is checked before an old tenant ID can be reused.

Three deterministic controlled-transport local tests reproduced the old
premature-refund behavior and passed with the patch. The new test
`tests/trusted-tenant-vm-retirement-races.test.mjs` exercises the *real*
Node Worker receipt and failed-termination behavior when CI is available.

The exact committed patch/test blob IDs and `NOT_EXECUTED` real-Worker status
are machine-readable in `contracts/tenant-vm-api-parity-v1.json`.
Neither local control-double tests nor zero-step GitHub Actions runs certify
independent untrusted-tenant execution. Native Wasmtime/Graal isolation and
real compiler-generated multi-actor execution remain open security gates.
