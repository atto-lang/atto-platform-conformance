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
        return {
            "backend": "llvm",
            "case_id": case_id,
            "status": "passed",
            "guest_executed": True,
            "evidence_kind": "compiled-guest",
            "head_sha": "a" * 40,
            "artifact_sha256": "b" * 64,
            "workflow_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
            "command": "./compile fixture.atto",
            "observed": next(c["expect"] for c in MANIFEST["cases"] if c["id"] == case_id),
            "exit_code": 1 if case_id == "same-tenant-take-invalidates-alias" else 0,
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
        r["guest_executed"] = False
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

    def test_invalid_baseline_claim(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["backends"]["java"]["status"] = "PASSED"
        with self.assertRaises(module.ReceiptError):
            module.validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
