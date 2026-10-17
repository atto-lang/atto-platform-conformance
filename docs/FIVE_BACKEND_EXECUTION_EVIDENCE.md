# Five-backend native-execution evidence ledger (draft v1)

This source-free ledger complements `src/five-backend-scalar.mjs`. The original checker proves **fixture source identity only**. The new `src/five-backend-evidence-ledger.mjs` validates the shape of a structured declaration of native execution evidence for **all five** `oreslang-source.*` backends.

It **does not authenticate GitHub API responses, inspect build logs, verify artifact contents, execute the Oreslang guest, certify parity, or authorize private-source transfer**. It deliberately returns `EVIDENCE_SHAPE_ONLY_NOT_AUTHENTICATED` and `parityCertified:false` even when all five backends contain apparently complete execution claims. Never promote a release from this offline checker alone.

## Canonical scalar fixture

- File: `contracts/v1/semantics/fixtures/add.ores`
- Expected exact Git blob: `015f8b0f79aafa796a148d2adeff1574e8d6c491`
- Source: `pub fnc main(): int { return 40 + 2; }` followed by a newline
- Expected **executed** guest value: `42`
- Backend keys: `oreslang-source.java`, `.llvm`, `.net`, `.wasm`, `.forge`

See `contracts/v1/semantics/five-backend-evidence.pending.json` for the current explicit **pending** baseline.

## States and proof fields

Every manifest must contain exactly five distinct backend records. Each record is one of:

- `pending`: No conformance success claim. Requires a reason; forbids an execution object.
- `unsupported`: An explicitly unsupported feature or native backend path. Requires a reason; forbids an execution object.
- `executed-claimed`: A **declaration**, not verified truth. Requires a specific source blob, repository numeric ID, immutable head commit and tree, workflow ID/path/blob, run ID and attempt, event, native job and step, actual guest/compiler execution flags, native execution mode, toolchain, executed fixture ID and count, observed value 42, and test-log/artifact SHA-256 digests.

Boolean and zero-valued IDs, duplicate/missing backends, arbitrary workflow events, mismatched numeric repository IDs, wrong execution mode or result, empty test counts, missing digests, and source-only claims are rejected.

## Offline shape check

From the repository root (Node 22+):

```sh
npm test
node --input-type=module -e '
  import {readFileSync} from "node:fs";
  import {validateFiveBackendEvidenceManifest} from "./src/five-backend-evidence-ledger.mjs";
  const m = JSON.parse(readFileSync("contracts/v1/semantics/five-backend-evidence.pending.json", "utf8"));
  console.log(JSON.stringify(validateFiveBackendEvidenceManifest(m), null, 2));
'
```

The static example has zero claimed executions and five blocked records. There is no release-ready `pass` conclusion.

## Required independently authenticated release gates

1. Verify private source confidentiality, protected-main review, destination numeric repository ID and explicit cross-org source-transfer approval. No branch-local allowlist can authorize transfer.
2. Fetch the GitHub run and attempt directly through a read-only authenticated API; independently pin source repo ID, HEAD commit/tree, workflow bytes, path/ref, event, job and step names, and reject zero-step runs. Use the five-backend `verify_ci_run.py` for the applicable source evidence.
3. Verify **real backend-native guest execution** and test count in each backend's own logs and outputs; check artifact SHA-256 from downloaded bytes, not just a filename or claimant-provided digest. Do not confuse compiler invocation with `--validate` or source-only checks.
4. Require explicit result `42` for the common scalar fixture plus backend-appropriate negative cases. Pending/unsupported does not count as executed parity.
5. Only an independent release controller combining authenticated provenance **and** inspected native test execution artifacts may report five-way parity certified. This module never does so.

Current background blockers: [private-source exposure incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22), [source protection #994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994), and [publisher authorization #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962). These are not bypassed by available alternate-org GitHub Actions minutes.

## Second cross-backend scalar contract — arithmetic precedence

Canonical fixture: `contracts/v1/semantics/fixtures/precedence.ores`

```oreslang
pub fnc main(): int { return (2 + 3) * 8; }
```

The file includes a trailing newline and has exact Git blob
`2d09e697ad4eeac4ee263c3656b92998c67f0bfc`. Java and LLVM's
existing semantics manifests require **executed result 40**. The .NET
conformance PR #19 adds Windows Native AOT executable execution;
Forge PR #11 requires both real IR and interpreter results; WASM
[PR #61](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/61)
requires pinned LLVM compiler and actual Wasm guest execution.

`verifyFiveBackendScalarPairSourceIdentity(workspace)` now validates
**both** pinned fixture bytes across five adjacent private source checkouts
(10 ordinary regular files) using the existing bounded, nonblocking,
no-follow descriptor checks and pre/post read identity guards.
It returns `SOURCE_IDENTITY_ONLY_NOT_EXECUTION` and
`parityCertified:false`. Seven adversarial Node unit tests exercise
correct source identity, mutation, missing fixture or backend, swapped
files, symlink rejection and invalid workspace input.

**Parity status: PENDING execution.** This source identity extension is
not proof the five backends accepted or ran the fixture. The current
single-fixture `EVIDENCE_SCHEMA` remains scoped to `native.add`;
do not fold a precedence-only source manifest into that schema or
declare five-way numeric parity until independent native result-40
receipts, matching source/commit/tree pins and negative tests are
authenticated for all five.
