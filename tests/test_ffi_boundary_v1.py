"""Executed HOST-ONLY reference/anti-fraud tests; never guest or backend parity."""
import copy
import importlib.util
import json
import math
import struct
import unittest
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ffi_verifier", ROOT / "bin" / "verify_ffi_boundary_v1.py")
ffi = importlib.util.module_from_spec(SPEC)
import sys
sys.modules[SPEC.name] = ffi
SPEC.loader.exec_module(ffi)
MANIFEST = json.loads((ROOT / "contracts" / "ffi-boundary-v1.json").read_text())


class CanonicalScalarTests(unittest.TestCase):
    def invalid(self, fn, *args):
        with self.assertRaises(ffi.BoundaryError):
            fn(*args)

    def test_signed_i64_boundaries(self):
        for number in [0, 1, -1, -(1 << 63), (1 << 63) - 1, 0x123456789]:
            self.assertEqual(ffi.decode_int(ffi.encode_int(number)), number)
        self.assertEqual(ffi.encode_int(0x123456789), bytes.fromhex("8967452301000000"))

    def test_i64_rejects_host_pointer_truncation(self):
        for number in [1 << 63, -(1 << 63) - 1, True, 1.0, "42"]:
            self.invalid(ffi.encode_int, number)
        for data in [b"\x00" * 4, b"\x00" * 9, bytearray(8)]:
            self.invalid(ffi.decode_int, data)

    def test_bool_exact_encoding(self):
        self.assertEqual(ffi.encode_bool(True), b"\x01")
        self.assertEqual(ffi.encode_bool(False), b"\x00")
        self.assertFalse(ffi.decode_bool(b"\x00"))
        self.assertTrue(ffi.decode_bool(b"\x01"))

    def test_bool_rejects_truthy_and_noncanonical(self):
        for value in [0, 1, 2, None, "yes"]:
            self.invalid(ffi.encode_bool, value)
        for data in [b"\x02", b"\xff", b"", b"\x00\x00", 1]:
            self.invalid(ffi.decode_bool, data)

    def test_f64_negzero_and_canonical_nan(self):
        self.assertEqual(ffi.encode_float(-0.0), bytes.fromhex("0000000000000080"))
        self.assertTrue(math.copysign(1, ffi.decode_float(ffi.encode_float(-0.0))) < 0)
        self.assertEqual(ffi.encode_float(float("nan")), bytes.fromhex("000000000000f87f"))
        self.assertTrue(math.isnan(ffi.decode_float(ffi.encode_float(float("nan")))))
        self.assertEqual(ffi.decode_float(ffi.encode_float(float("inf"))), float("inf"))
        self.invalid(ffi.decode_float, bytes.fromhex("010000000000f87f"))
        self.invalid(ffi.encode_float, 1)
        self.invalid(ffi.decode_float, b"\x00" * 4)


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.broker = ffi.Broker("wasm-worker:A", quota=2)
        self.broker.register_actor("A", 17)
        self.handle = self.broker.issue("A", "Foo", frozenset({"read", "call"}))

    def denied(self, fn, *args):
        with self.assertRaises(ffi.BoundaryError):
            fn(*args)

    def test_admit_and_finish_one_lease(self):
        lease = self.broker.enter("A", self.handle, "Foo", "call")
        self.assertTrue(self.broker.complete(lease))
        self.assertFalse(self.broker.complete(lease))

    def test_two_concurrent_calls_independent_completion(self):
        first = self.broker.enter("A", self.handle, "Foo", "read")
        second = self.broker.enter("A", self.handle, "Foo", "read")
        self.broker.retire("A")
        self.assertFalse(self.broker.reclaimed(self.handle))
        self.assertTrue(self.broker.complete(first))
        self.assertFalse(self.broker.complete(first))
        self.assertFalse(self.broker.reclaimed(self.handle))
        self.assertTrue(self.broker.complete(second))
        self.assertTrue(self.broker.reclaimed(self.handle))

    def test_cross_domain_and_owner_denied(self):
        self.broker.register_actor("B", 18)
        self.denied(self.broker.enter, "B", self.handle, "Foo", "read")
        self.denied(self.broker.enter, "A", replace(self.handle, domain="other"), "Foo", "read")

    def test_type_mismatch_and_forged_rights_denied(self):
        self.denied(self.broker.enter, "A", self.handle, "Bar", "read")
        self.denied(self.broker.enter, "A", replace(self.handle, type_id="Bar"), "Bar", "read")
        self.denied(self.broker.enter, "A", replace(self.handle, rights=frozenset({"read", "write"})), "Foo", "write")
        self.denied(self.broker.enter, "A", self.handle, "Foo", "write")

    def test_stale_slot_and_actor_generation_denied(self):
        self.denied(self.broker.enter, "A", replace(self.handle, generation=0), "Foo", "read")
        self.denied(self.broker.enter, "A", replace(self.handle, actor_generation=18), "Foo", "read")
        self.denied(self.broker.enter, "A", replace(self.handle, slot=100), "Foo", "read")

    def test_retirement_fences_all_new_calls_and_defers_reclaim(self):
        lease = self.broker.enter("A", self.handle, "Foo", "call")
        self.broker.retire("A")
        self.denied(self.broker.enter, "A", self.handle, "Foo", "call")
        self.denied(self.broker.issue, "A", "Foo", frozenset({"call"}))
        self.assertFalse(self.broker.reclaimed(self.handle))
        self.assertTrue(self.broker.complete(lease))
        self.assertTrue(self.broker.reclaimed(self.handle))

    def test_foreign_completion_cannot_pretend_to_be_second_lease(self):
        lease = self.broker.enter("A", self.handle, "Foo", "call")
        self.denied(self.broker.complete, ffi.Lease(lease.nonce + 1, self.handle))
        self.denied(self.broker.complete, ffi.Lease(lease.nonce, self.handle))
        self.denied(self.broker.complete, replace(lease, handle=replace(self.handle, type_id="Bar")))
        self.assertTrue(self.broker.complete(lease))

    def test_quota_no_partial_admission(self):
        second = self.broker.issue("A", "Bar", frozenset({"call"}))
        self.denied(self.broker.issue, "A", "Baz", frozenset({"call"}))
        self.assertIsNotNone(self.broker.enter("A", second, "Bar", "call"))

    def test_invalid_rights_and_quota(self):
        self.denied(self.broker.issue, "A", "Foo", frozenset({"admin"}))
        self.denied(self.broker.issue, "A", "Foo", frozenset())
        self.denied(ffi.Broker, "x", 0)

    def test_no_slot_or_lease_id_wrap(self):
        self.broker._next_slot = ffi.Broker.MAX_GENERATION + 1
        self.denied(self.broker.issue, "A", "Foo", frozenset({"read"}))
        self.broker._next_lease = ffi.Broker.MAX_GENERATION + 1
        self.denied(self.broker.enter, "A", self.handle, "Foo", "read")


