# Actor panic CONTROL: bounded contract

Run `node formal/check_actor_control.mjs`. This finite-state explorer uses
two admitted data messages and one panic, enumerates all reachable transitions,
checks priority CONTROL delivery, conservation of mailbox admissions, closed
mailbox discards, one supervisor notice, and no actor-side panic interception.
Deliberately unsafe mutants must be rejected, and each significant edge must
have a reachable witness.

**Scope:** Abstract reference model only. This does **not** execute a real
AttoLang compiler or guest runtime, and does not prove fairness, actor-lock
exclusivity, direct sealed-state access rejection, or borrow safety over
`await`/`select`. It is not evidence of five-backend parity.

**Promotion:** Compile/execute exact-head positive and negative fixtures on
Java, LLVM, .NET, Wasm and Forge. Record backend/compiler SHAs, exit codes,
supervisor CONTROL observations, direct-state compile errors, critical
read/write exclusion, and borrow-across-suspension tests.
