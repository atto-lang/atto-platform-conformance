;; Hostile guest Wasm import must be rejected by capability admission.
(module
  (import "unapproved_host" "network" (func $network))
  (func (export "main") call $network)
)
