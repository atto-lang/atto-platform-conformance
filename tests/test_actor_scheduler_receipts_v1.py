"""Structural receipt rejection tests; fake values do NOT prove GitHub provenance."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("receipt_gate",
        ROOT / "bin/verify_actor_scheduler_receipt.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SchedulerReceiptTests(unittest.TestCase):
    def base(self, case="startup-two-or-three"):
        return {
            "backend": "llvm", "case_id": case, "status": "passed",
            "exact_head_sha": "a" * 40, "source_tree_sha": "b" * 40,
            "toolchain": "clang-21", "executed_steps_nonzero": 7,
            "guest_executed": True, "observed": "two carriers and caller",
            "workflow_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
            "thread_count_evidence": {"atto_startup_including_caller": 3,
                                      "process_startup_total": 3},
        }

    def invalid(self, r):
        with self.assertRaises(gate.ReceiptError):
            gate.validate_receipt(r)

    def test_all_backends_not_executed(self):
        self.assertEqual(len(gate.validate_manifest()), 14)

    def test_structural_receipt_not_proof(self):
        self.assertTrue(gate.validate_receipt(self.base()))

    def test_forged_or_unexecuted_fields(self):
        for field, value in (("exact_head_sha", "pending"),
                             ("source_tree_sha", ""),
                             ("toolchain", ""),
                             ("executed_steps_nonzero", 0),
                             ("executed_steps_nonzero", True),
                             ("guest_executed", False),
                             ("observed", ""),
                             ("workflow_url", "https://fake.test/receipt")):
            with self.subTest(field=field, value=value):
                r = self.base()
                r[field] = value
                self.invalid(r)

    def test_managed_host_extra_threads_allowed(self):
        r = self.base()
        r["backend"] = "net"
        r["thread_count_evidence"]["process_startup_total"] = 21
        gate.validate_receipt(r)

    def test_incorrect_thread_counts_rejected(self):
        for field, value in (("atto_startup_including_caller", 4),
                             ("atto_startup_including_caller", True),
                             ("process_startup_total", 0)):
            r = self.base()
            r["thread_count_evidence"][field] = value
            self.invalid(r)

    def test_untrusted_boundary_cannot_be_logical_pool(self):
        r = self.base("real-security-boundary")
        self.invalid(r)
        r["boundary_evidence"] = {"kind": "shared_arena",
                                   "enforcement_tested": True}
        self.invalid(r)
        r["boundary_evidence"] = {"kind": "sandboxed_process",
                                   "enforcement_tested": True}
        gate.validate_receipt(r)

    def test_unsupported_not_a_pass(self):
        r = {"backend": "java", "case_id": "tenant-per-account-pool",
             "status": "unsupported", "reason": "Native sandbox not available"}
        gate.validate_receipt(r)
        r["status"] = "passed"
        self.invalid(r)

    def test_unknown_backend_or_case_rejected(self):
        for field in ("backend", "case_id"):
            r = self.base()
            r[field] = "missing"
            self.invalid(r)


if __name__ == "__main__":
    unittest.main()
