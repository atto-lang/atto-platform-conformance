# Source and platform governance contract v1

Scope: every `oreslang-source.*` and `oreslang-platform.*` repository in
`ores-truffle-oreslang`. The canonical coordination inventory is
`integration/repositories.json`; the platform promotion semantics are in
`contracts/platform-capabilities-v1.json`. Neither JSON file is an
authenticated record of an executable compiler, target run, or branch rule.

Run `npm run governance:source-platform` or `npm test`. The source-family
audit requires **nine** source members (Java, LLVM, .NET, Wasm, Forge, JS,
Cranelift, Rust and HDL) and **six** platform members (mobile, desktop,
embedded, IoT, FPGA and ASIC) with typed, non-promoting integration edges.
It rejects missing/extra family names, false role assignments, missing target
profile links, platform repository substitution, and weakening the existing
evidence-stage and non-evidence policies. The 54-member coordination inventory
also includes non-source/platform repositories.

## Change control

1. Update the canonical integration registry and this audited source/platform
   family list together. Never silently classify a new backend as fully
   conformant, or treat Cranelift as Forge or native Rust as LLVM.
2. Add or update `.oreslang/integration.json` in each member on its own
   reviewable PR. Run `bin/audit-member-checkouts.mjs` on **clean, pinned
   checkouts** after all member changes land. A local registry pass does not
   establish remote member synchrony.
3. Review the platform capability contract, typed target profile and actual
   compiler/runtime support as **separate contracts**. Changes to stages,
   evidence exclusions or target identities require a versioned governance
   review and negative tests, not an undocumented metadata edit.
4. A source feature requires real positive and negative guest compiler runs
   pinned to source/tree and compiler binary. A platform capability requires
   the evidence at its claimed stage; emulation is not physical hardware.
5. Reviewer-verified source ownership, protected-branch rules and successful
   executed CI jobs are separate external gates. Their status must be
   `UNVERIFIED` when GitHub read permission or runner execution is missing.
6. Private-source mirrors are forbidden without explicit pre-copy incident
   clearance, verified private allowlisting, and independent approval.
   A git hash proves integrity, **not authorization**.

The validator's output intentionally contains `evidence:"metadata-only"`
and false execution/parity fields. This code cannot issue a release
certification or authenticate GitHub Actions. New member PRs must not be
merged until reviewed against the exact inventory commit.
