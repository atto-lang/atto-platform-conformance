# AttoXP M0: explicit native UI ABI, negative promotion gate and repo plan

**Status: PROPOSED_NOT_IMPLEMENTED.** Builds on issue #329 / draft PR #330.
This contract does not establish a new GitHub organization, linker-produced
library, working `.atto` guest, simulator or hardware execution.

## ABI v1.0 (initial iOS and Android arm64)

The proposed C-compatible entrypoints and frozen numeric statuses are defined in
`include/attoxp_ui_abi_v1.h`. There is no implementation in this proposal.
Clients negotiate (major=1,minor=0). Reject any different major, unknown
struct_size, unknown flags or nonzero reserved fields; never guess layouts.
No exceptions or panics cross the ABI. The buffer supplied to `submit_batch`
is borrowed during the call only; host must copy into a bounded owned queue.
Commands are data-only, never raw native pointers or function/closure values.

### Handle and lifecycle fence

A 24-byte opaque handle is (unpredictable 128-bit identity, uint64 generation).
An internal trusted native table (NOT caller-controlled fields) binds its identity
to process/app instance, scene, actor owner, handle kind and lifecycle.
Generation is strictly monotonic per slot. Increment/invalidate before retire;
never wrap generation back to a usable handle (quarantine instead). A reused
slot must receive a fresh random identity. Both admission and post-dispatch
commit recheck the current generation and scene revision. DESTROYING marks
all existing event tokens and in-flight work uncommittable; physical native
objects retire only once outstanding callbacks and owned references drain.
Reject cross-app, cross-scene, cross-actor, stale-generation, wrong-kind and
callback-after-disposal requests before dereferencing views.

### UI thread / concurrency and transaction fence

`submit_batch` is asynchronous. Validate all operations, byte lengths,
operation count (max 256) and bytes (max 65536), UTF-8, tree acyclicity,
node ids and handle ownership before queueing. Every mutation executes on
iOS main UIKit thread or Android main Looper only. Never block an AttoLang
scheduler carrier or synchronously invoke guest callbacks during `critical`.
On the main UI thread recheck handle epoch, scene active state and expected
revision. Commit increments revision exactly once; reject out-of-order writes.
If the native adapter fails mid-commit, quarantine the scene and cancel work;
do not misrepresent a partially mutated platform tree as an atomic rollback.
Reliable event queues must be bounded, with cancellation and timeout.

### Capability / FFI fence

On **each call and after asynchronous permission prompts**, require all of:
active app/scene, actor-scoped runtime grant, OS permission state, and required
app entitlement. Revocation immediately fences pending calls; a handle alone
cannot grant capability. Camera/location/notifications/storage/etc. have
separate scopes. For iOS, signed release bundles supply executable features;
no downloaded feature-changing executable code. JNI local/global references
and Swift retains must be explicitly scoped and released on correct lifecycle
boundaries. Actor channels carry serializable values only.

## Native negative-test matrix

`contracts/atto-xp-m0-negative-matrix-v1.json` is the authoritative test-id
seed. All native rows are NOT_EXECUTED until an actual target runner records
an exact-head, nonzero-step receipt with asserted error oracle; existence of
this JSON file or a local Node matrix-shape test is **not** a passing negative.
Matrix includes stale/ABA/owner/scene/generation, wrong-thread/reentrancy,
whole-batch rejection, quotas, cancellation/lifecycle, OS+actor permission
revocation, native references, release constraints, and receipt spoofing.

The existing `bin/verify-atto-xp-receipt.mjs` is only a fail-closed *shape*
validator. It cannot authenticate its caller-supplied run IDs, artifact hashes
or claimed physical-device label. For promotion, an independent reviewer must
cross-check GitHub run attempt/job IDs, actual executed steps/logs, exact
source head+tree, fixture digest, compiler-source+binary digests, native
artifact digest, real device attestation and all negative test outcomes.
NOT_EXECUTED / steps=[] cannot count as test failures or guest success.

## Proposed repositories in proposed atto-xp GitHub organization

- `attoxp-abi` — this v1 C ABI, semantic versioning, cross-language bindings.
- `attoxp-runtime` — actor/UI bridge, fenced handle table and event dispatch.
- `attoxp-ui` — `.atto` declarative views, state, navigation and core widgets.
- `attoxp-ios` — UIKit/Swift native adapter, signing, iOS simulator/device tests.
- `attoxp-android` — Android Views/Kotlin adapter, JNI and emulator/device tests.
- `attoxp-conformance` — independent negative matrix and receipt verification.
- `attoxp-examples` — minimal real `.atto` guest counter/navigation examples.
- `attoxp-build` — compiler linkage, packaging, manifest and release tooling.
- `attoxp-desktop` — later macOS/Windows/Linux adapters (not M0 mobile parity).
- `attoxp-docs` — API and security architecture documentation.

**Creation hold:** these names are proposals, not existing repos. Keep the
contract source in `ores-truffle-oreslang/oreslang-platform-conformance` until
the target org is verified and access, private source transfer, code ownership,
branch protection and independent security approval are explicitly cleared.
Existing `oreslang-platform.mobile`, `.desktop`, Java, LLVM, Wasm, .NET and
Forge repos remain compiler/platform dependencies, not automatically moved.
