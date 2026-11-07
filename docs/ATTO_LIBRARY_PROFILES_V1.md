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

## Hardening: exact ARM freestanding ABI allowlist

LLVM's `tools/core-baremetal-gate/src/audit.rs` has a closed 27-symbol
`SUPPORT_ABI` (memory helpers, exact ARM RTABI helper names, and
`__mulodi4`). The original blanket `__aeabi_` prefix in this v1
conformance manifest was broader than LLVM's implementation and could
misclassify unknown generated helpers as allowed. The v1 source contract
now pins the **complete exact list** and sets
`permittedExternalHelperPrefix: null`. Mutation tests prove adding an
unknown `__aeabi_` name or restoring a prefix fails policy validation.

This aligns with LLVM #1481's *actual* compiler-output IR/object/linker
negative helper-injection gate. It is still a source/policy model until
native compilation and QEMU execute on the exact PR head.

## Cross-run, cross-attempt and step-state evidence hardening

The GitHub job snapshot must now match its enclosing run's exact numeric
`run_id`, positive `run_attempt` and `head_sha`. When a workflow path is
supplied, it must be the expected source-owned `.github/workflows/*.yml`.
Step numbers must be monotonically 1-based in reported order and a completed
job cannot contain queued, null-conclusion, or unknown-outcome steps. Tests
mutate each field independently to prove that green metadata from another
run or attempt never upgrades execution evidence.

On 2026-11-07 UTC, a retry of conformance source-only GitHub run
`42316175135` was accepted as attempt 2 but again failed at runner
admission (no steps or allocated runner). This is a **runner service or
administration investigation**, not a compiler failure. Organization Actions,
billing and runner-management settings are not accessible via the available
GitHub connector; an administrator must inspect those settings. This
classifier never converts step metadata alone into verified guest parity.

## Real source-owned runner admission negative fixture (November 7 UTC)

`evidence/atto-library-source-only-runner-admission-20261107.json` records
GitHub run `42316175135` on exact prior PR head
`c7ce8820096d273c5edd13d2e0b89e8d6a09f22e`. Initial job
`128229200850` (attempt 1) and retried job `128244790877` (attempt 2)
were both reported failed, `runner_id=0`, and `steps=[]` in the GitHub
attempt-scoped job API. The source-only Node regression checks both real
snapshots and deliberately substitutes a forged stepful job across attempts;
both remain non-promoting. This is public run metadata, **not** source export,
actual compiler testing or proof that a particular billing setting caused
the admission failure. The administrator incident remains [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315).

## Fail-closed unfinished and contradictory zero-step classifications

New negative tests distinguish an in-progress job with not-yet-populated
steps from a **completed, failed, unallocated** runner-admission failure.
A zero-step job marked successful, or a completed zero-step job with a
positive runner ID, is now classified `UNTRUSTED_EVIDENCE` rather than
incorrectly claiming runner-admission failure. Required compiler steps
marked skipped remain `NO_REQUIRED_EXECUTION`. These are policy-model
regressions, not compiler guest receipts.
