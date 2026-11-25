import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validator", ROOT / "bin" / "verify_actor_tenant_receipt.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
MANIFEST = json.loads((ROOT / "contracts" / "actor-tenant-conformance-v1.json").read_text())


class ReceiptTests(unittest.TestCase):
    def receipt(self, case_id="same-tenant-take-invalidates-alias"):
        compile_denial = case_id in {"same-tenant-take-invalidates-alias", "borrow-blocks-move"}
        sandbox_denial = case_id == "untrusted-tenant-missing-sandbox"
        denial = compile_denial or sandbox_denial
        return {
            "backend": "llvm",
            "case_id": case_id,
            "status": "passed",
            "guest_executed": not denial,
            "evidence_kind": ("compiler-rejection" if compile_denial else
                              "sandbox-admission-rejection" if sandbox_denial else
                              "compiled-guest"),
            "head_sha": "a" * 40,
            "checked_out_sha": "a" * 40,
            "head_tree_sha": "c" * 40,
            "artifact_sha256": "b" * 64,
            "workflow_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
            "run_id": 123,
            "run_attempt": 1,
            "job_id": 456,
            "command": "./compile fixture.atto",
            "steps": [{"name": "Execute isolated guest test",
                       "status": "completed", "conclusion": "success",
                       "command": "./compile fixture.atto"}],
            "observed": next(c["expect"] for c in MANIFEST["cases"] if c["id"] == case_id),
            "exit_code": 1 if denial else 0,
        }

    def invalid(self, receipt):
        with self.assertRaises(module.ReceiptError):
            module.validate_receipt(receipt, MANIFEST)

    def test_manifest_baseline_unexecuted(self):
        self.assertEqual(len(module.validate_manifest(MANIFEST)), 12)

    def test_valid_structural_compiler_receipt_is_not_provenance(self):
        module.validate_receipt(self.receipt(), MANIFEST)

    def test_host_reference_fraud(self):
        r = self.receipt()
        r["evidence_kind"] = "host-reference"
        self.invalid(r)

    def test_fake_guest_flag(self):
        r = self.receipt()
        r["guest_executed"] = True
        self.invalid(r)

    def test_missing_exact_head_and_artifact(self):
        for key in ("head_sha", "artifact_sha256"):
            r = self.receipt()
            r[key] = "pending"
            self.invalid(r)

    def test_compile_rejection_requires_nonzero_exit(self):
        r = self.receipt()
        r["exit_code"] = 0
        self.invalid(r)

    def test_security_case_requires_real_boundary(self):
        r = self.receipt("cross-tenant-raw-handle-rejected")
        self.invalid(r)
        r["boundary"] = "shared-arena"
        r["enforcement_tested"] = True
        self.invalid(r)
        r["boundary"] = "validated-wasm-isolate"
        module.validate_receipt(r, MANIFEST)

    def test_unsupported_must_have_reason(self):
        r = {"backend": "forge", "case_id": MANIFEST["cases"][0]["id"],
             "status": "unsupported"}
        self.invalid(r)
        r["reason"] = "No untrusted sandbox path"
        module.validate_receipt(r, MANIFEST)

    def test_unexecuted_is_not_passed(self):
        r = {"backend": "wasm", "case_id": MANIFEST["cases"][0]["id"],
             "status": "not_executed", "reason": "CI unavailable"}
        module.validate_receipt(r, MANIFEST)
        r["status"] = "passed"
        self.invalid(r)

    def test_nonzero_runtime_failure_is_not_success(self):
        r = self.receipt("frozen-graph-read")
        r["exit_code"] = 1
        self.invalid(r)

    def test_unknown_case_rejected(self):
        r = self.receipt()
        r["case_id"] = "nonexistent"
        self.invalid(r)

    def test_zero_step_or_missing_step_evidence_rejected(self):
        for value in ([], None, [{}]):
            r = self.receipt()
            r["steps"] = value
            self.invalid(r)

    def test_compiler_rejection_is_not_guest_execution(self):
        r = self.receipt()
        module.validate_receipt(r, MANIFEST)
        r["guest_executed"] = True
        self.invalid(r)
        r["guest_executed"] = False
        r["evidence_kind"] = "compiled-guest"
        self.invalid(r)

    def test_runtime_pass_requires_executed_guest(self):
        r = self.receipt("frozen-graph-read")
        module.validate_receipt(r, MANIFEST)
        r["guest_executed"] = False
        self.invalid(r)

    def test_checkout_head_and_run_identity_required(self):
        for key, value in (("checked_out_sha", "d" * 40),
                           ("head_tree_sha", "pending"),
                           ("run_id", 0), ("run_attempt", False),
                           ("job_id", -1),
                           ("workflow_url", "https://github.com/a/b/actions/runs/999")):
            r = self.receipt()
            r[key] = value
            self.invalid(r)

    def test_matching_actual_test_step_is_required(self):
        r = self.receipt()
        r["steps"][0]["command"] = "echo success"
        self.invalid(r)
        r = self.receipt()
        r["steps"].append(r["steps"][0].copy())
        self.invalid(r)
        r = self.receipt()
        r["steps"][0]["status"] = "queued"
        self.invalid(r)

    def test_deny_before_execution_is_not_sandbox_success(self):
        r = self.receipt("untrusted-tenant-missing-sandbox")
        self.invalid(r)
        r["boundary"] = "none"
        r["enforcement_tested"] = False
        module.validate_receipt(r, MANIFEST)
        for key, value in (("guest_executed", True),
                           ("boundary", "validated-wasm-isolate"),
                           ("enforcement_tested", True),
                           ("exit_code", 0)):
            forged = copy.deepcopy(r)
            forged[key] = value
            self.invalid(forged)

    def test_invalid_baseline_claim(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["backends"]["java"]["status"] = "PASSED"
        with self.assertRaises(module.ReceiptError):
            module.validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
