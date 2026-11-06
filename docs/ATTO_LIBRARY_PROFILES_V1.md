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
5. Prove canonical `.atto` blob identity across Java/GraalVM, LLVM, .NET, Wasm and Forge before reporting parity. A source-only contract check, missing compiler, zero-step CI, or compiler-rejection-only test never counts as executable guest evidence.

Use `node --test tests/atto-library-profiles-v1.test.mjs` to run the **policy-model tests**. Other backends may implement the checker and attach independently observed exact-head execution receipts, but must not replace `NOT_EXECUTED` in this specification with claims derived from the policy-model test.

## Integration ownership

- LLVM [#1390](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1390) already proposes `atto.core` import aliases; integrate there, not as a conflicting duplicate patch.
- LLVM [#1425](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1425) and [#1427](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1427) own separate canonical numeric/hosted source work.
- The legacy bare-metal gate must be *extended* to consume the canonical AttoLang fixture after these dependencies settle, retaining its existing no-libc audit and negative-mutation checks.
