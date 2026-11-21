# AttoLang Core → Alloc → Std: version 1 contract

**Canonical names:** `atto.core`, `atto.alloc`, `atto.std`, and optional `atto.runtime.actor`. New guest modules and fixtures use `.atto`. Legacy `ores.*` imports, `.ores` files, repository names, existing compiler binaries, and ABI symbol names are compatibility surfaces, **not** the canonical public names.

This PR specifies a backend-neutral, executable **policy-model checker**, not a shipped runtime/compiler profile. The existing LLVM `tools/core-baremetal-gate` exercises an **older `ores.core`** module on Cortex-M QEMU; it does **not** establish that this canonical `atto.core` fixture links or runs. Every new backend evidence field therefore remains `NOT_EXECUTED`.

## Layer boundaries

| Tier | Allowed library dependencies | Capabilities | Representative APIs |
| --- | --- | --- | --- |
| `atto.core` | Core only | None | values, borrowing, fixed-capacity/caller-provided storage, slices, pure algorithms, Option/Result once supported |
| `atto.alloc` | Core, Alloc | Explicit allocator | growable strings, collections, owned regions, heap-backed buffers |
| `atto.std` | Core, Alloc, Std | Allocator + platform capabilities per API | async filesystem/networking, clocks, environment, process services |
| `atto.runtime.actor` | Optional runtime, never implicit | Bounded static scheduler/mailbox **or** hosted executor/mailbox/supervision | actor admission, delivery and lifecycle |

A `core+static-actor` profile uses **caller-owned, fixed-capacity** storage and may not acquire an allocator, OS or hosted executor. `std` without actors must remain possible. The compiler must distinguish allocation from an already-provided arena; an arena that only borrows caller-provided storage belongs in Core, while establishing/growing owned storage needs an explicit allocator capability. An allocation-free Future/polling representation may live in Core, but task spawning/timers/scheduling require capabilities; Future layout is **not yet certified**.

## Required compiler and artifact gates

1. Admit canonical names as compiler-owned modules and keep old spellings as identity-preserving compatibility aliases. No filesystem shadowing, traversal, duplicate unit identities or caller-supplied source substitution.
2. Check imports **transitively**, including compiler-generated code and negative/error paths: Core may not import Alloc, Std or actors; Alloc may not import Std or actors; Std may not implicitly import actors. Application profiles explicitly enable the optional actor runtime.
3. Make the profile selector fail closed for unsupported targets and capabilities. The JSON presets describe desired combinations, **not** existing CLI flags.
4. LLVM milestone: compile the checked-in `core-numeric.atto` through the real frontend to ARM IR/object; audit undefined support ABI symbols and ELF sections/segments; link without libc, allocator, GC, OS, constructors or actor startup; boot QEMU and assert source-produced results. Add negative probes for forbidden direct/transitive imports, generated helpers, and deliberate hosted symbol injection.
5. Prove canonical `.atto` blob identity independently across all compiler repositories, with explicit status for Atto self-hosted, Cranelift, Forge, HDL, Java/GraalVM, JS, LLVM, .NET, realtime, Rust/Wasm, and standalone Wasm before reporting parity. A source-only contract check, missing compiler, zero-step CI, or compiler-rejection-only test never counts as executable guest evidence.

Use `node --test tests/atto-library-profiles-v1.test.mjs` to run the **policy-model tests**. Other backends may implement the checker and attach independently observed exact-head execution receipts, but must not replace `NOT_EXECUTED` in this specification with claims derived from the policy-model test.

## Integration ownership

- LLVM [#1390](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1390) already proposes `atto.core` import aliases; integrate there, not as a conflicting duplicate patch.
- LLVM [#1425](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1425) and [#1427](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1427) own separate canonical numeric/hosted source work.
- The legacy bare-metal gate must be *extended* to consume the canonical AttoLang fixture after these dependencies settle, retaining its existing no-libc audit and negative-mutation checks.

## Exact-head GitHub run classification

`lib/atto-library-run-evidence-v1.mjs` classifies fetched GitHub run and job
objects. Null/empty steps imply `RUNNER_ADMISSION_FAILURE`, not failed guest
tests or a successful compile. Duplicate job names/step identities, mismatched
PR heads and missing runner identity fail closed. Even all-green steps yield
`EXECUTED_STEPS_UNVERIFIED`: a reviewer must independently verify exact Git
tree read-back, run attempt, output artifacts, compiler invocation, actual
guest execution and negative mutation before recording compiler-backed proof.
The source-contract workflow runs both Node suites but **never** promotes backend
evidence itself.

## Eleven-compiler implementation matrix (2026-11-21)

The manifest reserves one **NOT_EXECUTED** exact-guest-evidence slot for every current `atto-source.*` compiler: `atto`, `cranelift`, `forge`, `hdl`, `java`, `js`, `llvm`, `net`, `realtime`, `rs`, and `wasm`. These slots are not claims about each backend's general maturity; repositories that are only scaffolds are still explicitly unverified for this shared portable library profile.

Relevant implementation work already in progress, not duplicate proposals:

- LLVM: [#609](https://github.com/atto-lang/atto-source.llvm/pull/609) (canonical core/alloc) → [#629](https://github.com/atto-lang/atto-source.llvm/pull/629) (alloc registry and fail-closed std), plus [#16](https://github.com/atto-lang/atto-source.llvm/pull/16) for a separate bounded freestanding guest.
- Java: [#1416](https://github.com/atto-lang/atto-source.java/pull/1416) (Core/Std guest import admission; existing merge conflict must be reconciled).
- Forge: [#162](https://github.com/atto-lang/atto-source.forge/pull/162) (compiler frontend/guest scalar and closed import boundary).
- JS: [#78](https://github.com/atto-lang/atto-source.js/pull/78) (pure integer `core` static linker; new canonical `atto.core/numeric` and `.atto` suffix aliases remain a narrow subset).
- Wasm: [#185](https://github.com/atto-lang/atto-source.wasm/pull/185) (explicit core-only LLVM bridge); this cannot independently prove native compiler or guest evidence.
- Rust: [#465](https://github.com/atto-lang/atto-source.rs/pull/465) (fail-closed compiler-owned Atto library imports and local shadow denial) plus [#417](https://github.com/atto-lang/atto-source.rs/pull/417) (std.buffer exact-byte admission candidate, not linked guest support).
- HDL: [#50](https://github.com/atto-lang/atto-source.hdl/pull/50) (explicit compiler-side library-profile rejection in fixed-width RTL subset, not full `core`/allocator/std support).
- Cranelift, .NET, self-hosted and realtime: named evidence slots remain `NOT_EXECUTED` until a profile-capable frontend and actual guest tests are integrated.

The policy model now adds negative fixture candidates for `alloc -> std` and `std -> actor`, in addition to the existing `core -> alloc/std` checks. No unsupported import should silently fall back to a local guest file or host module. For each backend, a passing claim requires its own **actual** current-head compiler, profile selection, real guest execution, forbidden-import negative before IR/no artifact, and independently verifiable toolchain/run/artifact provenance. Host-only structural tests stay `NOT_EXECUTED` here.

### Local test checkpoint

The checked-in manifest and policy checker were fetched from this branch and exercised in-process using V8: **19/19** positive/negative cases passed (including eleven forged-PASS denials). This **is not** source-owned Node CI. Conformance workflow run [#44947412464](https://github.com/atto-lang/atto-platform-conformance/actions/runs/44947412464) failed before any steps were exposed (`steps=null`); classify as `NOT_EXECUTED` / runner-admission failure rather than code-test failure.
