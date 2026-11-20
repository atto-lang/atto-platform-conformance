// Host-side specification oracle only. NOT evidence of AttoLang compiler, guest
// runtime, physical board, FPGA, silicon or mobile/desktop target execution.
export const MAX_U64 = (1n << 64n) - 1n;
const in_u64 = x => typeof x === "bigint" && x >= 0n && x <= MAX_U64;

export function replay_classify(window, sequence) {
  if (!window || !in_u64(window.highest) || !in_u64(window.bitmap) ||
      !in_u64(sequence)) return "INVALID_ARGUMENT";
  const {highest, bitmap} = window;
  if (highest === 0n ? bitmap !== 0n :
      (bitmap & 1n) === 0n || (highest < 64n && (bitmap >> highest) !== 0n))
    return "INVALID_ARGUMENT";
  if (sequence === 0n) return "INVALID_SEQUENCE";
  if (sequence > highest || highest === 0n) return "ACCEPT";
  const delta = highest - sequence;
  if (delta >= 64n) return "STALE";
  return (bitmap & (1n << delta)) === 0n ? "ACCEPT" : "DUPLICATE";
}

export function mobile_copy_preflight(request) {
  // Reject absent or malformed host-reference requests without throwing.
  // This models an invalid C call, not a usable guest-pointer validator.
  if (!request || typeof request !== "object" || Array.isArray(request))
    return "INVALID_ARGUMENT";
  const {length, capacity, source_present, scratch_present, overlaps} = request;
  if (!Number.isSafeInteger(length) || length < 0 ||
      !Number.isSafeInteger(capacity) || capacity < 0 ||
      typeof source_present !== "boolean" || typeof scratch_present !== "boolean" ||
      typeof overlaps !== "boolean") return "INVALID_ARGUMENT";
  if (length > 65536) return "MESSAGE_TOO_LARGE";
  if (length === 0) return "OK";
  if (!source_present) return "INVALID_ARGUMENT";
  if (length > capacity) return "BUFFER_TOO_SMALL";
  if (!scratch_present || overlaps) return "INVALID_ARGUMENT";
  return "OK";
}

export function mailbox_peek_length(box) {
  const invalid = {status:"INVALID_ARGUMENT", length:0};
  if (!box || !Number.isInteger(box.head) || !Number.isInteger(box.tail) ||
      !Number.isInteger(box.count) || box.head < 0 || box.head >= 8 ||
      box.tail < 0 || box.tail >= 8 || box.count < 0 || box.count > 8 ||
      box.tail !== (box.head + box.count) % 8 ||
      !Array.isArray(box.slots) || box.slots.length !== 8)
    return invalid;
  if (box.count === 0) return {status:"EMPTY", length:0};
  const length = box.slots[box.head];
  if (!Number.isInteger(length) || length < 0 || length > 64) return invalid;
  return {status:"OK", length};
}
