# ML provider source-lock admission within the 56-repository registry

The `integration/ml-source-blob-lock.v1.json` metadata has the **identical Git blob ID** `8f2091191a2614dac49063cc701f15d2c00dbdcd` in this repository and the private `oreslang-ml-conformance` stacked PR #5. It records the reviewed 14 Oreslang source units, 52 imported symbols and two direct source edges, **Autograd → Tensor** and **ML → Autograd**.

This is narrower than the proposed registry DAG: its additional **ML → Tensor** edge is a *future consumer/contract dependency*, not a direct source import observed from the reviewed ML `.ores` programs. Likewise Tensor's target Java/LLVM compiler dependencies have **not** been converted to verified guest parity.

`npm run check:ml-source-lock` and `src/ml-source-lock.mjs` validate source-path/SHA metadata, prohibit unknown or missing providers, and require the two existing source edges to be represented in the organization's *planned* graph. The test suite includes adversarial changes and a snapshot check against the actual 56-repository inventory.

The check intentionally does **not** download source files, contact other organizations, compile Oreslang, or infer release readiness. Its result is `SOURCE_BLOBS_LOCKED_NOT_COMPILED`. Only the conformance repo's `scripts/check_workspace_imports.py` can check actual private source bytes **inside an already-authorized, immutable, locally checked-out source workspace**. That Python gate is invoked after commit/tree/dirty-worktree admission and before the opt-in guest probe.

Under P0 security incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77), do not move private code to alternate Actions organizations without the separately reviewed source-export policy, even when that organization has available minutes. All source-org CI/guest execution evidence remains blocked until runnable, protected CI and independently approved source-to-compiler provenance exist.

Maintain the snapshot as a **review-frozen compatibility candidate**; any provider source file changes require deliberate updates to the locked Git blobs and exact workspace commits/trees, plus re-running the real source import and compiler/guest matrix. Do not silently repin mutable branch heads.
