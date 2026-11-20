# Mandatory lambda pipes — parser-target conformance v1

The canonical lambda grammar requires both parameter pipes: `|...| -> body`,
including in `const fnc` expressions. Bare `_ : int -> 5` and `_ -> 5`
are prohibited. `|_|` means one ignored parameter; `||` means zero.

The manifest embeds exact source fixtures to allow future backend parser runners
to submit each source independently, checking acceptance/rejection *before*
typing and code generation. Do not consider a rejection satisfactory merely
because `const fnc` declarations are unsupported; the `val` fixtures test the
same syntax independent of the `const fnc` feature.

All backend evidence is `NOT_EXECUTED`. The accompanying Node test verifies
registry integrity, not actual parsing, compilation, execution, or parity.

Run the host-only check:

```sh
node --test tests/lambda_mandatory_pipes_v1.test.mjs
```
