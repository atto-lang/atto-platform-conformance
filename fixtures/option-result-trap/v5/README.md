# Caller-side Result trap

`trap!` and `trap` return `Result`. An existing Result passes through the boundary and an Option remains a successful payload. `throw!` requires an owned `Throwable`, and an ordinary throw is observable through the resulting `Err`. A guest panic escapes the trap boundary.

Run the same fixture bytes in each backend. `preserve-result.atto` and `catch-guest-error.atto` should return 7. The two `reject-*` cases must reach a semantic diagnostic for the violated rule. The panic case must be admitted and report an uncaught guest panic at execution.

Run `node bin/verify-trap-result-v5.mjs` to check the pinned Git blobs and the expected outcomes in the manifest. Record compiler commit, root tree, binary identity, and native execution for each lane. Java JVM execution is recorded separately from the required native backends.

[Shared semantic decision](https://github.com/atto-lang/atto-spec/pull/151) · [Java implementation](https://github.com/atto-lang/atto-source.java/pull/1704)
