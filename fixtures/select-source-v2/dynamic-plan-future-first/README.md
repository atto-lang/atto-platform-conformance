# Dynamic plan Future-first source gates

These exact sources are proposed cross-compiler targets, not execution receipts. The positive case pins its descriptor snapshot before mutation; explicit await returns the selected old value. The two negatives must reject before emitting an executable guest. The positive must execute the actual compiled guest and exit 42; no host simulation.

Target repositories: atto-source.java (JVM and Native Image), atto-source.rs (native and wasm32 compiler), atto-source.wasm (browser Worker), atto-source.llvm (native), atto-source.net (CoreCLR and NativeAOT), atto-source.forge, atto-source.cranelift, atto-source.js, atto-source.atto, atto-source.realtime, atto-source.hdl. Every target is NOT_EXECUTED for these exact files; hardware/real-time restrictions must be explicitly reported rather than counted as positive support.

Require exact compiler head/root tree, source blob, toolchain, command, nonempty executed steps, actual guest result or no-artifact rejection. No runtime-only or model result qualifies. Broader map keys, cancellation, and generation fencing require separate fixtures. Rust candidate: atto-source.rs#672; spec proposal: atto-spec#267.

The `pending-at-exit.atto` probe must not report successful guest exit with an unresolved plan invocation. Rust v2 proposes terminal panic 6; the portable structured cancellation/result contract remains unresolved. Do not treat rejection as positive runtime parity. Apply this probe to all eleven repository targets alongside the existing three cases. The separate `../dynamic-plan-retirement-token-oracle.mjs` checks terminal arbitration and stale invocation identity independently of compiler execution.
