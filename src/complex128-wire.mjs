const CANONICAL_QNAN = 0x7ff8_0000_0000_0000n;
const EXPONENT_MASK = 0x7ff0_0000_0000_0000n;
const FRACTION_MASK = 0x000f_ffff_ffff_ffffn;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

function parseBits(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]{16}$/.test(hex))
    throw new TypeError("complex128 component bits must be 16 lowercase hex digits");
  return BigInt("0x" + hex);
}
function isNaNBits(bits) {
  return (bits & EXPONENT_MASK) === EXPONENT_MASK &&
         (bits & FRACTION_MASK) !== 0n;
}
function canonicalComponent(bits) {
  return isNaNBits(bits) ? CANONICAL_QNAN : bits;
}
function hex16(bits) {
  return (bits & U64_MASK).toString(16).padStart(16, "0");
}

export function encodeComplex128Wire(realBitsHex, imaginaryBitsHex) {
  const real = canonicalComponent(parseBits(realBitsHex));
  const imaginary = canonicalComponent(parseBits(imaginaryBitsHex));
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(real, 0);
  out.writeBigUInt64LE(imaginary, 8);
  return out;
}

export function decodeComplex128Wire(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length !== 16)
    throw new RangeError("complex128 wire value must be exactly 16 bytes");
  const real = bytes.readBigUInt64LE(0);
  const imaginary = bytes.readBigUInt64LE(8);
  for (const [name, bits] of [["real", real], ["imaginary", imaginary]]) {
    if (isNaNBits(bits) && bits !== CANONICAL_QNAN)
      throw new RangeError("noncanonical complex128 NaN encoding in " + name);
  }
  return {
    realBits: hex16(real),
    imaginaryBits: hex16(imaginary)
  };
}

export function isCanonicalComplex128Wire(bytes) {
  try { decodeComplex128Wire(bytes); return true; }
  catch { return false; }
}
