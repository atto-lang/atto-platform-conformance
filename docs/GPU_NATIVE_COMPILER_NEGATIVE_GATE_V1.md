# AttoLang GPU compiler-negative gate v1

**Evidence class: compiler-negative only, untrusted until independently attested.** This harness does not execute GPU kernels. It reads the pinned corpus in `contracts/atto-gpu-explicit-launch-v1.json`, compiles one scalar control and runs every proposed negative case using a configured compiler executable.

Usage from an unmodified conformance checkout (absolute compiler path required):

```sh
H="$(git rev-parse HEAD)"
T="$(git rev-parse 'HEAD^{tree}')"
node scripts/run-gpu-native-negative-gate.mjs \
  --backend=llvm --compiler=/absolute/path/oreslang-llvmc \
  --head="$H" --tree="$T" --receipt=/tmp/gpu-negatives.json
```

The runner verifies exact checkout head/tree, a clean Git worktree and each fixture's Git blob. It requires a normal `launch(7)` scalar function to compile first; each negative must exit nonzero, print the expected `GPU-LAUNCH-NNN:` diagnostic on stderr, emit no stdout or artifacts, and leave source unchanged. It hashes the binary, not its provenance. A negative-only result is never positive `.atto` kernel compilation or physical GPU proof.

Current LLVM #1457 intentionally gives general `GPU-LAUNCH-008` rejection, so the full specific-diagnostic corpus is **not yet passing**. Do not weaken expected diagnostics or pretend `NOT_EXECUTED` means passed. `steps=[]` or `null` is runner-admission failure, not compilation evidence. Running the associated Node tests uses a synthetic compiler fixture and only verifies the harness itself.

The future device gate additionally requires compiler-derived GPU code, hardware identity, buffer/queue authority, numerical oracle, native completion fence, independent review, and exact runner attempt evidence.
