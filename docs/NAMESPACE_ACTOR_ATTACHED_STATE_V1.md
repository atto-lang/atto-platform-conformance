# Namespace actor state, declaration and critical access — candidate v1

## Canonical AttoLang surface

```atto
namespace foo;

declare pub actor Foo implements ActorXYZ;

define state on actor Foo as {
    let int x: 5;
}

// The receiver method is *attached* to Foo; it is not a free function.
pub mtd (Foo f) get(): int {
    return handle_state(critical-read |s| -> s.x);
}

pub mtd (Foo f) increment(): void {
    handle_state(critical-write |s| -> {
        s.x = s.x + 1;
    });
    return;
}
```

`pub declare actor Foo;` is invalid: declaration modifiers follow `declare`, just as in `declare pub actor Foo;`.

**Syntax stage only:** the full example above is NOT currently an executable
Atto program. Contract witness linking, attached state loan/MIR lowering and
out-of-line actor dispatch have distinct proof gates.

`declare actor Foo;` is the *body-free nominal declaration*. Explicit
`implements Contract` stores an obligation, not evidence that methods meet
the contract. `define actor Foo as ... end` remains the full inline
implementation form. `define actor Foo;` must be rejected to distinguish
these states. Public out-of-line APIs require an explicitly public actor type
(`declare pub actor Foo;`).

## State and method authority

- `define state on actor Foo` is a private state *schema*, not a global
  singleton, shared mutable object, or second actor. One verified package
  instance, namespace and nominal actor determine the schema.
  Only a `declare actor` nominal header may adopt this out-of-line schema;
  inline `define actor Foo as ... end` cannot mix in a second state layout.
- Each actor activation owns its physical state instance. Schema fields
  initialize to typed constant values after allocation under runtime
  control. No arbitrary initializer call, global pointer or reflection
  capability may create a writable alias.
- Ordinary out-of-line methods may access state **only** inside compiler
  owned `handle_state(critical-read ...)` or
  `handle_state(critical-write ...)` scopes. A method-level
  `critical` flag alone is insufficient when it could span `await`.
- Read scopes admit concurrent shared immutable borrows when physical
  isolation and same-actor logical turn rules permit; write scopes admit
  exactly one mutable loan with writer fairness, no active readers, and
  cleanup on unwind. Both are nonescaping and nonsuspending.
- A supervisor holds a control capability, not actor state ownership.
  Generation/activation fencing and physical quiescence govern STOP,
  restart, cancellation, migration and cleanup.
- Cross-file attachment must prove package-root inventory, source unit
  identity, duplicate/type/method collision checks and actor contract
  witnesses before executable lowering. The caller-provided source map
  is not proof of manifest ownership.
- The initial Java static schema proposal accepts up to 128 fields of
  `let int name: signed_i64_literal;`. This is a deliberately narrow
  parser/metadata subset, **not** the permanent state type system.
  No real critical guest execution is certified.

## Evidence and promotion

The companion `contracts/namespace-attached-actor-state-v1.json`
contains **20** parser, static-linker, future typecheck and future runtime
cases. `NOT_EXECUTED` is required until backend-specific immutable exact
source and fixture receipts exist. Source-free canaries do not count.

Require a nonzero executed JUnit/compiler test run, typed guest positive and
negative cases with stable diagnostics, no output on rejection, physical
actor isolation and lifetime tests, actual NativeAOT/LLVM/.NET/Wasm/Forge
proof, and independent approved review before changing these states.

Java draft implementation: a follow-up stacked on Java PR #2887.
Portable namespace receiver precursor: conformance PR #706.
