# Native Oreslang TestKit lifecycle v2: five-backend conformance

Status: **host-only, unauthenticated reference oracle and test matrix**.
The Rust CLI production validator lives in
[oreslang-test.cli PR #23](https://github.com/ores-truffle-oreslang/oreslang-test.cli/pull/23).
The pure Oreslang test API is `stdlib/testing.ores` in
[Java PR #2393](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2393);
its overlap with [PR #2395](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2395)
must be reconciled separately. No source-language async TestKit implementation is
added or implied by this contract.

## Five requested backend identities

| Backend ID | Scope checked on source main | What cannot be claimed |
| --- | --- | --- |
| `java` | Existing Oreslang test library and actor scheduling | Typed test task scopes, authenticated actor/callback lifecycle receipts |
| `llvm` | Native actor continuations and callback delivery policy | End-to-end source-language test probe/await completion |
| `wasm` | Worker-based isolation and core Wasm capability admission | Native source actor TestKit execution or imported host I/O |
| `cranelift` | Separate scalar Cranelift JIT | Actors, async/await, callback test execution; never substitute Forge |
| `net` | Actor runtime and trusted-host Task observation | Guest Future/Task/actor TestKit and physical retirement proof |

**Current five-backend lifecycle guest evidence: unverified.** Do not infer
parity from this matrix. Unsupported/rejected syntax is not an executed positive
test. The backend set is exact: `java, llvm, wasm, cranelift, net`.

## Behavioral contract

Each run emits `ORES_TEST_V2|RUN_BEGIN|2` once, then test cases with
`CASE_BEGIN`, zero or more `OPEN`/`CLOSE` pairs, exactly one `CASE_END`
and terminal `RUN_END`. Resource kinds are `callback, task, actor, await`.
Every handle is unique within one test, even across kinds, and is settled once.
`ok`, `error`, or `cancel` are possible CLOSE outcomes. A PASS is
invalid with pending work or any error/cancel; a SKIP cannot hide resource activity;
a FAIL must also have completed declared cleanup. Cases may interleave, but each
retains its own resource namespace and terminal state. Run summary counts must
match individual case events; zero executed, all skipped, malformed, duplicate,
late or missing event records fail closed.

Canonical machine lines are ASCII and LF-terminated. Reserved `ORES_TEST`
prefixes cannot be hidden in unrelated output. Case IDs and handles are
1..256 bytes from `[A-Za-z0-9_./-]`; up to 10,000 total discovered tests,
100,000 machine events and 4 MB output. The independent JS reference and the
Rust PR validator intentionally share these bounds.

## How to run reference tests

```sh
node --test tests/testkit-lifecycle-v2.test.mjs
```

The test suite exhaustively checks 24 completion orders and 81 terminal status
vectors, as well as missing/wrong/double resource settlements, cross-kind reuse,
cross-case spoofing, summary mismatch and backend evidence gating. It runs
without a compiler and **cannot** establish native Oreslang guest execution.

For a future backend observation to be *structurally admitted*, it must provide
an explicit `GUEST_EXECUTED` state, positive executed job-step count, exact
source SHA, compiler SHA-256, and a consistent v2 receipt. This is still
`UNAUTHENTICATED_METADATA_ONLY`: a malicious guest can forge stdout and
an untrusted JSON manifest can invent jobs or hashes. Real verification must
independently inspect signed/authorized runner-job metadata, compiler identity,
real task/actor retirement and logs. A verified host unit model never upgrades
to native guest parity, and an `UNSUPPORTED` row is not a test pass.

## Compiler-backed next gates

1. Reconcile the two Java stdlib harness PRs and prove `ores.std/testing` import
   identity in each compiler. Preserve v1 compatibility.
2. Implement the compiler/runtime-owned scoped lifecycle event producer, with
   real callbacks, child task joins, actor probes, cancellation, panic CONTROL,
   generation fences and physical retirement.
3. Compile and execute real `.ores` positive/negative fixtures on **each** of
   the five backends. Record unsupported features explicitly, without replacing
   execution with a synthetic host oracle.
4. Check compiler/source SHA, repeatability seeds, stepful exact-head runs, and
   error exit vs inconclusive outcomes before any parity/release claim.
5. Respect the current private-source transfer hold; different Actions budgets
   are not authorization to mirror protected code across organizations.
