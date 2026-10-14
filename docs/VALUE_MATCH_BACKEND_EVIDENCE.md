# Executable value-match evidence gate (unattested)

`src/value-match-evidence.mjs` exposes `runValueMatchEvidence({backend, sourceSha, checkArgv, runArgv})`.
The checker and runner are separate, explicitly configured **absolute-path commands** with one
standalone `{file}` placeholder each. The commands are executed with `shell:false`.
The harness does not consult PATH for an executable, does not interpolate additional
placeholders, and requires the exact **40-character source Git commit SHA** claimed
by the invoker.

It verifies all **six canonical Git blobs** and the closed pending-backend manifest
*before executing anything*. It requires the checker to accept three positives
and to reject each of the three negatives for its specific semantic diagnostic
(not just an "unsupported match", a crash, a timeout or a generic failure).
The runner must emit **exact** stdout for the two runnable fixture files:
`42:0` and `142:42`.

The third positive fixture has no `main()`. Its compiler check uses its exact
bytes, then its supplemental runtime test appends a clearly labeled `main()`
which checks `compute(41)`, `compute(0)`, `compute(-3)`, and `compute(1)`;
the expected stdout is `42:0:0:2`. This is **not** execution of the canonical
source file alone. The generated temporary file is cleaned up.

The runner returns `ok`, checks/runs passed, exact fixture Git SHAs, executable
SHA-256 digests and stdout digests. **It does not attest that the supplied Git
revision produced the executable**, nor does it modify or confirm backend
claims. A simulated test callback is only validation of the harness algorithm,
not evidence of actual Oreslang execution. To confirm parity, CI must independently
attest the built compiler/source provenance, execute the genuine checker and runner,
and review the run at the exact recorded commit. A mock cannot satisfy that policy.

Currently Java has the implementation but the clean test-branch migration is blocked
on a prior authorized write denial; LLVM's documented compiler does **not**
implement this expression/Option/string/stdio subset, so it must remain pending.
The original source-fixture tests are still separately valid; no backend is
marked confirmed by adding this evidence gate.
