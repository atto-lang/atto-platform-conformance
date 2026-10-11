# Shared scalar match/switch source-order conformance (v1)

This directory contains **identical Oreslang source bytes** from the
LLVM PR #46 supported scalar subset, not separately rewritten examples.
Each fixture includes its Git blob SHA-1 in the manifest. Running a fixture
only proves the backend/build that executed it. Other backends are pending
until the same exact bytes are compiled and (for accepted programs) executed.

Contract:
- Canonical `match` examines arms in source order; `on _` is terminal.
- `default` and `on default` are invalid in canonical match.
- `switch default` remains a designated fallback regardless of arm position.
- Value arms return to the expression's collected value, not the function.
- Executed accepted fixtures return signed i64 42.

LLVM exact 185-file source tree at `6274f0e9c581d069aaa263e82e21b5de2de1e836` passed all 116 CTests
on https://github.com/zed-pkg-test/java-app/actions/runs/38176388764.
Java #567 has corresponding compiler-admission tests but the exact *shared
source bytes* and runtime outputs still need separate executed evidence.
Do not claim cross-backend parity based on the harness's fake checker.
