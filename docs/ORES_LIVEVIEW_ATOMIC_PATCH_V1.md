# LiveView atomic patch decision contract (draft, host-only)

This registry complements the 41-case RFC6455 wire oracle. The shared application
contract requires a server to send **snapshot** instead of **patch** when its
diff violates the browser's atomic prevalidation of old DOM identities.

Examples include moving a keyed ID between independent parent subtrees, or
replacing a node's children while mutating attributes on that same node.
Replacing the *entire* LiveView root can move existing child identities safely.
Disjoint subtree changes and new child IDs should continue to use patches.

The fixture contains ten deterministic before/after trees and expected frame
types. Java/GraalVM, LLVM, Wasm host adapter, Forge/Cranelift and .NET Native AOT
must eventually execute an Oreslang guest producing the matching output.
Wasm requires a host-provided adapter for WebSockets.

The validator rejects missing, duplicate, wrong-result, zero-step, and unpinned
backend reports. Synthetic reports explicitly return
backend_parity_certified:false. Independent GitHub runner provenance, guest
artifacts, native execution, and source security approval are required.
