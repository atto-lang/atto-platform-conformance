# AttoLang `std.actor` namespace parity v1

**Status: source-contract only, NOT a compiled guest or runtime certification.**

This contract extends the existing [library-profile contract](ATTO_LIBRARY_PROFILES_V1.md) without changing the existing version-1 profile registry.

## Two distinct identities

- `use namespace std.actor;` names independently maintained, native `.atto` **source library declarations**, including pure policy predicates and affine Future adapter functions.
- `atto.runtime.actor` names the **optional actor runtime/capability profile** in library-profile v1. It is **not** an automatically importable source package, alias, or implicitly injected scheduler.
- `core` / `alloc` / ordinary `std` can be compiled without runtime actors. A hosted actor profile must separately resolve and authorize capabilities. No silently accepted import, host stub, fake actor ID, or privilege grant can bridge the two.
- Each `atto-source.*` compiler owns its own `.atto` implementation; compatible public semantics are required, byte-identical source is not.

## Semantic conditions that require compiled evidence

`ActorFuture<T>` is compiler-sealed and affine. A one-shot result may settle while its source actor continues operating; however `get_done()` must require verified physical shutdown, including carrier/arena/loan retirement. The two are **different barriers** and must never be conflated.

Cancellation is only a request, with a separately authenticated winner in the terminal-result race. Supervisor panic/uncaught raise/throw notices travel authenticated priority CONTROL, never DATA. Restart requires a new actor generation only after the previous physical incarnation is safely retired. Cross-generation mail, reply, wake, and capability reuse must be rejected. No user-supplied boolean establishes trusted authority.

## Eleven independent compiler slots

`atto` (self-hosting bootstrap) and `realtime` (real-time bootstrap) are marked `NOT_IMPLEMENTED`, because their current repositories are scaffold-only. The other nine contain draft `std.actor` source candidates and remain `NOT_EXECUTED` for **this contract**. This does not downgrade or assert their unrelated production features.

The candidate native guest corpus includes a standalone namespace-only pure-function `main()` that must execute as 42 with no imports; 34 ordinary and 133 adversarial boundary assertions, three additional **compiler-negative namespace/import fixtures** (expected `E_UNBOUND`, `E_DUPLICATE`, `E_SYNTAX` and no emitted artifact), and separate one-shot Future ownership positive/negative fixtures. Execute them with **each compiler's actual source importer, type checker, target codegen, and guest runtime**, with exact source/tree/blob, toolchain, target and independently reviewed results. A clean `node --test` on this policy schema is **not** language execution.

## CI admission and private export

Zero-step Actions failures are `RUNNER_ADMISSION_FAILURE`, not guest compilation failures. A stepful source-free canary verifies capacity only. Private cross-organization Git-tree export is permitted only after independent approval of the **exact source head/tree** and **destination owner, repo numeric ID, visibility, readers, retention, source policy/branch protection and carrier workflow/test plan**. Unapproved transfer via connector Git objects is still denied.

Use `node --test tests/std-actor-parity-v1.test.mjs` for source-contract mutation tests. Keep the existing nine draft `std.actor` PRs as implementation branches and integrate rather than duplicate their work. Future adapter behavior must also remain compatible with `atto-common-source#134`; do not force backend source identity.
