# Atto Theater v1 — all `atto-source.*` parity admission

**Status: NOT CERTIFIED.** This source-only contract does not prove the eleven compilers execute any guest fixture. It does not rename `Supervisor`, `ActorGroup`, `ActorRef`, `Topic<T>` or `Subscription<T>` or add language keywords.

## Architecture

- **Atto Theater:** OTP-style application and lifecycle composition.
- **Atto Director:** supervisor trees and restart policies; preserves the `Supervisor` API.
- **Atto Ensemble:** independently authenticated group membership, typed topic subscriptions, backpressure and cleanup. Membership is *not* a subscription.
- **Atto Runtime:** backend-owned actor execution, mailboxes, isolation and authenticated priority CONTROL; DATA cannot forge CONTROL.

The portable policy belongs in `atto-common-source` as `.atto` when expressible. Backend-specific host code must expose only minimal capability-checked primitives. Reuse [atto-common-source#74](https://github.com/atto-lang/atto-common-source/issues/74), [atto-spec#199](https://github.com/atto-lang/atto-spec/pull/199), [atto-spec#198](https://github.com/atto-lang/atto-spec/pull/198) and existing backend branches rather than implementing conflicting APIs.

## Coverage and initial evidence

All eleven repositories are included in the normative contract; **none is declared guest certified** by the new manifest. `atto-source.atto` has not completed self-hosting, and `atto-source.realtime` is a bootstrap only. Hardware/HDL capability limits must be justified in the target profile, not silently marked passing or removed from the matrix.

| Backend | Repository | Theater guest evidence in this contract |
| --- | --- | --- |
| Java | `atto-source.java` | Not executed |
| LLVM | `atto-source.llvm` | Not executed |
| .NET | `atto-source.net` | Not executed |
| Wasm | `atto-source.wasm` | Not executed |
| Forge | `atto-source.forge` | Not executed |
| Cranelift | `atto-source.cranelift` | Not executed |
| Rust | `atto-source.rs` | Not executed |
| JavaScript | `atto-source.js` | Not executed |
| HDL | `atto-source.hdl` | Not executed; target feasibility pending |
| Atto self-hosted | `atto-source.atto` | Not executed; bootstrap pending |
| Real-time | `atto-source.realtime` | Not executed; bootstrap pending |

## Executable gate

Run `node --test tests/atto-theater-v1.test.mjs` and `node bin/verify-atto-theater-v1.mjs`. They verify the registry, all twenty-eight required positive/negative semantic cases, and negative evidence admission. This is **source-free validator coverage only**, not a target guest test. `--require-certified` deliberately exits nonzero until an independent authenticated verifier has validated exact GitHub run metadata and artifacts.

Each backend must independently compile the same versioned `.atto` fixtures, execute the generated guest artifacts on the declared target, record source HEAD/tree SHA, compiler binary digest, fixture blob/source digests, target mode and actual nonzero-step CI run. All required cases must execute and assert. Record `passed`, `failed`, `unsupported`, or `not-executed` distinctly. An unsupported profile requires a typed compile-time rejection with a negative test; an empty job, host reference model, parser-only test or interpreter AOT substitute never constitutes a pass. **No self-submitted receipt certifies parity**, even if it matches the schema; independent verifier queries must authenticate the GitHub workflow run and job, compare source and artifact digests, and inspect the executed steps and guest output.

## Integration order and overlapping work

1. **Director / lifecycle:** reconcile Java supervision [#1547](https://github.com/atto-lang/atto-source.java/pull/1547) with [issue #114](https://github.com/atto-lang/atto-source.java/issues/114), then implement portable restart strategies and lifetime fences; preserve supervisor-only panic and bounded CONTROL.
2. **Ensemble / pubsub:** use [spec #198](https://github.com/atto-lang/atto-spec/pull/198), Java callback-safe teardown [#1491](https://github.com/atto-lang/atto-source.java/pull/1491), and LLVM pub/sub [#575](https://github.com/atto-lang/atto-source.llvm/pull/575); reconcile rather than replace [conformance #451](https://github.com/atto-lang/atto-platform-conformance/pull/451). LLVM is blocked on guest lowering and actor-context authorization.
3. **Theater integration:** compile a single application that starts nested supervisors, subscribes to a group-scoped typed topic, restarts a failed subscriber and demonstrates one-time unsubscribe and shutdown cleanup.
4. **Backend parity:** port only target-specific primitives; require independent compiled guest positive *and* negative cases across the complete eleven-repo inventory.
5. **CI:** where source-org Actions cannot schedule, use an independently approved private carrier and token-free exact-Git-tree mirror; do not transfer private source without source-side approval. Verify every copied blob SHA and executed job. A source-only contract job is never a guest certification.

## Known limitations of this first change

The new manifest is a denial-oriented admission schema, not a compiler implementation or proof of parity. `candidate-only` means *structurally eligible for independent review*, not passed. This repository cannot establish trusted external workflow provenance from a PR-controlled JSON file. No implementation or backend status is promoted by CI on this change.

## Ensemble typed publication and canonical ownership extension (revision 2)

The parity gate now requires **eight additional** compiled-source guest cases for every backend, not an optional interpretation of the earlier generic fan-out cases:

- Canonical `val receipt = topic.try_publish(share! event)?` in a Result-returning, actor-authorized callable, with actual guest execution of success and original `PublishError` early exit.
- `rt share event` is a backwards-compatible **checked** ownership alias; `share !event` is rejected. The operand evaluates once. Borrowed/move-only/mutable or forged authority does not become shared.
- Full RELIABLE publication rejects **atomically** across all subscribers with no partial enqueue, sequence increment, leaked quota, or consumed ownership. A receipt reports admission, not processing acknowledgment.
- `Subscription.next()` / `try_read()` read a dedicated bounded subscription queue, **not** the actor DATA mailbox.
- Stale group membership, mismatched topic types, and cross-group authority fail before publishing.
- All targets must reject unsupported policies or invalid topic payload/effect profiles **before** executable artifact emission. A backend that genuinely implements RELIABLE must still accept its valid canonical guest source; a backend without source-level pub/sub may reject that source but must **not** be certified. Compile-time denial of an unsupported feature is a safety negative, never substitute for the required positive guest cases.

The source surface is aspirational until backend implementations exist. In particular, `?` must not be interpreted as a magically allowed operator in a void-returning actor `receive`; the canonical positive requires a genuinely `Result<PublishReceipt, PublishError>`-returning callable executing on an authenticated actor turn. Existing Java [pubsub #1458](https://github.com/atto-lang/atto-source.java/pull/1458) and [postfix question #735](https://github.com/atto-lang/atto-source.java/pull/735) have separate incomplete integration work. LLVM [pubsub #575](https://github.com/atto-lang/atto-source.llvm/pull/575) has a native substrate but not compiled guest parity. No backend status is promoted in this change.

All eleven `atto-source.*` compilers must fulfill the 28-case compiled guest matrix before this version can be certified. A syntactically valid self-attested receipt can at best be `candidate-only`, requiring independent GitHub job/artifact authentication.

## 2026-11-21 exact-HEAD source inventory

The separate [mainline audit snapshot](../verification/atto-ensemble-pubsub-main-audit.json) pins the eleven observed `main` commits and concrete pub/sub-related filename evidence. It is an inventory, **not a guest test** and not evidence that missing filenames mean a missing implementation. In particular:

- Java `main`: actor pub/sub source/runtime and an intentionally rejected source `try_publish` fixture; [Java integration #1458](https://github.com/atto-lang/atto-source.java/pull/1458) is separate and still unverified.
- LLVM `main`: actor-group runtime/source foundations. Native pub/sub is on [LLVM #575](https://github.com/atto-lang/atto-source.llvm/pull/575) and stacked UTF-8/receipt ABI hardening on [#590](https://github.com/atto-lang/atto-source.llvm/pull/590), not proven compiled guest parity.
- .NET and Wasm `main`: pub/sub host runtime and explicit source-admission or source-gate files; no independent executable `try_publish(share! event)?` evidence was inspected.
- Cranelift `main`: a copied portable pub/sub contract, not executable guest proof.
- Forge, Rust, JavaScript, HDL, Atto self-hosted, real-time: no pub/sub-named files matched the recursive `main` tree path scan. **Unknown implementation coverage, NOT_VERIFIED**; static filename scanning cannot prove absence.

Do not silently classify any of these eleven as `PASS`, `IMPLEMENTED`, or `CERTIFIED` from the filename scan. Every one must prove the 28-case guest matrix or remain an explicit unsupported profile. The source-side cross-organization private export hold applies to testing; do not mirror private source without independent security authorization.

### Newly authored defensive source gates (not semantic parity)

- [.NET source admission #200](https://github.com/atto-lang/atto-source.net/pull/200): rejects unlowered `.try_publish(share! event)?` and its compatibility argument spellings *before* CIL/NativeAOT. Authored C# tests; no stepful `dotnet` execution.
- [Wasm source admission #265](https://github.com/atto-lang/atto-source.wasm/pull/265): same fail-closed predicate before the native LLVM/Wasm bridge, while preserving inert strings/comments and unrelated free functions. Exact tokenizer/source-gate functions exercised in V8 with an ASCII decoder shim: 5/5 denials and 4/4 inert controls, **not** full Node or Wasm guest execution.
- [Atto pubsub spec #198](https://github.com/atto-lang/atto-spec/pull/198) now enumerates all eleven backends rather than six. None has been promoted to backend-verified.

These changes reduce accidental unsupported guest acceptance, **not** implement `Topic<T>.try_publish` on .NET or Wasm. Their source heads are recorded in the inventory snapshot; the `mainSha` fields remain unchanged because the changes are in draft PRs.

### 2026-11-21 canonical Ensemble alias-only source identity

A single **byte-identical** negative .atto fixture now exercises the alias-only
`imported_topic.try_publish(share! event)?` path across compiler drafts.
The source originated in LLVM pub/sub PR #575; it deliberately omits
`actor.group(...)` and `Topic<T>` declarations, so only recognizing those
declaration patterns would silently miss it.

- Git blob **`c562ad380bb283da9ffa26160653c1186ab63462`**; path in this
  repository: `fixtures/atto-ensemble-v1/canonical-unlowered-try-publish.atto`.
- Identical blobs in .NET PR #200, Wasm PR #265, JavaScript PR #119, HDL PR #54,
  Forge PR #219 and LLVM PR #575. Source identity tests are pinned into the
  corresponding compiler branches. No private source has been exported to another organization.
- JavaScript and HDL now explicitly deny aliased `.try_publish` **before**
  generated JS or SystemVerilog emission; .NET and Wasm reuse their already
  existing actor-pubsub source-admission gates. Forge #219 now adds a C++20
  scanner at all three native source entry points, but its source-only GCC/Clang
  sanitizer runs used stub frontends; full Forge CTest is still NOT_EXECUTED.
  String/comment-only mentions must not be mistaken for a capability call.
- These are compiler-negative/fail-closed **partial parity improvements**, not
  functioning topic publication, RELIABLE fanout, supervised actor execution,
  28-case guest conformance, or evidence of a stepful GitHub Actions job.

Never infer passing guest parity from the canonical fixture's Git SHA or
this source-only contract. On implemented targets the legitimate typed
`Result<PublishReceipt, PublishError>` form should eventually compile and run,
and on unsupported targets the compiler must reject it with a typed diagnostic.


### Unsigned-u64 publishing, exhaustion and Full precedence (2026-11-21)

The portable `Topic<T>.try_publish(share! event)` receipt has a **nonwrapping
unsigned 64-bit topic sequence**. The first admitted publication has sequence
1; zero is reserved for a refused/uncommitted receipt. The wire receipt uses
**unsigned decimal text** so values 2^63 through 2^64-1 are not interpreted
as negative Java `long` values. At committed sequence 2^64-1, every further
publication **hard-fails exhaustion before transient queue Full**, even if a
subscriber queue is also full. A Full refusal must not consume any sequence
or pending-writer credit, partially deliver, or create a phantom receipt.

This semantic gate is pinned by explicit `ensemblePublication` fields in
`contracts/atto-theater-v1.json`; the source-only validator and downgrade
regression test reject a signed-only or wrapping interpretation.

- Java draft [#1458](https://github.com/atto-lang/atto-source.java/pull/1458)
  now checks exhaustion under the delivery lock before queue reservations,
  while still committing a sequence only after atomic RELIABLE preflight.
  The JUnit test creates a real one-slot subscriber and checks signed-boundary
  admission, Full rollback, zero phantom delivery, next contiguous sequence,
  and the simultaneous exhausted+Full case. The exact-head script runs
  `mvn clean test` and checks method names in new Surefire reports.
- LLVM child draft [#590](https://github.com/atto-lang/atto-source.llvm/pull/590)
  already uses checked `uint64_t` native sequences. Its compiler-negative
  admission script now snapshots each source in a private workspace and fails
  if a purported diagnostic also writes IR or another file, or mutates input.
  A five-case source-free checker self-test is registered in CTest and
  required by the exact-head workflow.

Only the source-free checker and contract-validator adversarial tests have
been exercised outside source CI. No Java JUnit/GraalVM guest or LLVM compiler
build/CTest has run on the amended exact heads. **0/11 Theater guest-certified**;
zero-step GitHub Actions remains a runner-admission blocker, and private
cross-org mirror is denied absent independent source security approval.
