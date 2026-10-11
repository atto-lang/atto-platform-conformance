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
Java/GraalVM #567 has independently executed these same six pinned
source bytes, with actual guest exit-status 42 for accepted programs and
parser/type/ownership rejection for invalid programs. Its exact 396-file
Git tree at `1bfef8bccd7a8188c47e85322e33e5756f5f1d3a` passed 1,436
Maven tests (zero failures/errors, one skip) on
https://github.com/zed-pkg-test/java-app/actions/runs/38179386289.
The manifest records individual source blob identities and both run IDs.

This is verified **scalar source-subset parity only**. No Java/LLVM
equivalence is claimed for cancellation during nested defer/finally, actor
resource lifetime, tagged/nominal messages, native-image/AOT, or the
synthesized merge tree. A subsequent Java cancellation hardening revision
must be independently tested at its exact source tree before its new claims
are promoted to verified evidence.
