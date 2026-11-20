# Four-layout oracle audit — 2026-10-21

Scope: draft PR #146, the portable **host-side** reference oracle. This is not an Oreslang guest compiler, actor-private heap, benchmark winner, backend conformance certificate, or OS sandbox. Review alongside platform-conformance issue #144 and proposed architecture PR #145.

## Security/correctness findings and mitigations

| Finding | Impact before hardening | Mitigation and regression |
| --- | --- | --- |
| Reentrant row getter may dispose the LayoutStore while `push()` subsequently writes a row | A retired store could be mutated by a later `push` that skipped `reserve()` | Guard untrusted input evaluation, reject reentrant public operations, release guard in `finally`; row-getter mutation test |
| Prototype-sensitive field names (e.g. `__proto__`) misrepresented in whole-row `get()` | Direct field reads and whole-row snapshots disagreed | Use explicit own data properties in returned records; run all four physical layouts |
| Unchecked mutable-borrow option type | Truthy non-booleans could request a write loan | Enforce boolean and reject malicious option getters |
| Reentrant conversion options / mutable caller-owned group definitions | Layout changes could depend on mutated configuration or invalid intervening operations | Snapshot groups, guard configuration evaluation and preserve stable checked offsets |
| Reallocation and invalid row inputs | Could cause partial writes, stale backing retention, or undercharged peak allocation | Validate entire row before mutation, scrub former backing after copying, and charge both old/new buffer allocations |
| Incorrect physical stride assumption | Packed payload byte-size incorrectly treated as aligned record stride | Check physical AoS/SoAoS/SoA/AoSoA offsets, including tail tiles and padding |

## Testing completed, and evidence still missing

- Exact branch at latest audit commit: `adae1a9e49ad7fba1dc9ab8265241b7461fb1ae1` (check subsequent PR updates for newer heads).
- 17 test cases executed through a standalone strict-mode JavaScript harness built from the exact GitHub source/test blobs. The harness approximates Node assertions and is **not** a `node --test` GitHub CI run.
- Includes deterministic seeded 2,048-operation differential history over five physical configurations: AoS, SoA, AoSoA widths 4 and 16, and grouped SoAoS. Cases cover generation IDs, swap-erase, field writes, layout conversions, reentrancy, numeric boundaries and field-sensitive loans.
- GitHub Actions run `39680783731`, job `119502399344`, `failure`, **zero executed steps**. This is neither a test failure diagnosis nor proof that this branch ran in GitHub CI. Budget exhaustion is possible but not proven from this metadata.

## Source confidentiality and alternate-org runners

This source repository is private. Security incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) were still open on 2026-10-21. The incident runbook demands independent approval covering exact source commit/root-tree, destination owner/repository numeric ID, verified private visibility, protected admission and review. That gate is not satisfied by spare Actions minutes, a GITHUB_TOKEN, or a private destination. **No cross-org mirror or source-bearing carrier was published during this audit.**

Only resume authorized Git-tree mirroring after documented and verified security clearance. Until then, repeat source-org tests or source-free independent checks without calling them real compiler validation.

## Outstanding release checks

1. Run the exact PR head on real Node 22+ GitHub Actions with nonempty executed steps, pin check runs and logs.
2. Independent code review and run across relevant Node versions; repeat fuzz/property cases with a Node-owned assertion engine.
3. Differential comparison against *compiler-produced physical layout* and *actual generated guest execution* for each of GraalVM, LLVM, Wasm, JS and .NET.
4. Validate actor arena shutdown, borrows across `await`, revocation, transfer, worker isolation, and real ECS benchmark profiles separately.
5. Keep tracker #144 boxes **unchecked** until their independent acceptance criteria are met.
