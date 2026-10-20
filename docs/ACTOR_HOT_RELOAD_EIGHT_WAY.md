# Oreslang actor hot-reload — eight-way source-execution release gate

**Status: draft contract, NOT eight successful compiler/runtime tests.**

This matrix tests **guest code** transitions, not simply whether the Oreslang
compiler's own Java host was built as a Native Image:

- GraalVM: AOT -> AOT, AOT -> JIT, JIT -> AOT, JIT -> JIT
- LLVM: AOT -> AOT (PIC), AOT -> JIT (ORC), JIT -> AOT, JIT -> JIT

Each unsupported target mode must be recorded as unsupported and blocks
certification of the full eight-way matrix. Do not treat Graal Native Image
with an embedded interpreter as proof of guest native JIT. JVM/Truffle JIT,
native host AOT with guest interpretation, native host AOT with an optimizing
guest runtime, and LLVM ORC are different executable configurations.

## First release slice — real source-generated SHARED actor

Compile Oreslang Counter v1 and v2 with identical state schema, wire ABI,
capabilities and actor kind. v1 starts at count=1, accepts +41 and emits 42.
Freeze new ingress, stage v2, then pin an old in-flight turn to demonstrate
that code publication/retirement cannot overtake outstanding generation leases.
After the pin drains, publish exactly once, preserving the **same ActorRef,
actor-owned heap, mailbox, and count**. Do not rerun v2 on_start. v2's handler
changes its behavior on negative increments: -1 emits 43 and -2 emits 45.

Also test: wrong schema/wire/capabilities/signatures rejected; stale/foreign
actor and epoch tickets rejected; candidate initialization failure leaves old
generation serving; stop/send/freeze races have no duplicate delivery; await,
external callback, timer and FFI pins block retirement; 100+ upgrades neither
leak images nor unmap executing code. Include untrusted-native sandbox checks
as a separate profile; no source-to-native JIT for untrusted guest code inside
the trusted supervisor process.

## Evidence and current boundaries

Use node bin/actor-hot-reload-matrix.mjs init /tmp/hot-reload.json to initialize
an all-blocked evidence report. Only actual backend source+binary test runners
may populate executed observations. Run node
bin/actor-hot-reload-matrix.mjs check /tmp/hot-reload.json to reject missing
transitions, zero-step CI jobs and violated actor invariants. It **always**
refuses to certify production hot reload, even for a synthetically all-pass
report: reported observations are not authenticated by a local parser. External
CI attestation must independently verify the exact source tree, runner job
steps, compiled guest image digest and execution logs.

The source-free node:test cases exercise evidence admission **only**.
Current source-org Java/LLVM Actions jobs are failing before any recorded job
steps, so they cannot certify real GraalVM/LLVM hot reload. Java draft #1270
has source-actor handler-upgrade tests; LLVM stacked draft #627 has real .ores
-> PIC test fixtures, but both require source-local guest execution.
No assertion here means those tests have passed.

For PRIVATE / UNTRUSTED actors, preserving a *physical* heap is not appropriate
when changing worker address spaces. Those require a stable logical ActorRef
plus verified checkpoint/restore into a newly authorized heap and certified
containment. That is a separate test family from this SHARED same-heap v1 gate.

No private repository source should be mirrored across orgs without an
explicit reviewed authorization policy, even if source Actions have no minutes.
