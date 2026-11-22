# AttoLang std/metrics, std/json and std/zorde — nine-backend parity admission

**Contract:** `contracts/std-metrics-json-zorde-nine-backend-v1.json`.

This is a **source-free reference contract**. It does not compile Atto code.
The three public namespaces are `std/metrics`, `std/json`, and
`std/zorde` (NOT `std/serde`). Every compiler owns its own local
`.atto` sources. Identical source bytes are neither required nor proof of
behavioral parity. Existing `alloc/json` and independent Zorde schema
implementations must not be overwritten.

## Target matrix — no invented passes

| Backend | Required execution target | Initial verdict |
| --- | --- | --- |
| java | JVM guest + separate Graal Native Image | NOT_EXECUTED |
| llvm | native executable + ASan/UBSan where supported | NOT_EXECUTED |
| net | .NET guest and Windows/Linux NativeAOT | NOT_EXECUTED |
| wasm | Rust-produced guest Wasm + browser/Node worker | NOT_EXECUTED |
| forge | independent JIT and AOT guest execution | NOT_EXECUTED |
| rs | native Rust compiler -> executed guest Wasm | NOT_EXECUTED |
| cranelift | independent Cranelift compiled guest | NOT_EXECUTED |
| js | real Atto -> JS emitted guest Node/worker execution | NOT_EXECUTED |
| hdl | synthesis-capability review and scalar RTL simulator | NOT_EXECUTED |

The `wasm` repository currently delegates source-to-Wasm compilation to
`atto-source.rs`. This is **not** an independent second compiler and must
not count as a second independent compiler result. An HDL target may declare
individual dynamic JSON/heap-based capabilities unsupported only after an
enforced, independently verified target-profile decision; it must not fake
a positive guest test or silently substitute host JS semantics.

## Required semantic coverage

1. **Metrics:** bounded counter/gauge updates, inclusive histogram buckets,
   sample/sum overflow rejection, rejected-sample accounting, detached
   Counter/Gauge/Histogram snapshots, and isolated actor ownership.
2. **JSON:** complete grammar and Unicode surrogate validation; duplicate
   unescaped/escaped object keys; quotas; exact i32/i64 signed boundaries
   without float rounding; preserve original decoded documents. Full
   `JsonValue` and streaming/typed APIs remain separate integration milestones.
3. **Zorde:** experimental ZORD bootstrap framing, canonical unsigned
   varuint31, noncanonical/truncated/overflow rejection, ZigZag31,
   schema ID and version guards, exact payload lengths, atomic reads/writes,
   and no actor capability/pointer serialization. The experimental envelope
   must not be confused with the production Zorde ecosystem's wire standard.

Shared vectors are source-free *oracles*, not compiler proof. Each backend
must execute equivalent `.atto` positive and negative fixtures using its
own real compiler/runtime. Future backend-owned implementations may use
different algorithms or capacities only when public semantic constraints
are preserved or an explicit unsupported target profile applies.

## Strong evidence is required for PASS

A `PASS` needs pinned source commit/root Git tree, compiler commit/tree,
test-plan SHA256, test-artifact SHA256, backend and target, successful
actual non-setup CI steps, nonzero executed guest test counts, zero
skips/failures, and an independently verified immutable workflow run.
A JSON receipt is **not trusted** solely because its fields have the correct
shape. Resolve and verify the GitHub run, jobs, actor, exact source and
artifact provenance through a separately authenticated verifier.

`queued`, `startup_failure`, zero-step, host-only, source-only,
`skipped`, stale-head and missing receipts all remain **NOT_EXECUTED**.

## Current work and dependencies

- Java `atto-source.java#1787`, LLVM `atto-source.llvm#885`:
  initial source modules, guest fixtures and source-only audit; real
  compiler/AOT execution not yet evidenced.
- Java `alloc/json` PRs #1118/#1124/#1125/#1126/#1133/#1134:
  recursive value-tree and typed decoding integration.
- `atto-serialization-and-validation` schema work:
  independent Zorde codecs and wire validation.
- Remaining compiler repositories: stage backend-owned source and
  source-only checks, then compile the actual guest programs and
  log explicit unsupported capability diagnostics.

## Private cross-org runner recovery

Alternative GH Actions carrier selection must follow the protected private
source-export guard. Even when an alternate organization has minutes,
**do not mirror source** without independently approved exact source HEAD,
root tree, destination owner/repository ID, permitted readers, retention,
workflow/test-plan digest and enforcement of these guards.

Once authorized, use the GitHub connector to create a temporary **private**
branch in the carrier. Verify every file path, mode, blob SHA, full root tree
SHA and clean checkout before execution. The carrier checks out its *local*
mirror with its own token; no PAT or cross-org checkout secret is used.
Unapproved export: **NO MIRROR**, not a self-authorized exception.

## Local reference-only check

```sh
node --test tests/std-metrics-json-zorde-nine-backend.test.mjs
```

This confirms the portable contract and receipt **structure** only;
no compiler conformance result may be inferred from its success.


## Backend-local staged PRs (all draft / guest NOT_EXECUTED)

- Java: [#1787](https://github.com/atto-lang/atto-source.java/pull/1787);
  LLVM: [#885](https://github.com/atto-lang/atto-source.llvm/pull/885)
- .NET: [#231](https://github.com/atto-lang/atto-source.net/pull/231);
  Wasm: [#293](https://github.com/atto-lang/atto-source.wasm/pull/293)
- Forge: [#238](https://github.com/atto-lang/atto-source.forge/pull/238);
  Rust: [#552](https://github.com/atto-lang/atto-source.rs/pull/552)
- Cranelift: [#103](https://github.com/atto-lang/atto-source.cranelift/pull/103);
  JS: [#143](https://github.com/atto-lang/atto-source.js/pull/143)
- HDL scalar subset: [#72](https://github.com/atto-lang/atto-source.hdl/pull/72)

Each six additional software-backend PRs stage independent local source
and the exact 36 metrics + 36 JSON + 55 Zorde stdout oracles as **future**
guest execution targets. Per-file Git blob SHAs are included in the
backend-local expected stdout manifests. A digest-pinned `--runner`-style
candidate harness fails closed on missing binary, changed blobs and stdout
mismatch, but **does not authenticate its own compiler**. HDL has a limited
26-vector scalar contract instead of fake dynamic JSON/Zorde synthesis.

The private runner candidate and all nine source head/root-tree pins are
recorded only as a **non-authorizing proposal** at
`contracts/std-metrics-json-zorde-private-carrier-proposal-v1.json`.
The explicit denial test is
`tests/std-metrics-json-zorde-carrier-export-denial.test.mjs`. This is
not an effective source-side allowlist or reviewer authorization.
