# Five-backend AttoLang actor/channel guest execution (draft)

This is a **candidate** corpus, not an execution certificate. A host-only test of a manifest cannot establish that an AttoLang actor/channel program ran. The three positive `.atto` fixtures cover actor request/reply, a bounded channel/select result and cancellation of a scoped wait. Seven negative `.atto` fixtures require compiler refusal of combined `critical suspends`, borrowed actor-state thread capture, direct function transport, nested callable channel payloads, captured closures, callable fields hidden in nominal classes, and nested callable `Topic<T>` payloads. Semantic spelling remains subject to backend parser review.

Backends: Java, LLVM, .NET NativeAOT, Wasm and Cranelift. None is marked executed until actual guest compilation and execution can be reproduced on the **original pinned source tree**, with compiler and runner artifact hashes, exact guest stdout, compiler diagnostics, and successful non-zero GitHub Actions job steps.

## Run

```sh
node bin/execute-five-backend-actor-channel-v1.mjs /absolute/path/adapters.json /absolute/path/guest-receipt.json
```

The adapter JSON must have `schemaVersion: 1` and `adapters` mapping **all five** backend IDs to objects with these fields: `sourceRepo`, `sourceCommitSha`, `sourceTreeSha`, `compilerCommitSha`, `compilerTreeSha`, `compilerPath`, `compilerSha256`, `guestRunnerPath`, `guestRunnerSha256`, `compileArgv`, and `runArgv`. Executable paths and the first element of the matching argument array must be the same absolute path. `{source}` and `{artifact}` placeholders interpolate only to a verified fixture source path and an isolated generated output path. Examples of *structure only* (not executable or evidence): `compileArgv: ["/abs/compiler", "compile", "{source}", "-o", "{artifact}"]`, `runArgv: ["/abs/runner", "{artifact}"]`. The actual command syntax must be defined by each backend owner after verifying how that compiler emits guest artifacts.

The harness checks Git blob identity for all ten sources, SHA-256 of the actual compiler and guest runner binaries, compiler exit and diagnostics, actual guest exit and **byte-exact stdout**. It runs all requested cases in independent bounded temporary directories without a shell, caps subprocess output and deadlines, and records both checkout HEAD/TREE and declared backend compiler/source provenance. A missing adapter/toolchain, guest artifact, diagnostic or backend is never silently treated as passing. `nativeVerified` and `certified` remain false, even on an admitted successful candidate run: an independent reviewer must bind completed GitHub Actions jobs, attempts, step identities and SHA heads to the records.

## Data-only transport conformance gate (2026-11-07)

**Contract:** source-visible channel and in-memory pub-sub values are recursively Sendable/MessageData; no functions, bound methods, invokable closures, or captured lexical environments may cross a channel, topic, actor mailbox or supervisor boundary. Wire/Redis/durable transport additionally requires an explicit Serializable<Format> representation; implementing serialization must never make a callable sendable.

**Smallest first executed check:** on **one exact Java/GraalVM PR head**, run compiler-backed positive Channel<int> roundtrip (stdout `42`), negative Channel<Fnc<int,int>> declaration, and nested Channel<Option<List<Fnc<int,int>>>> refusal. The compiler must parse each negative fixture and issue a payload-specific type diagnostic; a generic parser/unsupported-feature error does not satisfy it. Read back checkout HEAD/root tree, compiler binary digest and nonempty job steps before classifying guest evidence. Then repeat byte-identical fixtures on LLVM, .NET NativeAOT, Wasm/Wasmtime and independent Cranelift. Forge's separate C++ emitter must be evaluated independently of Cranelift; five-backend status is not six-implementation parity.

Candidate additional negative checks (all NOT_EXECUTED at current head): captured lexical closure, callable nominal field, and nested Topic<Option<Fnc<...>>>. **Open syntax review:** the topic candidate reuses the older Java `pub async routine` spelling; AttoLang's current `suspends` policy requires a reviewed parser-valid replacement before a guest type-rejection claim. The nominal-field case rejects owner-bearing classes even without proving an invokable bound method; a valid locally invokable bound-method fixture and a positive owner-free nominal data control are still required. Never count unsupported syntax, parser error, or a generic nominal rejection as proof of recursive callable detection.

**Evidence discipline:** The expanded fixture manifest and Node checks are *host structural admission only*. Even an executed Node test does not prove a guest. Failure of GitHub jobs with `steps=[]` or `steps=null` means runner admission failed and has no positive or negative compiler result. On each backend verify parse success, semantic reject, zero enqueue/sequence/credit/ACK changes, and a separate permitted immutable data payload. Reject after failed admission must not poison a subsequent good send; no guest callbacks may run. Keep all draft/host-only evidence out of the verified parity column.


The acceptance test for cancellation must demonstrate the actual scheduler releasing the channel wait on cancellation; merely printing `cancelled` through a host mock is forbidden.

For compatibility the backend may still call its existing `.ores` CLI internally only after its documented `.atto` source admission has been verified. Do not replace this fixture with a host oracle or automatically translate it to `.ores` and claim native AttoLang support.

**Current state:** no real compiler adapter or exact-head guest receipt supplied; all five backends are `NOT_EXECUTED`.
