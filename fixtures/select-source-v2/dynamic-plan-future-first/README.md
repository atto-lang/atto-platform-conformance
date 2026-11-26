# Dynamic plan Future-first source gates

These exact sources are proposed cross-compiler targets, not execution receipts. The positive case pins its descriptor snapshot before mutation; explicit await returns the selected old value. The two negatives must reject before emitting an executable guest. The positive must execute the actual compiled guest and exit 42; no host simulation.

Target repositories: atto-source.java (JVM and Native Image), atto-source.rs (native and wasm32 compiler), atto-source.wasm (browser Worker), atto-source.llvm (native), atto-source.net (CoreCLR and NativeAOT), atto-source.forge, atto-source.cranelift, atto-source.js, atto-source.atto, atto-source.realtime, atto-source.hdl. Every target is NOT_EXECUTED for these exact files; hardware/real-time restrictions must be explicitly reported rather than counted as positive support.

Require exact compiler head/root tree, source blob, toolchain, command, nonempty executed steps, actual guest result or no-artifact rejection. No runtime-only or model result qualifies. Broader map keys, cancellation, and generation fencing require separate fixtures. Rust candidate: atto-source.rs#672; spec proposal: atto-spec#267.
