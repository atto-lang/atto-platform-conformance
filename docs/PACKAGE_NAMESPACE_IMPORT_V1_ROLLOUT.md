# Package namespace import v1 — backend rollout ledger

**Status:** DRAFT. The canonical syntax is specified by
[atto-spec #150](https://github.com/atto-lang/atto-spec/pull/150).
This ledger separates grammar admission, compiler linking, and **guest execution**.
The linked PRs are draft implementations and MUST NOT be promoted as full parity.

## Contract

```atto
import pkg 'z';
import pkg 'z' as zed;
import module math from pkg 'utils';
import * as helpers from './helpers.atto';
```

The shorthand binds only the declared **public** package-export namespace to
the implicit final package-name component, or to an explicitly selected alias.
The importing source's `use namespace` identity does not change.
Qualified member lookup must be static and identity/visibility checked, with
no ambient filesystem scan, foreign source evaluation, or new guest privileges.

## Progress and evidence

| Repository | Scope of current work | Executed compiler+guest evidence |
| --- | --- | --- |
| [atto-spec #150](https://github.com/atto-lang/atto-spec/pull/150) | Normative shorthand grammar and collision/visibility rules | NOT_APPLICABLE (specification) |
| [atto-platform-conformance #241](https://github.com/atto-lang/atto-platform-conformance/pull/241) | 23 syntax/binding cases; host-only reference model | NOT_EXECUTED |
| [atto-format #48](https://github.com/atto-lang/atto-format/pull/48) | Preserving syntax, aliases, unused-import conservatism | NOT_EXECUTED |
| [atto-source.java #478](https://github.com/atto-lang/atto-source.java/pull/478) | Parser admits shorthand; unverified package graph explicitly rejected | NOT_EXECUTED |
| [atto-source.llvm #296](https://github.com/atto-lang/atto-source.llvm/pull/296) | Parser recognizes syntax; rejects before IR; five negative fixtures | NOT_EXECUTED |
| [atto-source.rs #465](https://github.com/atto-lang/atto-source.rs/pull/465) | Parse-only target headers admit shorthand; executable import linker rejects | NOT_EXECUTED |
| atto-source.net | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.wasm | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.forge | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.js | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.cranelift | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.hdl | No verified shorthand implementation in this rollout | NOT_EXECUTED |
| atto-source.atto | Bootstrap seed; no verified implementation | NOT_EXECUTED |
| atto-source.realtime | Bootstrap seed; no verified implementation | NOT_EXECUTED |

*“No verified implementation in this rollout” is not a claim that a
repository lacks all package-import capabilities; exact current-head
backend audits are still required.*

## Promotion gates

1. Reconcile canonical `import pkg` with older `import namespace`,
   `import pkg NAME from` and `import * as NAME from pkg` grammar without
   granting alternate parsing paths broader authority.
2. Resolve the manifest and lockfile selected **package instance** through
   authenticated source inventory and package-root policy; reject traversal,
   symlink aliases, stale pins and unsupported dependency selectors.
3. Bind only publicly exported modules/functions/types with privacy and
   `pub[pkg]` restrictions, no accidental namespace flattening or re-export.
4. Reject collisions with imports and top-level declarations *regardless of
   declaration order*; aliases may not change package ownership or identity.
5. Preserve initialization ordering, side effects and reachability in AOT;
   do not mistake package discovery for an eager import of all exports.
6. Execute actual multi-package Atto guest programs plus negatives on the
   **exact PR heads**, including JVM/Graal, LLVM/native AOT, Rust/Wasm,
   .NET Native AOT, Forge, JS, Cranelift and relevant embedded profiles.
7. Record reproducible source SHAs, accepted guest output/exit status,
   rejection diagnostics, no-IR/no-artifact proofs and actual executed
   runner steps. A queued or zero-step workflow is **NOT_EXECUTED**.
8. Require cross-backend semantic parity and security review before
   reclassifying a draft as merge-ready.

## Current reference-model receipt

23 out of 23 contract entries matched the independent host-only
reference binding model during preparation. That does **not** constitute
execution of the checked-in Node test module or of a compiler, guest,
runtime, production package resolver, or AOT emitter.
