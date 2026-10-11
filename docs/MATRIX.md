# Platform-conformance matrix and evidence gates

The test manifest is a target fixture inventory. Source files are not proof of compiler support.

| Pair | Currently executed by CI | Status |
| --- | --- | --- |
| Java/Graal source checking | No | Requires pinned compiler and real integration run |
| LLVM source checking | No | Requires pinned native compiler and real integration run |
| wasm32 core runtime | Separate oreslang-wasm CI | C ABI only; no guest Oreslang compilation |
| Browser host loader | Separate oreslang-browser CI | Wasm adapter only; no guest Oreslang compilation |

Never reinterpret the fake checker tests as Java/LLVM conformance. Real runs require exact source_sha, command argv, stdout, stderr, exit/signal and fixture identity. The runner does not use a shell and treats crashes, timeouts and absent executables as failures, even for expected-rejection cases.

At a real build gate: 1) obtain exact compiler tree/commit; 2) build it using authorized private-runner access; 3) supply non-executing checker argv; 4) run conformance with --require; 5) archive provenance and raw output, label unsupported fixtures explicitly rather than dropping them.
