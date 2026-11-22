// Source-free policy contract oracle. This does NOT invoke any Atto compiler
// or certify a backend guest. Backend receipt admission is separate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(
  new URL("../contracts/core-memory-atomic-policy-v1.json", import.meta.url),
  "utf8"
));
const MIN = -9223372036854775808n;
const MAX = 9223372036854775807n;
const signedI64 = x => x >= MIN && x <= MAX;
const INVALID = -1n;
const validNonnegative = x => x >= 0n && x <= MAX;
const power2 = a => a > 0n && a <= MAX && (a & (a - 1n)) === 0n;
const alignedSize = (size, align) => {
  if (!validNonnegative(size) || !power2(align)) return INVALID;
  const padding = (align - size % align) % align;
  return size <= MAX - padding ? size + padding : INVALID;
};
const fits = (capacity, offset, count) =>
  validNonnegative(capacity) && validNonnegative(offset) &&
  validNonnegative(count) && offset <= capacity &&
  count <= capacity - offset;

function oracle(name, a) {
  switch (name) {
    case "is_power_of_two_alignment": return power2(a[0]);
    case "align_up_checked": return alignedSize(a[0], a[1]);
    case "layout_stride": return alignedSize(a[0], a[1]);
    case "array_bytes_checked": {
      const [count, stride, budget] = a;
      if (![count, stride, budget].every(validNonnegative)) return INVALID;
      if (count === 0n || stride === 0n) return 0n;
      return count <= budget / stride ? count * stride : INVALID;
    }
    case "span_fits": return fits(...a);
    case "checked_span_end":
      return fits(...a) ? a[1] + a[2] : INVALID;
    case "checked_index_offset": {
      const [region, base, count, index, stride, width, align] = a;
      if (![region, base, count, index, stride, width, align]
          .every(validNonnegative)) return INVALID;
      if (count === 0n || index >= count || stride === 0n ||
          width === 0n || !power2(align) || base % align !== 0n ||
          stride % align !== 0n || !fits(region, base, width)) {
        return INVALID;
      }
      const remaining = region - base - width;
      if (index > remaining / stride) return INVALID;
      return base + index * stride;
    }
    case "can_split_span": {
      const [region, start, length, offset] = a;
      return fits(region, start, length) &&
        validNonnegative(offset) && offset <= length;
    }
    case "default_order": return 4n;
    case "valid_load_order": return a[0] === 0n || a[0] === 1n || a[0] === 4n;
    case "valid_store_order": return a[0] === 0n || a[0] === 2n || a[0] === 4n;
    case "valid_rmw_order": return a[0] >= 0n && a[0] <= 4n;
    case "valid_fence_order": return a[0] >= 1n && a[0] <= 4n;
    case "valid_compare_exchange_orders": {
      const [success, failure] = a;
      if (success < 0n || success > 4n ||
          (failure !== 0n && failure !== 1n && failure !== 4n)) return false;
      switch (success) {
        case 0n: case 2n: return failure === 0n;
        case 1n: case 3n: return failure === 0n || failure === 1n;
        case 4n: return true;
        default: return false;
      }
    }
    default: throw Error("unknown core policy function: " + name);
  }
}

test("schema and explicit native evidence boundary", () => {
  assert.equal(data.schema, "atto.core-memory-atomic-policy.v1");
  assert.equal(data.cases.length, 63);
  assert.equal(data.functions.length, 14);
  assert.equal(new Set(data.functions).size, data.functions.length);
  assert.deepEqual(Object.keys(data.backends).sort(),
    ['java', 'llvm', 'net', 'rs', 'wasm', 'forge', 'cranelift', 'js', 'hdl'].sort(),
    'the backend set must not silently change');
  assert.deepEqual(data.memory_order_codes, {
    relaxed: 0, acquire: 1, release: 2, acq_rel: 3, seq_cst: 4
  });
  for (const [name, record] of Object.entries(data.backends)) {
    assert.equal(record.repository, "atto-lang/atto-source." + name);
    assert.equal(record.guest_import_status, "NOT_EXECUTED");
    assert.equal(record.native_aot_status, "NOT_EXECUTED");
    assert.equal(record.exact_head_executable_receipt, null);
    assert.match(record.policy_pr, /^https:\/\/github\.com\/atto-lang\/atto-source\.[a-z]+\/pull\/\d+$/);
    assert.notEqual(record.source_state, "PASS", "source candidate is not guest proof");
  }
});

for (const [index, item] of data.cases.entries()) {
  test("source-free CMA oracle " + item.id + " " + item.fn, () => {
    assert.equal(item.id, "CMA-" + String(index + 1).padStart(3, "0"));
    assert.ok(data.functions.includes(item.fn), "unknown canonical function");
    assert.ok(Array.isArray(item.args) && item.args.every(a => /^-?\d+$/.test(a)));
    assert.ok(item.args.every(v => signedI64(BigInt(v))),
      'oracle must reject out-of-range signed-i64 input: ' + item.id);
    if (typeof item.expected !== 'boolean') {
      assert.ok(signedI64(BigInt(item.expected)),
        'oracle must reject out-of-range signed-i64 result: ' + item.id);
    }
    const result = oracle(item.fn, item.args.map(v => BigInt(v)));
    const expected = typeof item.expected === "boolean"
      ? item.expected : BigInt(item.expected);
    assert.equal(result, expected);
  });
}

test("unbounded BigInt cannot masquerade as an i64 test vector", () => {
  assert.equal(signedI64(MIN), true);
  assert.equal(signedI64(MAX), true);
  assert.equal(signedI64(MIN - 1n), false);
  assert.equal(signedI64(MAX + 1n), false);
});

test("no source-only receipt may be promoted to guest pass", () => {
  for (const record of Object.values(data.backends)) {
    // A status is an audit claim, not a CI success by itself.
    const forged = { ...record, guest_import_status: "PASS" };
    assert.ok(!forged.exact_head_executable_receipt,
      "no backend has submitted exact-head compiled-guest evidence");
    assert.notEqual(
      forged.guest_import_status,
      record.guest_import_status,
      "forged PASS cannot mutate the authoritative manifest"
    );
  }
});
