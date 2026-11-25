# AttoLang untrusted JIT: adversarial research and execution matrix (2026-11-06)

**Status:** source-free conformance proposal. 16 adversarial cases, five backends, ALL
`NOT_EXECUTED`. The Node validator tests receipt *shape*, not any compiler,
runtime, OS sandbox, authenticated build, real negative execution or release proof.

## Primary-source findings, separated by evidence strength

- **Demonstrated (USENIX Security 2025):** [Yu et al., resource isolation attack surface](https://www.usenix.org/conference/usenixsecurity25/presentation/yu-zhaofeng) experimentally exploit WASI/WASIX interfaces to exhaust host resources or burden other co-tenants. Require hostcall, resource-table, IO and OS-level quotas, not guest heap alone.
- **Demonstrated research prototype (OSDI 2025):** [DeCl](https://www.usenix.org/conference/osdi25/presentation/yedidia) implements native-code verification and deterministic preemption. It is NOT an available AttoLang engine.
- **Evaluated architecture (NSDI 2026):** [Wasabi](https://www.usenix.org/conference/nsdi26/presentation/baqershahi) packs multi-tenant Wasm workloads densely; its performance evaluation is not proof of immunity to JIT sandbox escape.
- **Prototype on modified RISC-V hardware (2026):** [JITDomain](https://www.sciencedirect.com/science/article/pii/S0141933126000426) reports instruction domain checks, stack isolation and syscall filtering on CVA6. Not commodity hardware deployment or general native containment.
- **Deployed mitigation, not total isolation:** [V8 Sandbox](https://v8.dev/blog/sandbox) hardens in-process heaps and enables targeted memory-corruption fuzzing; the paper explicitly does not remove every escape path.
- **Confirmed upstream advisories:** Wasmtime [SSA index overflow CVE-2026-115889](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-897f-g5gm-fmxm) (fixed 43+ or 36.0.19); [AArch64 large br_table CVE-2026-115893](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-mghf-wjfp-p5xm) (fixed 49.0.4 / 48.0.7 / 36.0.19); [WASI host exhaustion GHSA-852m-cvvp-9p4w](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-852m-cvvp-9p4w); and [borrowed resource memory leak GHSA-6fr9-xmw9-5352](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-6fr9-xmw9-5352) (fixed 49.0.5).
- **Upstream engineering caveats:** [fuel vs epoch](https://docs.wasmtime.dev/examples-interrupting-wasm.html), [epoch checks at bulk data operations](https://docs.wasmtime.dev/api/wasmtime/struct.Config.html), and [ResourceLimiter not covering all host allocations](https://docs.wasmtime.dev/api/wasmtime/trait.ResourceLimiter.html).

## GraalVM implementation report (Oracle primary source)

[Oracle GraalVM 25 sandboxing guide](https://docs.oracle.com/en/graalvm/jdk/25i/docs/security-guide/sandboxing/)
documents `SandboxPolicy.UNTRUSTED` with dedicated guest isolate and
additional hard/soft heap, CPU time, AST depth, stack frames, thread count,
statement-count, output/error byte, and host-access restrictions.
`sandbox.MaxCPUTime` checks are periodic and can overrun around GC; statement
counts do not imply bounded work inside a single builtin or native hostcall.
`Context.resetLimits()` can reset selected CPU, statements and stream budgets,
so the Atto supervisor must not accidentally expose reset authority across a
yield/resume or tenant generation. Test `UJI-07`, `UJI-10`, `UJI-12`,
`UJI-15` with actual Graal `UNTRUSTED` policy and malicious host-call
scenarios, not merely default `TRUSTED` contexts.

The same guide documents optional experimental `engine.IsolateMode=external`
for process-separated isolates and cautions about shared engines, side channels
and host entry points. These are **documented platform capabilities**, not
proof that AttoLang currently wires or tests them.

**Version applicability correction:** UJI-01 (CVE-2026-34971,
[AArch64 memory64 lowering](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-jhxm-h53p-jm7w))
and UJI-02 (CVE-2026-115889, pre-v43 SSA bit-packing) are
**regression/differential tests for historical code-generation defects**;
they are NOT known vulnerabilities in the repository's current Wasmtime
49.0.3 dependency. In contrast, UJI-03 (CVE-2026-115893, AArch64
large `br_table`) and component borrowed-resource memory exhaustion
(GHSA-6fr9-xmw9-5352) **do affect** 49.0.3. The runtime/precompiler
security upgrade target on the existing PRs is 49.0.5, with both lockfiles
and actual native tests required. An AArch64 regression runner must be
separate from an x86_64 run.

## Implementation order

1. **P0 dependency and code isolation:** Keep [Wasm #213](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/213) and [PR #210](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/210) as the security update work; target Wasmtime **49.0.5**, not a duplicate 49.0.4 patch. Confirm both Cargo locks via actual Rust/Cargo and independent review. Execute UJI-01..05 on actual target architectures. A bare Cranelift JIT is not hostile-code isolation.
2. **P0 quota:** Limit compiled code/RSS/CPU, hostcalls, WASI/WIT handles/borrows, guest stack/memory/tables, mailboxes and output buffering; capture actual high-water metrics. UJI-06..09.
3. **P0 interrupt/cancel:** Use deterministic fuel where required, epoch for cheaper periodic yields, independent wall watchdog, and bounded bulk transfers. Preserve budget across every suspend/carrier handoff ([Java #402](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/402)); no trusted carrier hostage to a blocking hostcall. UJI-10..15.
4. **P0 evidence:** exact Atto source HEAD and root tree, emitted image SHA-256, compiler and engine versions, nonzero executed jobs, neighbor survival, negative oracle, and **independent review**. UJI-16.

See [manifest](../contracts/untrusted-jit-adversarial-v1.json) and run
`node --test tests/untrusted-jit-evidence-v1.test.mjs`.
Binary Wasmtime CVE regression tests get `BACKEND_ADVERSARIAL_BINARY_EXECUTED`
and never satisfy `REAL_ATTOLANG_GUEST_EXECUTED`; real AttoLang parity requires
actual compiled `.atto` guest execution per backend.

## Explicit security decision still open

[Current tenant isolation v2](TENANT_ISOLATION_V2_SHARED_PROCESS.md)
permits external hostile tenants in the same process with per-tenant VM
isolation, explicitly accepting that a JIT/compiler bug can compromise all.
That is a documented *risk acceptance*, NOT an isolation proof. For truly
mutually hostile tenants, review OS-sandboxed process/microVM failure domains
and data-confidentiality requirements before production. Do not silently
change the established shared-process policy in this source-free PR.

**CI caution:** workflows with `runner_id=0` / `steps=[]` are admission
failures, not tests. This matrix returns `STRUCTURAL_ONLY_UNAUTHENTICATED`
even for perfectly shaped receipts: authentic run provenance and independent
source/export authorization must be checked outside the JSON model.
