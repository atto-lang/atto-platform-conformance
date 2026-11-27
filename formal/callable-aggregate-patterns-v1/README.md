# Callable aggregate patterns: proof obligations and refinement gate

Companion to [atto-spec #260](https://github.com/atto-lang/atto-spec/pull/260), [Java #1919](https://github.com/atto-lang/atto-source.java/pull/1919), and [Rust #636](https://github.com/atto-lang/atto-source.rs/pull/636).

## Claim boundary

A reference semantics, a bounded exhaustive model, a source-only parser test, and a compiler implementation refinement proof are different evidence. None implies another. A backend may claim only the profile for which its actual typed IR, ownership transitions, generated program, and execution evidence have been checked. A proof of this model is not a proof that a backend implements it.

## Mathematical contract

Let a root signature be S = (T_0,...,T_(n-1)). Each argument expression evaluates once in left-to-right order to a value v_i of T_i (or propagates its exception before later evaluation). A pattern is an irrefutable tree: variable, discard, exact tuple node, or selected named data-field node. A resolved field selector is a declaration identity, not a runtime lookup string. A projection path is (root index, typed sequence of tuple indices / resolved field identities).

A valid pattern tree is checked against the root type before runtime. Its leaves have distinct binder names (except discard), correct visibility, no duplicate sibling selectors, compatible declared types, and a statically valid projection path. All leaves are in one callable-local scope. The ordinary formal signature has n slots regardless of leaf count.

For the Copy-scalar profile, let R(P,v) recursively interpret a checked pattern against an aggregate value; let L(P,T) produce a typed projection list and let E execute those projections. The primary refinement obligation is:

    E(L(P,T),v) = R(P,v)     for every well-typed v : T

Equality includes bindings and binding order, local rebinding mode, and unchanged root identity/value. A discarded leaf contributes a checked projection but no binding. No selector invokes a getter. An invalid pattern has no admitted plan and cannot produce executable guest code.

### Structural induction argument (Copy-scalar profile, paper proof)

Base binder: a valid leaf binds the value at its root path with its declared mode; the reference interpreter and the projection operation bind that same value and mode. Discard: both perform no visible binding. Tuple induction: exact arity establishes a bijection between child index and input element; concatenate child lists in order, and apply the induction hypothesis to each element. Named fields: uniqueness and visibility checks establish a valid resolved field identity for each requested child; concatenate child plans in source order and apply induction to the selected value. Extra fields are not read. Multiple roots: concatenation over root indices preserves root-slot count and argument order. A duplicate binder or unresolved path has no derivation. This proves the abstract equation only, assuming pure, total data projections and checked Copy leaves; it does not prove the implementation of a parser, checker, or code generator.

## Obligations and evidence

| ID | Invariant | Required evidence |
| --- | --- | --- |
| P01 | Root count/ABI never equals leaf count by accident | Typed signature and call lowering comparison |
| P02 | Projection type, exact arity, static field existence and visibility | Checked derivation and negative cases |
| P03 | No repeated/omitted/reordered argument evaluation; early exception stops evaluation | Instrumented guest trace including throwing arguments |
| P04 | Reference/compiled binding equivalence, source-order projections | Independent reference oracle and compiled traces |
| P05 | Unique binder names, alias collision rejection, discard not a binding | Parser and semantic negative checks |
| P06 | Copy scalar rebind affects only local | Guest state trace |
| P07 | Non-Copy conservation: one owner or exactly one drop per resource | Typed ownership transition replay, drop traces on normal/exceptional exit |
| P08 | Shared/exclusive loans overlap only when compatible; no loan outlives root | Borrow proof, disjoint path checks, suspension/escape cases |
| P09 | No hidden deep clone, getter, state access, allocation or implicit dereference | IR/codegen inspection and relevant execution traces |
| P10 | Pattern/type/ownership rejection emits no guest artifact | Compile-only negative tests, artifact absence |
| P11 | Formatter preserves pattern tree and signature | Parse/format/parse typed equivalence |
| P12 | Independent backend refinement | Exact source/tree, toolchain, binary, fixture and actual executed evidence per backend |

## Ownership theorem still owed

For non-Copy resources, a root is a unique ownership anchor. Each resource is live in exactly one owning place, or dropped exactly once. Loans are non-owning and are tied to an existing root and a resolved path. Shared loans can coexist with other shared loans; an exclusive loan conflicts with every overlapping loan, including ancestors and descendants. Disjoint paths may be proven independent. Moving or dropping an overlapping path with a live loan is forbidden. Partial moves invalidate overlapping whole-root uses. Escape, suspension, cancellation, unwinding, destructor order and actor isolation must be independently checked. A scalar model cannot discharge those obligations; backend acceptance must fail closed until supported.

## How to use the bounded model

Run `node formal/callable-aggregate-patterns-v1/check.mjs`. The checker compares an independent recursive reference evaluator against a typed projection-plan evaluator over a finite domain, exercises invalid patterns, checks argument order including faults, and requires concrete counterexamples for intentionally broken lowerings. A successful model result is labeled MODEL_ONLY. The finite bound is deliberately explicit; recursion, visibility, aliasing and ownership outside the modeled subset remain unverified. No source compiler is invoked by this checker.

## Executed model receipts (2026-11-26)

The exact authored JavaScript functions were executed in an isolated JS runtime and their committed source text was fetched back and byte-compared. These are **MODEL_ONLY** results, not a Node/Actions run or compiler certification.

- `check.mjs`, Git blob `d97c6fa76181fdf913660cd963369835bf59474a`: 261 shapes, 9,083 one-root plans, 6,084 two-root plans, 91,412 binding-equivalence comparisons, 54,996 local rebind checks, 18 dual-rejected invalid patterns, 15 argument-effect cases, 6 detected lowering mutants.
- `ownership.mjs`, Git blob `dc3180a9e78048e12087ca3152cc38915ee807e3`: exhaustive reachable-state exploration for three distinct resources, five projection paths and two loan slots. 282 reachable states, 1,769 accepted and 9,793 rejected transitions, 502 read checks, 159 move checks, 27 close checks. Each enabled step preserves resource conservation, single destruction and loan compatibility, and agrees with an independently written leaf-set admission predicate. Five known incorrect transition variants produce counterexamples: incompatible loan overlap, moving a borrowed path, duplicated ownership, double drop, and closing with a loan.
- Run `node formal/callable-aggregate-patterns-v1/ownership.mjs` to reproduce the ownership model and inspect concrete counterexamples. Model close is an abstract, idempotent destruction operation, not a verified language-level destructor sequence. No exceptional unwinding, cancellation, concurrency, escape, NLL, actor authority, nominal generic layout, real memory representation, or actual compiler implementation is certified.

The scalar checker is exhaustive only over its enumerated grammar: all generated depth-one shapes, selected depth-two shapes with at most one aggregate child, two scalar values per scalar type, and representative two-root pattern/value pairs. It is not exhaustive over arbitrary depth, integers, nominal class layouts, alias patterns or compiler syntax. The structural induction argument above extends the abstract Copy-scalar rule under its assumptions, not the implementation.

Next: attach independent translation validation to each backend's actual checked IR and compare independently collected compiled guest traces, then prove the ownership IR transitions refine the resource/loan specification. A model PASS or matching stdout alone is insufficient.
