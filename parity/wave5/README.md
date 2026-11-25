# Oreslang cross-backend parity — Wave 5 (tasks 21–25)

**This PR is an executable native artifact/actor-memory admission layer, not implementation or certification of all five compilers.** It is additive to Waves [1/#47](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/47), [2/#49](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/49), [3/#52](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/52), and [4/#54](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/54). Every pending feature remains unverified in `manifest.json`.

## Five tasks and the real integration gates

| Task | Current source/backend branches to reuse | Required actual Oreslang acceptance |
| --- | --- | --- |
| **21. Actor memory domains and capabilities** | [Java #1080](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1080), [LLVM #463](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/463), [.NET #36](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/36), [Forge #29](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/29), [Wasm #34](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/34) | Make compiled guest objects allocate into owned actor arenas, not just host byte slices. Prove actor identity/generation binding; readonly explicit shared projection; no cross-heap raw mutable alias; quota accounting, leak/teardown, revocation and borrow-scope safety. |
| **22. LLVM full native AOT apps** | [LLVM #361](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/361), [#264](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/264), [#484](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/484) | Run real Oreslang source → LLVM IR/object → linked ELF/Mach-O/PE executable with typed call/owned-record semantics and actor runtime linkage. Verify true native machine code, entrypoint, error cleanup, deterministic native ownership, no guest bytecode interpreter or JIT fallback, sanitizer and AOT-only release tests. |
| **23. .NET Native AOT** | [.NET #18](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/18), [#37](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/37) | .NET compiler's own NativeAOT binary is **not** proof that its Oreslang guest source is native compiled. Require actual guest program emitted as PE32+ AMD64 then ARM64, no CLR COM descriptor/CIL dependency, machine-code entrypoint, typed functions/aggregates/control flow and real guest execution. |
| **24. Forge independent compiler** | [Forge #30](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/30), [#11](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/11) | Replace/augment `oresforge run` interpreted scalar execution with independently emitted real native executable. Check SSA lowering, register allocation, instruction selection, calling convention, stack frame/unwind, native execution and differential real Java/LLVM guest output. A positive `ir` result or Forge host interpreter `run` is insufficient. |
| **25. Wasm source and execution profiles** | [Wasm #35](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/35), [#41](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/41), [#34](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/34) | Use the **real pinned LLVM Oreslang compiler** to emit wasm32, not an invented independent Wasm frontend. Enforce source graph completeness, allowed host function capabilities, strict import signatures, typed guest value ABI, bounded memory and guest execution in WASI/browser/embedded profile as applicable. |

## Actor-heap promotion gate

`actor-heap-capabilities.json` is a deliberately non-promoting capability ledger.
It distinguishes four allocation levels:

1. `host-reference` — model/test only;
2. `host-runtime` — a real backend arena API exists, but ordinary compiled guest objects are not proven to use it;
3. `compiled-scalar` — at least a bounded scalar subset emitted by the real compiler uses actor-owned storage;
4. `compiled-general` — ordinary mutable guest allocations (classes/records/lists/maps/closures/retained state as applicable) are compiler-routed into actor-owned domains.

The current audited ledger keeps **semantic actor-heap parity false**. LLVM is
`compiled-scalar` and is verified at that declared level by exact-source compiler/native carrier evidence; Java, .NET, Forge and Wasm remain `host-runtime` for this
gate. A host arena, successful policy fixture, or host allocator test cannot be
edited into a `compiled-general` claim.

The validator computes promotion preconditions. `guest-general` zero-GC is
only admissible with compiled-general storage, deterministic reclamation and
full AOT. This is intentionally separate from the host/control-plane GC
boundary: Java may continue using JVM-managed Truffle/runtime wrappers even
when guest data is increasingly arena-backed, and Wasm may explicitly recycle
linear-memory capacity without claiming host OS decommit.

Current audit anchors are Java #1134, LLVM #563, .NET #36/#64, Forge #29/#60
and Wasm #64. LLVM is `verified:true` only at the declared `compiled-scalar` level from exact-head executable evidence; the other backend entries remain `verified:false` until equivalent source/artifact-provenance evidence is available.

## What this branch actually adds

- `src/actor-memory.mjs`: a bounded **host-only reference** for actor-owned allocations with opaque WeakMap-issued authority, per-actor/global quotas, generations, zero-length accounting, independently frozen nested data, scoped read-only snapshots, explicit owned deep copy, retirement, foreign/stale ref denial, and rejection of getters, symbols and sparse aggregates. No claim of real allocation into compiler actor heaps.
- `src/artifacts.mjs`: read-only byte inspector for ELF64 executable entry/segments, PE32+ executable machine/CLI COM descriptor, Mach-O 64 executable architecture, and wasm32 binary sections. Reject shell scripts/source/LLVM IR masquerading as native binaries. Wasm accepts a strict scalar zero-import profile or a named function-only `ores_host` capability allowlist, requires `ores_main` exported function, bounded declared linear-memory maximum when memory exists, no start section, canonical section/UTF-8 checks. This also requires real Node WebAssembly engine module validation and cross-checks engine-reported imports/exports against the inspected inventory. It still checks **binary shape and engine module validity**, not language compiler provenance, no-JIT proof, trusted import signatures, or runtime isolation.
- `src/evidence.mjs`: strict task-to-backend-to-target policy, SHA-256 artifact equality, regular non-symlink inputs, bounded opt-in guest subprocess execution (absolute command, shell disabled, exact output/exit oracle, no signals/timeouts), and **non-promoting** observations `ARTIFACT_SHAPE_OBSERVED` / `GUEST_RESULT_OBSERVED`. It always reports `nativeAotProven:false`, `parityVerified:false`, and `provenanceVerified:false` where applicable.
- `manifest.json` + `src/manifest.mjs`: exact six pinned Git-blob Oreslang fixtures for 21–25. Actor state acceptance and escaping-loan rejection come from Java's canonical actor state PR. Four scalar controls intentionally reuse the same `pub fnc main(): int { return 40 + 2; }` Git blob from Forge's shared corpus. Target status `verified:false` cannot be promoted by editing the manifest.
- `tests/wave5.test.mjs`: **21 Node test definitions** for quota, identity and authority, native shape distinctions, CIL directory rejection, Wasm capability/memory, real WebAssembly guest controls, real local Clang native control, explicit guest execution, tamper/status negatives and fake outputs.

## Run

Node 22+ and Clang are required by the real native **C control** test:

```sh
node --test parity/wave5/tests/wave5.test.mjs
node parity/wave5/bin/validate.mjs --validate
```

Inspect a previously built **genuine user-provided artifact**, with no implicit execution:

```sh
node parity/wave5/bin/inspect.mjs \
  --task=22 --backend=llvm --target=elf-x86_64 \
  --artifact=/absolute/path/to/guest \
  --sha256=64_lowercase_hex_sha256
```

For Wasm, use `--task=25 --backend=wasm --target=wasm32`, optional `--profile=capability` and repeated `--allow-import=ores_host.clock_now`. `--task=23` requires a PE x64/ARM64 Native AOT **candidate**, and `--task=24` Forge a native machine-code candidate. Task 21 cannot be marked native by submitting an artifact to this command.

The positive Node tests use a **Clang-built C executable** printing `42` and separately a **hand-assembled genuinely executable WebAssembly module** returning `42`. Both are intentionally source-free controls of the inspector and host runtime, **NOT** compiled Oreslang guest parity. The artifact inspector does not independently establish that an arbitrary candidate came from an Oreslang compiler, or that a Native AOT host compiler contains no guest interpreter. Compilation source-tree identity and build dependency closure must be separately authenticated by exact-source CI, and those claims are not added by a caller-supplied SHA-256.

### Proof-level separation

1. **Contract verified** — pinned immutable test source/manifest and self-tests.
2. **Artifact-shape observed** — actual native object magic, architecture, CLR marker, Wasm sections/memory/import bounds, hash.
3. **Host control executed** — real C and tiny Wasm controls, *not Oreslang*.
4. **Actual Oreslang guest executed** — requires independent compiled guest/backend compiler and target runtime evidence; **not yet obtained by this branch**.
5. **Backend parity** — identical complete supported semantics, actor lifetime isolation, target-specific AOT/no-fallback, provenance and negative-source hardening in **every** backend. **Not achieved.**

## CI and security

The Wave 5 workflow only checks the new isolated package, with read-only checkout, Clang and Node 22. GitHub Actions runner allocation must be confirmed by actual steps/logs before any green claim; a job failing with zero steps proves no tests executed.

Do not mirror a private Oreslang source Git tree to an unreviewed external Actions carrier. Cross-org source export requires independently approved protected source/destination repository identity, reviewed allowlist, and trusted runner provenance. Public artifact-format controls do not authorize private compiler publication.

**Release/merge remains blocked** on full exact-head CI, production compiler integration, and guest-bound source/runtime execution per task. This draft is an executable audit/gate, not a claim to have finished enormous backend implementation items.
