# Critical suspension v1 — Java immediate named-Mutex stage

Four **native .ores source fixtures**, byte-identical to files in Java PR #2433 at commit `c60348b24870a70eff455cd7dd2d1e7656bd2a4f`, with pinned Git blob IDs.

The first stage attempts only `try critical gate {...} else {...}` in **synchronous, non-actor** functions where `gate: Mutex<T>`, with an explicitly call-free scalar body. It does **not** authorize queued `critical {}`, actor handler state, async/suspends callers, SharedMutex, generic dispatch, I/O, FFI, state loans, or callback effects. It is deliberately not the full canonical critical language construct.

The Java PR has a JUnit test that reads `positive-try-critical-named-mutex.ores` from disk and attempts actual Graal guest execution, expecting output `31`. This test has not yet executed on stepful exact-head CI.

All five `target_verified` fields in `manifest.json` remain false. The source-free Node test verifies fixture identities and prevents an accidental claim of guest parity, but does not execute a compiler.

**Next:** stepful exact-head Java guest and LLVM/Cranelift/.NET/Wasm reject-versus-execute assertions, followed by full scheduler-owned queued critical lowering and cross-backend conformance.

Additional Java security hardening at this head explicitly traverses critical bodies **and** busy fallbacks in the capability checker, ownership/capture logic and build optimizer. Added two regression tests preventing bypass of denied SharedMutex capability or removal of fallback-only function references. GitHub CI run 41368875820 job 125034808914 again reports zero executed steps: all source fixture results remain unverified.

Latest gate-identity hardening forbids reading, moving, or rebinding the named gate inside its own protected body and includes three new negative Java tests. Java exact-head fast-ci #41369042167 job #125035311708 again reported zero executed steps; the guest fixture oracle remains unverified.
