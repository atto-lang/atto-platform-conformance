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

Run `node --test tests/atto-theater-v1.test.mjs` and `node bin/verify-atto-theater-v1.mjs`. They verify the registry, all twenty required positive/negative semantic cases, and negative evidence admission. This is **source-free validator coverage only**, not a target guest test. `--require-certified` deliberately exits nonzero until an independent authenticated verifier has validated exact GitHub run metadata and artifacts.

Each backend must independently compile the same versioned `.atto` fixtures, execute the generated guest artifacts on the declared target, record source HEAD/tree SHA, compiler binary digest, fixture blob/source digests, target mode and actual nonzero-step CI run. All required cases must execute and assert. Record `passed`, `failed`, `unsupported`, or `not-executed` distinctly. An unsupported profile requires a typed compile-time rejection with a negative test; an empty job, host reference model, parser-only test or interpreter AOT substitute never constitutes a pass. **No self-submitted receipt certifies parity**, even if it matches the schema; independent verifier queries must authenticate the GitHub workflow run and job, compare source and artifact digests, and inspect the executed steps and guest output.

## Integration order and overlapping work

1. **Director / lifecycle:** reconcile Java supervision [#1547](https://github.com/atto-lang/atto-source.java/pull/1547) with [issue #114](https://github.com/atto-lang/atto-source.java/issues/114), then implement portable restart strategies and lifetime fences; preserve supervisor-only panic and bounded CONTROL.
2. **Ensemble / pubsub:** use [spec #198](https://github.com/atto-lang/atto-spec/pull/198), Java callback-safe teardown [#1491](https://github.com/atto-lang/atto-source.java/pull/1491), and LLVM pub/sub [#575](https://github.com/atto-lang/atto-source.llvm/pull/575); reconcile rather than replace [conformance #451](https://github.com/atto-lang/atto-platform-conformance/pull/451). LLVM is blocked on guest lowering and actor-context authorization.
3. **Theater integration:** compile a single application that starts nested supervisors, subscribes to a group-scoped typed topic, restarts a failed subscriber and demonstrates one-time unsubscribe and shutdown cleanup.
4. **Backend parity:** port only target-specific primitives; require independent compiled guest positive *and* negative cases across the complete eleven-repo inventory.
5. **CI:** where source-org Actions cannot schedule, use an independently approved private carrier and token-free exact-Git-tree mirror; do not transfer private source without source-side approval. Verify every copied blob SHA and executed job. A source-only contract job is never a guest certification.

## Known limitations of this first change

The new manifest is a denial-oriented admission schema, not a compiler implementation or proof of parity. `candidate-only` means *structurally eligible for independent review*, not passed. This repository cannot establish trusted external workflow provenance from a PR-controlled JSON file. No implementation or backend status is promoted by CI on this change.
