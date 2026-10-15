# Executable value-match evidence gate (unattested)

`src/value-match-evidence.mjs` exposes `runValueMatchEvidence({backend, sourceSha, checkArgv, runArgv})`.
The checker and runner are separate, explicitly configured **absolute-path commands** with one
standalone `{file}` placeholder each. The commands are executed with `shell:false`.
The harness does not consult PATH for an executable, does not interpolate additional
placeholders, and requires the exact **40-character source Git commit SHA** claimed
by the invoker.

It verifies all **six canonical Git blobs** and the closed pending-backend manifest
*before executing anything*. It retains the verified byte buffers, stages them in
a private temporary directory with create-only file writes, and gives the compiler
**only those snapshot paths**. This prevents a concurrent modification to the
repository fixture from changing the source executed after its SHA check.
Snapshot SHA-256 is also reported per result. It requires the checker to accept three positives
and to reject each of the three negatives for its specific semantic diagnostic
(not just an "unsupported match", a crash, a timeout or a generic failure).
Negative diagnostics must originate on **stderr** with the expected semantic
error class; guest stdout and unrelated diagnostic text cannot satisfy them.
A zero-exit compiler or runtime invocation that emits an error diagnostic on
stderr must not be counted as passing, even when its stdout otherwise matches.
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

## CI invocation for an actual backend

Use the fail-closed CLI `node bin/value-match-evidence.mjs` with all required
arguments: `--backend=java-graalvm`, `--source-sha=<exact-40-char-commit>`,
`--check-argv=<JSON string array>`, `--run-argv=<JSON string array>`,
and optional `--timeout-ms=15000`. The executable in each JSON array must
have an **absolute path** and the source path appears as one standalone
`{file}` element, not part of an interpolated shell command.

For a locally built Java classpath, the check command can use
`java -cp <built-classpath> dev.oreslang.launcher.OresMain --check {file}`
and the run command can use the same launcher without `--check`. Translate
that example to absolute executable paths and JSON argument arrays. The
commands are **not automatically available or executed** by this repository.
No environment credentials or shell command substitutions are required.

The CLI returns 0 only when all six exact-source compilation decisions and
all three runtime observations agree with the contract. Exit 1 means a failed
verdict; exit 2 means malformed input or unavailable executable. The output
always identifies itself as **unattested**, regardless of exit status. A
separate trusted build pipeline must independently verify the compiler
binary's provenance before endorsing any backend.
