# complex128 wire v1

This contract defines a **source-free serialization target**, not evidence that
any Oreslang compiler or runtime currently implements it.

A complex128 scalar occupies exactly 16 bytes:

1. bytes 0..7: real IEEE-754 binary64 bits, little-endian
2. bytes 8..15: imaginary IEEE-754 binary64 bits, little-endian

Finite values, infinities, subnormals and the sign bit of zero are preserved
bit-for-bit. NaNs are different: every signaling/quiet, signed or payloaded NaN
is encoded as the single canonical quiet-NaN bit pattern
`0x7ff8000000000000`. A decoder MUST reject any noncanonical NaN bit pattern
on the wire rather than silently accepting multiple encodings.

The NaN rule is intentional. Runtime arithmetic tests may inspect raw NaN
behavior, but a portable actor/wire format should not inherit host-specific NaN
payloads or create multiple byte strings for the same language-level NaN value.
Signed zero is preserved because it can affect later IEEE arithmetic.

This scalar wire contract does **not** authorize Matrix/Vector transport,
pointer/native-handle transport, or actor capability serialization. Those need
their own bounded formats and ownership rules. The five backend status fields
remain `unverified` until exact-head backend codecs execute this contract.
