"""Synthetic structural receipt tests; no real guest execution is asserted."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
p = importlib.util.spec_from_file_location("pool_gate", ROOT / "bin/verify_fixed_buffer_pool_receipt.py")
gate = importlib.util.module_from_spec(p)
p.loader.exec_module(gate)
C = json.loads((ROOT / "contracts/fixed-buffer-pool-guest-receipt-v1.json").read_text())

def synthetic():
    return {
        "backend":"llvm", "status":"passed", "evidence_kind":"compiled-atto-guest",
        "guest_executed":True, "executed_job_steps":5,
        "source_head_sha":"a"*40, "compiler_head_sha":"b"*40,
        "fixture_git_blob_sha":"c"*40, "artifact_sha256":"d"*64,
        "fixture_sha256":"e"*64,
        "workflow_url":"https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
        "command":"atto-llvmc ./fixture.atto && ./fixture",
        "allocator_probe_available":True, "copy_probe_available":True,
        "measured_transfers":100000, "dynamic_allocations_during_window":0,
        "payload_copy_bytes_during_transfers":0,
        "same_backing_region_after_move":True, "guest_exit_code":0,
        "negative_cases":{k:True for k in C["required_negative_cases"]},
        "zero_allocation_proved":True, "zero_copy_proved":True
    }

class StructuralPoolReceiptTest(unittest.TestCase):
    def rejected(self, change):
        r = synthetic()
        change(r)
        with self.assertRaises(gate.ReceiptError):
            gate.validate_receipt(r, C)

    def test_shape_only_not_provenance(self):
        self.assertEqual(gate.validate_receipt(synthetic(), C), "passed")

    def test_zero_step_rejected(self):
        self.rejected(lambda r: r.update(executed_job_steps=0))

    def test_host_only_rejected(self):
        self.rejected(lambda r: r.update(evidence_kind="native-host"))

    def test_missing_instrumentation_rejected(self):
        self.rejected(lambda r: r.update(allocator_probe_available=False))

    def test_nonzero_allocations_rejected(self):
        self.rejected(lambda r: r.update(dynamic_allocations_during_window=1))

    def test_copied_payload_rejected(self):
        self.rejected(lambda r: r.update(payload_copy_bytes_during_transfers=64))

    def test_insufficient_transfers_rejected(self):
        self.rejected(lambda r: r.update(measured_transfers=99999))

    def test_missing_negative_case_rejected(self):
        self.rejected(lambda r: r["negative_cases"].update(double_release_denied=False))

    def test_invalid_sha_rejected(self):
        self.rejected(lambda r: r.update(compiler_head_sha="pending"))

    def test_mismatched_buffer_rejected(self):
        self.rejected(lambda r: r.update(same_backing_region_after_move=False))

    def test_unexecuted_w_reason_is_not_pass(self):
        self.assertEqual(gate.validate_receipt(
            {"backend":"net", "status":"not_executed", "reason":"No native guest test"}, C),
            "not_executed")

    def test_unexecuted_cannot_claim_proof(self):
        with self.assertRaises(gate.ReceiptError):
            gate.validate_receipt({
                "backend":"net", "status":"not_executed",
                "reason":"No native guest test",
                "zero_allocation_proved":True
            }, C)

if __name__ == "__main__":
    unittest.main()
