# Java-style zero-object-copy calls: cross-backend admission v1

**TARGET ONLY — 26 cases, 11 Atto source compiler repositories, all NOT_EXECUTED.** This is a test-plan/CI metadata gate, not an implemented compiler feature or a proof of memory safety.

Ordinary nonprimitive calls pass checked temporary shared loans to the original object; they never synthesize `copy!`, `copy!!`, `share!` or `take!`. ABI copies of a small handle word are allowed but never create an independently droppable owner. Writable `mut` calls require exclusive, sealed write-through authority. `Pointer<T>` is an invariant, non-Copy, non-Sendable checked capability; borrowed formal parameters cannot `unref!` or `close()` it. The Ref32 token does not encode origin actor: sidecar provenance and incarnation checks are mandatory.

Contract: [atto-spec #185](https://github.com/atto-lang/atto-spec/pull/185), [#89](https://github.com/atto-lang/atto-spec/pull/89), [#18](https://github.com/atto-lang/atto-spec/pull/18), and [#39](https://github.com/atto-lang/atto-spec/pull/39).

The machine-readable [manifest](../contracts/java-style-no-copy-passing-v1.json) lists allowed/forbidden outcomes and their required oracle. Run `node --test tests/java_style_no_copy_passing.test.mjs` for **metadata-only validation**. This does not compile or execute an AttoLang guest.

## Promotion gate

1. Implement each admitted case as a standalone real `.atto` fixture tied to an exact compiler SHA and feature profile; no generic syntax-error substitution for an ownership diagnostic.
2. Positive cases must compile and execute with correct object identity, write-through result and payload-allocation counters. ABI spill/temporary words do not count as graph copies. Negative cases must fail with the expected typed diagnostic and emit zero guest artifacts.
3. Test both regular and exceptional/cancellation control flow, actor incarnation, same-numeric Ref32 collisions, nested aliases, virtual/FFI effects and runtime release.
4. For native variants include ASan/UBSan, AOT and allocator instrumentation. Keep all 11 backend statuses independent; no fan-out promotion of one Rust/Wasm result to Java, LLVM, .NET, Forge, JS, HDL, realtime or the other compilers.
5. When source-org Actions jobs fail with zero steps, use an authorized private carrier with funded Actions and token-free exact blob/tree mirroring. Verify the exact source SHA and actual nonzero step logs before reporting any guest case executed.

**No backend is certified as sound by this registry.** Pending borrowing, aliasing, cleanup and cross-domain proofs must fail closed.
