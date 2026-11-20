# Batch 05 security / actor transport audit (tasks 41–50)

**Snapshot:** 2026-10-19. **Status:** source-free adversarial models plus a
direct, narrow Java IPC receipt security fix in
[PR #1503](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1503).
None of the ten upstream release gates is closed.

This does **not** authorize networking for UNTRUSTED actors. Current direct
untrusted NET access remains **DEFAULT_DENY**; a native scheduler's
UNTRUSTED label is **not** a process sandbox. Do not use these reference
models as policy enforcement or as a replacement for a protected guest bridge.

## Direct source change — Java IPC receipt origin

The existing Java host-side correlation draft
[#1438](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1438)
allowed a caller of `acceptVerified(..., OUTCOME_UNKNOWN)` to mark a receipt
indeterminate even though indeterminacy should be concluded by the trusted
**local** transport/session-loss observer, not claimed in a remote ACK.

Stacked draft [#1503](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1503)
rejects peer-origin `OUTCOME_UNKNOWN` **and `REJECTED_BEFORE_REMOTE`**
before altering any correlation or transport credit. It leaves
`retireTransportLost(session)` as the trusted-local uncertainty authority,
and introduces package-local `rejectBeforeRemote(message)` for trusted
prepublication rejection, including completion outside the bridge monitor. Negative
tests cover pre-ACK, post-ACK and unchanged host futures, plus local
prepublication failure, double-release and callback reentrancy. The 61,440-case
seeded test now uses local EOF/rejection instead of forged peer verdicts.

**Not proven:** this stacked Java patch has not yet passed executed exact-head
Java tests. Its `acceptVerified` entrypoint itself **does not perform peer
authentication**; trusted caller/adapters are still needed. Java↔LLVM
two-process transport parity remains open. Do not merge before the parent.

## New source-free threat-model coverage

`src/batch05-security-oracles.mjs` and its tests:

- **HierarchicalOutboundQuotaModel:** actor, stable lineage, supervisor and
  tenant counters; a monotonic trusted fake clock; separate rate, byte, burst
  and outstanding-credit bounds; check all scopes before charging;
  cancellation and reincarnation do not refund committed rate tokens or
  manufacture new burst capacity; shutdown seals new admissions but preserves
  physical outstanding obligations. Bounded integer settings, BigInt-nanos
  calculations, no user-identity admission parameter.
- **TrustedFdAliasModel:** opaque per-open-file-description identities minted
  at simulated trusted handoff. Duplicated descriptors share identity and
  cannot be watched twice; separate eventfds with misleadingly identical
  anon-inode metadata remain distinct. Numeric FD collisions, reuse, stale
  watches, duplicate release, open/dup storms, and watch inventory are
  fenced; closed handle objects are retired.
- **TrainingControlModel:** DATA cannot forge optimizer commit, cancellation
  or CONTROL. Simulated runtime-issued authority rotates on restart; run,
  incarnation, step and weight-version mismatches reject without state
  publication. This model has **no real runtime attestation**.
- **transportActorAdmission:** unsupported HTTP/IPC/TCP/FFI/proxy/WebSocket,
  unary, serial, and unchecked `requires`/`with` declarations remain
  non-executable rather than silently becoming ordinary actors.
- **projectClosureBindings:** deliberately uses binding identities rather
  than name spelling; unused receiver/capability slots are omitted;
  constructing receiver escape denies. Source-level Java still requires
  actual compiler name-resolution, reachability and capture lifetime tests.
- **receiptOriginDecision:** OUTCOME_UNKNOWN and REJECTED_BEFORE_REMOTE are
  trusted-local events, not authenticated-peer terminal outcomes.

These are bounded deterministic reference oracles, not Oreslang programs,
network security enforcement, native FD tracking, protected sandboxing,
compiler Send/Sync proofs, ML training actor authentication or memory
isolation.

## Original task gates — exactly ten

| Task | Upstream | Relevant progress | Required release gate |
|---|---|---|---|
| 41 | [Common #69](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/69) | Existing shared contract + hierarchy model | Trusted source sender/lineage gates on every supervisor path; protected untrusted guest bridge |
| 42 | [Java #1265](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1265) | Host quota draft #1266 has independently observed approved Java host CI | Exact Java guest source NETWORK boundary, mailbox admission, endpoint/DNS/SSRF and isolation |
| 43 | [LLVM #589](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/589) | Host-native quota helper research and conformance vectors | Actual native source send gateway and protected isolation, CTest/ASan |
| 44 | [Conformance #87](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/87) | Existing 12 scenarios on main + 45 more source-free checks in this PR | Executed Java + LLVM guest attack fixtures, receipts, source trees |
| 45 | [LLVM #645](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/645) | New source-free anon-inode alias identity model | Trusted real FD handoff and NIO manager duplicate watch tests |
| 46 | [LLVM PR #654](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/654) | Unsupported transport parser fail-closed draft exists | Actual compiled parser-negative CTest and complete target adapters |
| 47 | [Java PR #1406](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1406) | Metadata/adapter denial draft exists | Full Graal JDK25 source parser/typechecker runtime tests |
| 48 | [ML #11](https://github.com/ores-truffle-oreslang/oreslang-ml/issues/11) | Host-only capability and incarnation oracle | Supervisor-issued actual guest CONTROL, typed TrainingError and compiler parity |
| 49 | [Java #1267](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1267) | Java PR #1175 now uses LambdaCapturePlanner/Env.snapshotCaptures rather than a full ambient snapshot on the inspected branch | Binding-identity name resolution, implicit/explicit receiver nonescape, weak-reference reachability in compiled guest and Native Image |
| 50 | [Java PR #1438](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1438) | Direct source hardening in stacked PR #1503 | Source-local Java tests, native peer parity, authenticated real IPC adapter |

All ten entries remain `PENDING_PRODUCTION_GUEST_PROOF` in
`audits/batch05-untrusted-transport-security.json`.

## Current CI evidence — carefully scoped

The externally run private approved host job
[run #39207273400](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra/actions/runs/39207273400)
**reported SUCCESS**, independently confirmed through GitHub's job records.
It executed SHA-verified actual Java ActorRuntime host JUnit, then repeated
the security tests five additional times. This is evidence for the prior Java
[#1266](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1266)
head. It is **not evidence for this batch's new PR #1503** or full
guest-to-host NETWORK containment, and is not blanket authorization to copy
other private trees across organizations.

On the new Java source PR #1503, sampled source-org Actions
[run #39292607099](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39292607099)
reported failure and `steps:null` in the sampled polyglot/native jobs:
actual Java test execution on this exact head is **unobserved**. Such metadata
is not proof of an implementation regression or insufficient Actions minutes.

## Running the reference checks

```sh
node --test tests/batch05-security-oracles.test.mjs
node --test tests/batch05-security-evidence.test.mjs
npm test
```

**51/51 source-free model and inventory checks passed in an isolated V8
test harness with Node assertion shims.** That is **not** the real
Node `--test` runner, compiled Oreslang guest, Maven, CTest or Native Image.
Repo main's existing `tests/supervisor-outbound-inventory.test.mjs` remains
separate: do not replace the accepted contract's 12 scenarios.

## Security and merge sequence

1. Review Java draft #1438 → #1503, run source-local strict Java parity
   shell/JUnit on the exact stacked head; add malicious authenticated-peer
   receipt and local disconnect host cases.
2. Wire quota admission and permissions at all Java/LLVM guest outbound
   supervisor and mediated network entrypoints; no bypass via FFI/proxy,
   actor output, parent reply, send, or a lineage restart.
3. Add actual trusted NIO FD handoff identities and anti-ABA close/watch
   tests. Never infer identity from Linux anon-inode dev/ino alone.
4. Authenticate ML CONTROL by supervisor/runtime authority, prohibit string
   command fallbacks and enforce atomic run/incarnation/step/version checks.
5. Compile runtime guest fixtures and record exact source-tree, actual test
   steps and independently reviewed backend reports. Only then update
   release-gate statuses.

No private source export, untrusted network grant, live FD handle mutation,
account approval, issue closure or merge is performed by this PR.


## Follow-up audit and attempted source-local CI rerun (Oct 19)

- Source-head Java [#1503](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1503) now distinguishes **both** local outcomes (uncertain EOF and never-sent prepublication rejection) from authenticated peer ACK/COMMIT/FAIL. Methods for prepublication reject are **package-private**, not public guest APIs. Source JDK21/JUnit and native guest execution remain **unobserved**.
- The conformance FD model now rejects creating two trusted handle identities for a simultaneously live numeric descriptor and does not accidentally model unreviewed `dup2` overwrite authority. Numeric reuse after close/retirement is still permitted with a distinct opaque identity. Reference tests: 51/51 isolated V8-shim, not the Node CLI.
- Failed source-local Actions attempts were retried via GitHub connector: conformance run [39302748822](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/39302748822) attempt 2 and Java run [39302640852](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39302640852) attempt 2 both concluded failure again with `steps:null`. This cannot certify failure cause, node --test, javac, or Oreslang guest tests.
- The cross-org mirror option remains **blocked** by private-CI policy PR #1217: incidents conformance #22/#77 open, no independent approvals binding this exact source tree and destination repo ID. Earlier approved carrier run #39207273400 is scoped to an older Java host quota source snapshot and is **not** permission to export PR #1503 or conformance PR #123.


### Additional seeded adversarial checks (same audit)

The exact-fetched model and inventory suite now passes **51/51** isolated V8-shim checks, including **50,000 deterministic hierarchical quota steps** and **20,000 FD open/dup/watch/retire transitions**. These uphold bounded counters, exact credit cleanup, numerical FD identity exclusivity, and no accidental quota refund across restart/cancel. Unlike actual Node `--test`, this evaluator does not exercise Node module-loading behavior.

[Private canary #39303220290](https://github.com/ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra/actions/runs/39303220290) succeeded at 18:31 UTC on Oct 19. This shows that the separate private test organization's runner recently executed a **source-free canary**, but does not measure its remaining GitHub Actions minutes or authorize any private source transfer. The mirror dispatcher PR #1217 still blocks exports while incident #22/#77 and independent exact-repo/tree approvals remain incomplete.

## October 19: Explicit IPC dispatch-commit publication fence

Stacked Java [PR #1503](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1503) now has a source-level three-phase receipt chain:

```text
LOCAL_ADMITTED --commitDispatch()--> DISPATCH_COMMITTED --verified peer ACK--> REMOTE_ACCEPTED
       |                                  |                                |
       | local rejectBeforeRemote()       | trusted transportLost()        | verified HANDLER_COMMITTED / FAILED
       v                                  v                                v
REJECTED_BEFORE_REMOTE                OUTCOME_UNKNOWN                  terminal receipt
```

- Both `commitDispatch` and `rejectBeforeRemote` are package-local trusted-host calls serialized by the same correlation monitor. A never-sent local rejection is **invalid after successful dispatch commitment**. An authenticated remote receipt cannot transition from LOCAL_ADMITTED to REMOTE_ACCEPTED.
- Dispatch commitment **precedes the first possible physical network write**, but does **not** prove that any byte reached the peer. A write exception after commit must be classified as uncertain unless a separately authenticated transport witness proves an unsent frame; no automatic replay is allowed.
- `DISPATCH_COMMITTED` retains one outstanding transport credit until verified peer ACK, final local loss or other supported terminal retirement. EOF snapshots distinguish LOCAL_ADMITTED, DISPATCH_COMMITTED and REMOTE_ACCEPTED.
- Java host tests now include **512 real two-thread commit-vs-reject races in each of the correlation ledger and completion bridge**, plus the existing 512 ACK-vs-EOF races and the seeded 61,440-transition suite. Newly authored exact-head Java cases are **not yet verified as executed** by javac/JUnit/Native Image.
- Source-free `IpcPublicationFenceModel` has eight new falsification tests, exhaustive **120 serial orderings** across commit/reject/ACK/DONE/EOF and **100,000 deterministic fault-event sequences**. The current combined reference-model/inventory suite is **59/59 isolated V8-shim tests passed**; this is not real Node `--test`.
- **Mandatory remaining physical proof:** the actual authenticated socket/proxy adapter must bind `commitDispatch` to its trusted per-session generation/close lock and a one-shot send lease, ensuring no guest or stale actor can send after session revocation. The host-only correlation model does not enforce kernel/socket/FD ownership or independently prove a write could not occur before calling `commitDispatch`. No LIVE IPC adapter or fully protected UNTRUSTED network capability is enabled.

Do not claim that this source-level publication state resolves the entire physical network publication race; its linearization applies only to host receipt bookkeeping until the transport ownership gate is implemented and tested.
