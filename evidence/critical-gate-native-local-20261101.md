# Native critical gate local check (LLVM substrate, November 1, 2026)

This is **local source-verified host-native evidence**, not .ores guest execution, not verified hosted CI, and not multi-backend conformance.

- Source PR: https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1289
- Exact commit: `ce79a732bba2d3d3d8a30130dafba9f1a0780637`
- Git tree: `f7f8f77c5f1cb3c0704d606990c5bcdbb2eff91c`
- `src/main/cpp/oreslang/runtime/CriticalGate.hpp` blob: `0f59230ba55cfbb4de9b00a5c7b9e5283422666c`
- `src/main/cpp/oreslang/runtime/LogicalMutex.hpp` blob: `9cbd8724b1b5d077465e8e32175ea60e418acb16`
- `tests/critical_gate_retirement_stress_test.cpp` blob: `7b86260847feb72edc0e52ec4fdd1212557d7b76`

The tested files were reconstructed byte-exactly and confirmed using `git hash-object` against the three GitHub blob hashes above. A local C++17 runner used each of:

```sh
g++ -std=c++17 -O1 -g -Wall -Wextra -Wpedantic -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -pthread -Isrc/main/cpp tests/critical_gate_retirement_stress_test.cpp -o critical-stress
clang++ -std=c++17 -O1 -g -Wall -Wextra -Wpedantic -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -pthread -Isrc/main/cpp tests/critical_gate_retirement_stress_test.cpp -o critical-stress-clang
```

Both native binaries emitted `PASS native header smoke assertions=5120`. Neither ASan nor UBSan reported findings. This includes 256 FIFO/retirement rounds and 256 callback-versus-retire races per run.

**Not proven:** guest compiler lowering of `critical {}`, actor/CONTROL scheduler wake notification, dynamic effects, scoped state-loan borrow lifetime, source async generators, full native LLVM suite, NativeAOT, Wasm, Forge, or Java/Graal semantics. The latest relevant hosted LLVM run #41357841943 job #125001642737 reported zero executed steps: classify NOT_EXECUTED.

The checked-in smoke test and host compile receipt are useful **independently reproducible local inputs**, but must not be promoted to multi-backend parity. A release gate requires stepful exact-head CI and compiler-generated native .ores guest witnesses.
