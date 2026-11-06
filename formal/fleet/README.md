# Multi-organization formal / AttoLang coverage registry

This is a **scope-and-evidence** registry for the 50 distinct organizations requested on 2026-11-05 (one duplicate `okla-platform` was deduplicated). It is not a declaration that all 50 organizations have been modified or formally verified.

Each row has one focused semantic target, either formal-only or formal+AttoLang, and an evidence class. **Model-checking is not source refinement; source-level `.atto` is not executed guest proof.** A future `guest-verified` row must include exact head and artifact SHA, compiler provenance, nonempty executed steps, negative fixture pass, and independent review. Zero-step CI cannot promote a claim.

`check_coverage.cjs` validates the exact requested set, required citations for work under review, and fails on three negative mutations: dropped organization, forged guest status and missing review URL.

The nine `source-model-draft` rows point to actual new PRs, all awaiting independent review and production/guest refinement. Other links point to pre-existing peer work under review; no CI passes are implied. `access-unconfirmed` identifies organizations not resolved by the connected GitHub search, not nonexistent organizations.

Run: `node formal/fleet/check_coverage.cjs`.
