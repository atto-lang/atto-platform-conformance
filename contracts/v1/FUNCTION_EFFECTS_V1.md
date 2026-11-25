# Function Effects v1

This contract is the backend-neutral target for Java/GraalVM, LLVM, .NET, Wasm, and Forge.

`with ...` is an upper bound on effects, not authority and not an exact list. State capability mode is checked separately: a read loan cannot write even when `with state.write` is present. A live state loan cannot cross suspension/blocking boundaries.

`suspend` and `block` are distinct. Cooperative suspension and nonblocking channel registration are not host-thread blocking; blocking channel operations and synchronous stdio require `block`.

Exceptional control remains distinct: `throw`, `raise`, and `panic` are separate effects. `trap` does not authorize `throw`. For actor failure escalation, an unhandled throw becomes raise, an unhandled raise becomes panic, and panic is delivered only through supervisor CONTROL.

Unknown calls under a declared effect bound fail closed unless the compiler has a trusted typed effect summary.

This file is a conformance contract, not a claim that every backend implements the full language surface yet.
