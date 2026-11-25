# std/env v1 — executable parity target, not a parity claim

This suite defines **13 cross-compiler guest cases**, **10 pinned .atto source
fixtures** and **11 target backends**. The public nine-function API and portable
semantics are independent of any compiler implementation. Backend-owned
`stdlib/env.atto` sources may differ; copying Java's source into other
compilers is not a requirement or a substitute for target-specific correctness.

## The 11 targets

`atto-source.java`, `.llvm`, `.net`, `.rs`, `.forge`, `.cranelift`,
`.js`, `.wasm`, `.atto`, `.realtime`, `.hdl`.

The first eight are runtime-capable implementation tracks. `.atto` is
self-hosting/bootstrap-only today; `.realtime` is bootstrapping and must prove
bounded memory/timing before accepting environment I/O; `.hdl` must reject
unsynthesizable host environment operations instead of pretending to execute
them. **Pure** `parse_bool` could eventually be supported by a synthesizable
subset independently of runtime env access, but is not proven today.

## Required test boundary

Each guest case's `environment` is a **trusted injected snapshot**, not
`process.env`, build-time compiler environment, or host inherited variables.
`allowed` and `denied` are scoped policy inputs independently combined
with the coarse `coarse_env` capability. The runner must prove a denied
lookup does not call the host's value getter. `get_or` never masks a denial.
A present empty value is different from missing; only the opt-in `nonempty`
API collapses empty. `parse_bool` accepts exactly `true/false/1/0`.

Limits: portable ASCII keys, 128 characters max, 16 KiB UTF-8 per value,
512 authorized keys, 1 MiB per snapshot. Invalid or oversized values, deny
rules and malformed Unicode/NUL must fail closed with no secret reflection.
Do not publish environment values, commands containing secrets, or the
original private source in logs, artifacts or public issue text.

## Examples and execution

- `basic.atto`: controlled present/empty/missing and fallback semantics
- `strict_bool.atto`: strict four-spelling boolean truth table
- `invalid_bool.atto`: uppercase truthiness is explicitly rejected
- `required_missing.atto`: required errors for missing and empty
- `denied_get_or.atto`, `denied_has.atto`: key-scoped denial must escape
- `invalid_name.atto`: malformed name is not an absent key
- `isolated.atto`: no ambient PATH and independent context snapshots
- `shadow/entry.atto`: compiler-owned `std/env` must beat poisoned project
  `shadow/std/env.atto`

The `oversized-value` case injects 16,385 ASCII bytes without committing
secrets or an oversized generated fixture. `independent-contexts` runs
`isolated.atto` three times in separate contexts (alpha, beta, alpha).

The registry is **SOURCE_ONLY**. Run `node bin/verify-std-env-v1.mjs` and
`node --test tests/std-env-v1.registry.test.mjs` to check fixture Git SHA
identity, contract shape, backend enumeration and no-fake-PASS safeguards.
**These checks DO NOT compile or run Atto**. Each backend must separately
compile the actual `.atto` fixture, execute the guest with controlled host
inputs, compare exact stdout or sanitized error category, and publish a
machine-readable exact-head/tree/toolchain/target receipt. An `UNSUPPORTED`
result is valid only for a genuine, tested target restriction; zero-step CI,
host-only dispatch and synthetic GraalVM tests are `NOT_EXECUTED` guest
evidence.

## Supplemental host-snapshot quota contract (not guest evidence)

`host-snapshot-boundaries-v1.json` adds six explicit host-substrate boundary
cases across the same 11 target identities: exactly 1 MiB, one byte over,
multibyte UTF-8 accounting, a denied poisoned value, no coarse-capability key
enumeration, and 513 authorized keys. The source-only structural test is:

```sh
node --test tests/std-env-v1.host-snapshot-boundaries.test.mjs
```

This does **not** increase or silently alter the existing 13-case compiled
guest oracle, whose contract/blob is independently pinned by downstream
receipt validators. Host implementations must enforce the 1 MiB **authorized
value** budget before copying secrets; an inadmissible or denied key must
never be dereferenced or counted. Backend-owned `.atto` libraries remain
independent. The supplemental ledger defaults all 11 backend statuses to
`NOT_EXECUTED`; local C/Node host checks may be noted separately but cannot
promote compiled guest or AOT statuses.

## Overlaps and governance

- `atto-platform-conformance#574` tracks **static import constants and
  startup** `std.env.read_env` syntax, a separate stage from runtime
  `std_env.get/has` and their strict permission semantics. Reconcile the
  startup-once/non-baked-AOT boundary before claiming parity.
- Java Draft `atto-source.java#1765` is the nearest actual guest candidate.
  LLVM #871, JS #130, Wasm #280 and .NET #218 have host staging;
  Rust #534, Forge #227 and Cranelift #91 have source candidates.
- The exact-head status ledger deliberately starts all targets at
  `not_executed`, even where host tests passed locally.
- Do **not** export private compiler trees through an unapproved carrier.
  Java security issue #1788 records source-main protection and independent
  source-export approval requirements. A source-free runner probe proves
  capacity, not authority to mirror.
