# Namespace actor receiver v1 — candidate contract

This is a **candidate conformance specification**, not a claim that any
AttoLang compiler currently executes the examples. The JSON matrix at
`contracts/namespace-actor-receiver-v1.json` defines 28 cases over four
distinct proof stages: parser AST, static nominal binding, future typed
contract checking, and future guest runtime.

## Normative intended behavior

- `declare actor Foo;` is the canonical nominal actor header when methods and state are attached outside the declaration. `declare pub actor Foo;` makes the type publicly accessible. The opposite ordering `pub declare actor Foo;` is rejected. The signature-only spelling `define actor Foo;` must fail, while `define actor Foo as ... end` remains the fully inline implementation form.

- `namespace foo;` joins files **only within one verified package instance**.
  Namespace spelling alone does not establish package ownership.
- `declare actor Foo implements ActorXYZ;` is a nominal actor declaration,
  not the constructor of an empty actor object and not a proof that
  `ActorXYZ` was implemented. An actor-targeted contract needs complete,
  direct, public, concrete and exact-signature witnesses.
- `pub mtd (Foo f) bar(): void` is a receiver-targeted actor method. Its
  receiver is **not** an ordinary function parameter or a raw state pointer.
- Out-of-line methods are keyed by verified package, namespace, actor,
  method name and value-parameter arity. Duplicate slots, inherited
  ambiguity and wrong-package or wrong-namespace lookup must fail closed.
- Calling a method from within an existing actor turn keeps that same
  logical nonreentrant turn. Calling through an external ActorRef must
  enter the bounded mailbox and cannot acquire a state loan directly.
- For declared actors, `external mtd (Foo f) init(): void` is a
  **private activation-only ingress** and `external mtd (Foo f)
  receive(ActorMail<T> mail): void` is a **private mailbox-only ingress**.
  Ordinary `pub mtd init` / `pub mtd receive` and any raw actor return
  are rejected at static binding. The runtime-only marker cannot mint
  execution authority or be used on unrelated methods. Real actor
  activation and mailbox dispatch remain future gates.

## Evidence semantics

`accept_ast_only` is **not** guest acceptance.
`accept_metadata_only` is **not** contract conformance or dispatch.
`accept_after_real_witness` means a future backend can claim the case
only after implementing a checked, authenticated contract witness.
All 28 cases presently report `NOT_EXECUTED` across Java, LLVM, .NET,
Wasm, Forge and JS, regardless of authored source in any backend PR.

A backend must publish exact compiler SHA/root tree, fixture blob hashes,
nonzero executed test steps, stable diagnostics for rejects, no output
artifacts on rejection and, where applicable, actual actor runtime receipts.
A source-free canary or a zero-step GitHub Actions failure never qualifies
as backend parity. No private source export is authorized by this corpus.

## Implementation references

- Java draft #2892: canonical declaration, attached state and explicit ingress static admission without actor execution
- Java draft #2887: earlier source AST and nominal binder admission
- Java draft #2823: package-keyed cross-file receiver source indexing
- Java draft #2792: actor-targeted contract foundations, separate stack
- Java draft #2813: manifest-backed namespace source inventory
- Java draft #2828: inherited slot and mailbox payload security hardening

Future versions must unify those paths and prove the same cases on all
backends before expanding the acceptance matrix.
