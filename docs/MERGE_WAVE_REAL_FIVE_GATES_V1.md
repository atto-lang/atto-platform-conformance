# AttoLang real five-gate integration proof v1 (advisory)

This isolated draft child stacks on conformance PR #531 without modifying its head, any independently owned upstream PR, `main`, branch protection, runner policy, organization billing, secrets, compiler code, or other agents' branches. Production safety remains **fail-closed**: no merge executor, approval action, source export, or release authorization is included.

## Reproduced compatibility bug

Parent #531 `tools/merge-wave-canonical-evidence-v1.mjs` blob `edaac6d720ebc31fe7f3d16125f52339ccab8379` accepted **only uppercase** letters in incoming blocker codes. The actual offline qualifier emits lowercase reason codes such as `QUALIFIER:active_or_unknown_agent_lease`. Running the **five genuine implementations together** produced a valid source-bound snapshot but incorrectly set `contract_valid=false` with `BLOCKER_CODES_INVALID`. The scoped source change allows ASCII lowercase/uppercase letters, digits, underscores, colons, and hyphens, preserving the 160-byte limit and rejecting newlines/control characters. This corrects a diagnostic false-negative, not an unsafe merge or a proof of authenticated independence.

## Five real gate dependencies

The test uses these exact GitHub source commits and verifies their immutable Git blob object IDs before executing modules:

| Component | Source PR | Pinned commit | Pinned Git blob |
|---|---|---|---|
| Reviewer timeline | #477 | `e4bc75bb4ca6db5eca03b944fef1658637a7635f` | `6c48511d311a0fc453b9dfdf10c0ecc9a09bbb36` |
| Run/job/step ledger | #481 (stacked on #467) | `ebffa81813ed61c82c2a4cd8f6861afac641931e` | `97eb079e4bf3819771fee49b4c2d3209925329ae` |
| Qualifier | #474 (stacked on #470) | `a377ea19440e6a69d87e4bfea73625ba247a3fee` | `adb025c93e73d1c0ccf236604d8fd7d5429b893a` |
| Live collector / pagination | #483 | `978211a03187e9364154a58412b8a4ec888fea85` | `f6a37ad3066228b5cbe0050709652b9689f4b53f` |
| Integrated adapter (UTC fix) | #512 (on #486) | `f9d79551cc77412f26800cb2ed3449cb144f9b1a` | `ec5293ec292b008178112b98363c99e2016fec8d` |

The source module loader reads only local same-repository immutable Git objects via `git show <commit>:<path>`, verifies `SHA1("blob "+byteLength+"\\0"+fileBytes)` against the explicitly pinned Git blob, then imports the verified module bytes via Node's in-memory data-URL module loader. The upstream files are **not copied into this PR**. Missing Git objects, changed byte contents, unexpected imports, missing exports, invalid UTF-8, or unavailable Node built-ins terminate the test without a synthetic pass. No network access is used by the test module; the separately declared CI preflight fetches only these five exact commits from the SAME source repository using contents:read.

This pinned test characterizes the explicit source versions, not whatever later GitHub HEADs might contain. Any upstream change requires independent version-pinned requalification and refreshed manifest IDs.

## Native Node 22 reproducible command

First fetch the five immutable commit IDs into the same private checkout (or use the proposed pinned read-only source-owned workflow); then run:

```sh
node --test tests/merge-wave-real-five-gates-v1.test.mjs
```

The source-owned workflow `.github/workflows/merge-wave-real-five-gates-v1.yml` explicitly checks out the ORIGINAL PR head, verifies the Git tree, fetches the same-source pinned commits, verifies all source Git object IDs, runs Node 22, requires **140 registered tests, 140 passed, zero failed**, and preserves a clean Git worktree after the suite. Actions/checkout and setup-node are SHA-pinned. Workflow success alone still does not prove independent source workflow integrity, CODEOWNERS authority, protected main, or compiler-backed guest parity.

## 140 adversarial and control cases

The suite has **17 fixture categories × 8 independently numbered PR/run/job instances = 136**, plus four wave/evidence-integrity cases:

- Exact-source positive *structural* execution; every subgate can report positive source-local structure, but canonical output stays `BLOCKED`.
- Runnerless zero-step job, revoked change request, future review timestamp, invalid reviewer calendar day, duplicate review IDs.
- PR HEAD drift on final read, source-tree drift across collections, missing check/run counts, wrong job attempt and head identity.
- Invalid observation timestamp, branch protection HTTP 403, unprotected main, duplicate step number, and absent run inventory.
- Exactly five unique PRs across three different source repos, replay of one PR five times, forged favorable authorization flag, lowercase diagnostics versus control-character rejection.

All cases execute the **actual five functions**, not mocks of policy decisions. Only the GitHub GET transport is a bounded, deterministic fixture. A synthetic protected branch or eligible reviewer is *test data*, not real server authority. No case may imply that private compiler-backed `.atto` guest code executed, independent reviewers signed, artifacts were attested or any PR should merge.

## Evidence and release hold

At creation, isolated V8 with Node-compatible test/assert substitutes executed 140/140 focused case callbacks against the exact GitHub-fetched source functions; the parent #531 implementation failed 10/140 cases while the patched implementation passed 140/140. This is a host-level proof of code behavior, **not native Node 22, GitHub-hosted exact-head execution, or compiler guest parity**. The source-owned job must complete with a real runner and stepful assertions before native CI can be credited.

Conformance `main` was last observed unprotected; private Actions may still fail with `runner_id=null` and `steps=[]`. Leave this PR DRAFT and unmerged until private runner admission, protected branch rules, genuinely independent security review, source-owned exact-head execution, and actual guest/back-end assertions are verified. No source mirroring to another organization is authorized.
