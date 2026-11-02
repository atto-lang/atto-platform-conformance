# Critical suspension v1 — Java immediate named-Mutex stage

Four **native .ores source fixtures**, byte-identical to files in Java PR #2433 at commit `4c3c7f84436d0999ba5dd9079a4453689c96acfb`, with pinned Git blob IDs.

The first stage attempts only `try critical gate {...} else {...}` in **synchronous, non-actor** functions where `gate: Mutex<T>`, with an explicitly call-free scalar body. It does **not** authorize queued `critical {}`, actor handler state, async/suspends callers, SharedMutex, generic dispatch, I/O, FFI, state loans, or callback effects. It is deliberately not the full canonical critical language construct.

The Java PR has a JUnit test that reads `positive-try-critical-named-mutex.ores` from disk and attempts actual Graal guest execution, expecting output `31`. This test has not yet executed on stepful exact-head CI.

All five `target_verified` fields in `manifest.json` remain false. The source-free Node test verifies fixture identities and prevents an accidental claim of guest parity, but does not execute a compiler.

**Next:** stepful exact-head Java guest and LLVM/Cranelift/.NET/Wasm reject-versus-execute assertions, followed by full scheduler-owned queued critical lowering and cross-backend conformance.