class ReceiptTests(unittest.TestCase):
    def receipt(self, case_id="handle-cross-domain"):
        case = next(c for c in MANIFEST["cases"] if c["id"] == case_id)
        return {"backend": "llvm", "case_id": case_id, "status": "passed",
                "source_head_sha": "a" * 40, "source_tree_sha": "b" * 40,
                "artifact_sha256": "c" * 64, "workflow_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
                "run_id": 123, "job_id": 456, "executed_steps": 12,
                "command": "./attoc fixture.atto && ./fixture", "target": "x86_64-linux-gnu",
                "bridge_version": 1, "abi_fingerprint": "d" * 64,
                "observed": case["expect"], "exit_code": 0,
                "evidence_kind": "compiled-guest", "guest_executed": True,
                "isolation_boundary": "native-process", "enforcement_tested": True}

    def invalid(self, receipt, manifest=MANIFEST):
        with self.assertRaises(ffi.BoundaryError):
            ffi.validate_receipt(receipt, manifest)

    def test_manifest_unexecuted(self):
        self.assertEqual(len(ffi.validate_manifest(MANIFEST)), 29)

    def test_structural_receipt_only_not_attestation(self):
        ffi.validate_receipt(self.receipt(), MANIFEST)

    def test_compile_negative_requires_no_artifact_and_proof(self):
        r = self.receipt("foreign-pointer-parameter")
        self.invalid(r)
        r.update({"evidence_kind": "source-compiler", "guest_executed": False,
                  "artifact_sha256": None, "exit_code": 2, "no_artifact_proven": True})
        ffi.validate_receipt(r, MANIFEST)
        r["no_artifact_proven"] = False
        self.invalid(r)

    def test_host_only_and_zero_step_pass_rejected(self):
        r = self.receipt()
        for key, value in (("evidence_kind", "host-only"), ("guest_executed", False),
                           ("executed_steps", 0), ("job_id", None), ("run_id", 0)):
            x = copy.deepcopy(r)
            x[key] = value
            self.invalid(x)

    def test_wrong_hashes_and_unpinned_version(self):
        r = self.receipt()
        for key, value in (("source_head_sha", "pending"), ("source_tree_sha", "short"),
                           ("artifact_sha256", "fake"), ("abi_fingerprint", "NOT_SET"),
                           ("bridge_version", 2), ("target", "")):
            x = copy.deepcopy(r)
            x[key] = value
            self.invalid(x)

    def test_negative_security_case_must_name_real_boundary(self):
        r = self.receipt()
        r["isolation_boundary"] = "shared-heap"
        self.invalid(r)
        r["isolation_boundary"] = "native-process"
        r["enforcement_tested"] = False
        self.invalid(r)

    def test_unsupported_and_unexecuted_require_reasons(self):
        r = {"backend": "java", "case_id": "foreign-pointer-parameter",
             "status": "unsupported"}
        self.invalid(r)
        r["reason"] = "backend has no supported FFI feature"
        ffi.validate_receipt(r, MANIFEST)
        r["status"] = "not_executed"
        ffi.validate_receipt(r, MANIFEST)
        r["guest_executed"] = True
        self.invalid(r)

    def test_failed_is_not_passed(self):
        r = {"backend": "net", "case_id": "callback-after-retire", "status": "failed"}
        self.invalid(r)
        r["reason"] = "native AOT timeout"
        ffi.validate_receipt(r, MANIFEST)

    def test_bad_case_or_result_rejected(self):
        r = self.receipt()
        for key, val in (("case_id", "nonexistent"), ("backend", "unknown"),
                         ("status", "PASSED"), ("observed", "ignored"), ("exit_code", 1)):
            x = copy.deepcopy(r)
            x[key] = val
            self.invalid(x)

    def test_manifest_duplicate_and_false_backend_status_rejected(self):
        m = copy.deepcopy(MANIFEST)
        m["cases"].append(copy.deepcopy(m["cases"][0]))
        with self.assertRaises(ffi.BoundaryError):
            ffi.validate_manifest(m)
        m = copy.deepcopy(MANIFEST)
        m["backends"]["llvm"]["status"] = "PASSED"
        with self.assertRaises(ffi.BoundaryError):
            ffi.validate_manifest(m)

    def test_manifest_layout_tamper_rejected(self):
        m = copy.deepcopy(MANIFEST)
        m["canonicalInterchange"]["boolBytes"] = 4
        with self.assertRaises(ffi.BoundaryError):
            ffi.validate_manifest(m)


if __name__ == "__main__":
    unittest.main()
