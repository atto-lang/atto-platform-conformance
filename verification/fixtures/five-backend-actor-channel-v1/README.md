# Five-backend AttoLang actor/channel guest execution (draft)

This is a **candidate** corpus, not an execution certificate. A host-only test of a manifest cannot establish that an AttoLang actor/channel program ran. The three positive `.atto` fixtures cover actor request/reply, a bounded channel/select result and cancellation of a scoped wait. Three negative `.atto` fixtures require compiler refusal of combined `critical suspends`, borrowed actor-state thread capture and closure transport through channels. Semantic spelling remains subject to backend parser review.

Backends: Java, LLVM, .NET NativeAOT, Wasm and Cranelift. None is marked executed until actual guest compilation and execution can be reproduced on the **original pinned source tree**, with compiler and runner artifact hashes, exact guest stdout, compiler diagnostics, and successful non-zero GitHub Actions job steps.

## Run

```sh
node bin/execute-five-backend-actor-channel-v1.mjs /absolute/path/adapters.json /absolute/path/guest-receipt.json
```

The adapter JSON must have `schemaVersion: 1` and `adapters` mapping **all five** backend IDs to objects with these fields: `sourceRepo`, `sourceCommitSha`, `sourceTreeSha`, `compilerCommitSha`, `compilerTreeSha`, `compilerPath`, `compilerSha256`, `guestRunnerPath`, `guestRunnerSha256`, `compileArgv`, and `runArgv`. Executable paths and the first element of the matching argument array must be the same absolute path. `{source}` and `{artifact}` placeholders interpolate only to a verified fixture source path and an isolated generated output path. Examples of *structure only* (not executable or evidence): `compileArgv: ["/abs/compiler", "compile", "{source}", "-o", "{artifact}"]`, `runArgv: ["/abs/runner", "{artifact}"]`. The actual command syntax must be defined by each backend owner after verifying how that compiler emits guest artifacts.

The harness checks Git blob identity for all six sources, SHA-256 of the actual compiler and guest runner binaries, compiler exit and diagnostics, actual guest exit and **byte-exact stdout**. It runs all requested cases in independent bounded temporary directories without a shell, caps subprocess output and deadlines, and records both checkout HEAD/TREE and declared backend compiler/source provenance. A missing adapter/toolchain, guest artifact, diagnostic or backend is never silently treated as passing. `nativeVerified` and `certified` remain false, even on an admitted successful candidate run: an independent reviewer must bind completed GitHub Actions jobs, attempts, step identities and SHA heads to the records.

The acceptance test for cancellation must demonstrate the actual scheduler releasing the channel wait on cancellation; merely printing `cancelled` through a host mock is forbidden.

For compatibility the backend may still call its existing `.ores` CLI internally only after its documented `.atto` source admission has been verified. Do not replace this fixture with a host oracle or automatically translate it to `.ores` and claim native AttoLang support.

**Current state:** no real compiler adapter or exact-head guest receipt supplied; all five backends are `NOT_EXECUTED`.
