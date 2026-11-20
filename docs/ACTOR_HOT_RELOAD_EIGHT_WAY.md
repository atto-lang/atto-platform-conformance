# Oreslang actor hot-reload — eight transitions × two actor kinds

**Status: draft release gate: sixteen SHARED/PRIVATE actor-kind × backend/mode cases. Real source-compiled slices have passed; complete AOT/JIT parity has NOT.**

For each of the eight backend/mode transitions below, require **both SHARED and PRIVATE** actor observations (16 independent records, schema v2). This matrix tests **guest code** transitions, not simply whether the Oreslang
compiler's own Java host was built as a Native Image:

- GraalVM: AOT -> AOT, AOT -> JIT, JIT -> AOT, JIT -> JIT
- LLVM: AOT -> AOT (PIC), AOT -> JIT (ORC), JIT -> AOT, JIT -> JIT

Each unsupported target mode must be recorded as unsupported and blocks
certification of the full eight-way matrix. Do not treat Graal Native Image
with an embedded interpreter as proof of guest native JIT. JVM/Truffle JIT,
native host AOT with guest interpretation, native host AOT with an optimizing
guest runtime, and LLVM ORC are different executable configurations.

## First release slice — source-generated SHARED and PRIVATE same-domain actors

Compile Oreslang Counter v1 and v2 with identical state schema, wire ABI,
capabilities and actor kind. v1 starts at count=1, accepts +41 and emits 42.
Freeze new ingress, stage v2, then pin an old in-flight turn to demonstrate
that code publication/retirement cannot overtake outstanding generation leases.
For both SHARED and PRIVATE code-only upgrades within the same trusted allocation
and execution domain, after the pin drains publish exactly once, preserving the
**same ActorRef, actor-owned heap/allocation domain, mailbox, and count**. Do not rerun v2 on_start. v2's handler
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

The source-free node:test cases exercise evidence admission **only**. Actual independent private-runner guest evidence now exists for **narrow source-compiled slices**:

- [GraalVM/Truffle source guest run #39505474852](https://github.com/daedalus-fab/daedalus-e2e/actions/runs/39505474852): 4 JUnit tests, zero errors/failures/skips. Two independently owned SHARED/PRIVATE actors, 128 repeated code-generation swaps per kind. 90 exact Git-blob-matched source/compiler/test files from Java PR #1751 HEAD `49f6e4c40f64d1111acf7653250042b173849cc4`.
- [LLVM source AOT/PIC run #39503993056](https://github.com/daedalus-fab/daedalus-e2e/actions/runs/39503993056): actual `.ores` to LLVM IR and PIC, SHARED + PRIVATE native actor-heap fixtures, normal and ASan/UBSan PASS. 101 exact Git-blob-matched compiler/runtime/fixture files from native PR #774 HEAD `f93bffe673a0ba4f085bbc7df27a70a7c252d905`.

These private CI mirrors are **verified focused file closures, not byte-for-byte complete original repository trees**. They used local test-org checkout with no cross-org secret. Source-org Actions may still fail before any executed steps. Neither run authenticates all sixteen mode transitions; Graal guest AOT/Native Image, LLVM ORC JIT, full suspended-frame pinning, and physical process/sandbox assertions remain blocked. Do not insert synthetic "executed" rows on this basis.

PRIVATE trusted actors may perform **code-only** generation changes within their
existing authorized allocation domain without migrating their actor-owned heap.
Changing address space, runtime allocation domain or physical sandbox is a
**different transfer protocol**: keep the logical ActorRef stable, checkpoint
and restore into a newly authorized heap, prove containment, and audit in-flight
mail/await/FFI/IO resources. UNTRUSTED sandbox upgrades also require independent
containment evidence and are **never** admitted as one of these 16 trusted
code-only cases. The v2 matrix refuses changed allocation-domain identity.

Use cross-organization private CI mirroring only with explicit authorization,
restricted private destination and immutable source Git blob verification.
Never treat a GitHub workflow with zero actual executed steps as test evidence.
