"""Adversarial tests for persistent-actor source-free artifact receipts."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "scripts/verify_persistent_actor_receipt.py"
SPEC = importlib.util.spec_from_file_location("persistent_receipt", MODULE)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

HEAD = "a" * 40
TREE = "b" * 40
BACKENDS = {
    "java": "1" * 40,
    "llvm": "2" * 40,
    "net": "3" * 40,
    "wasm": "4" * 40,
    "forge": "5" * 40,
}
BLOBS = {
    "contracts/v1/persistent_actor_data_v1.json": "6" * 40,
    "scripts/verify_persistent_actor_data_contract.py": "7" * 40,
    "scripts/test_persistent_actor_data_contract.py": "8" * 40,
}


def fixture():
    return {
        "backend_heads": dict(BACKENDS),
        "carrier_commit": HEAD,
        "carrier_tree": TREE,
        "classification": "SOURCE_FREE_CONTRACT_ONLY_NOT_GUEST_RUNTIME",
        "guest_runtime_certified": False,
        "matched_backends": 5,
        "native_backend_certified": False,
        "private_source_export_authorized": False,
        "repository": "scintilla-run-test/gleam-runner-conformance",
        "run_attempt": 1,
        "run_id": 27,
        "schema": "oreslang.source_free_persistent_actor_policy_47.v1",
        "source_free_blobs": dict(BLOBS),
        "source_runtime_or_compiler_transferred": False,
        "test_results": {"round_counts": [47, 47, 47], "executed_total": 141},
    }


class PersistentReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "receipt.zip"
        self.report = fixture()

    def run_report(self, *, member=m.MEMBER, extra=False, digest=None,
                   backend_heads=None, blobs=None, payload=None):
        raw = (json.dumps(self.report, sort_keys=True).encode()
               if payload is None else payload)
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(member, raw)
            if extra:
                archive.writestr("extra.json", b"{}")
        data = self.path.read_bytes()
        return m.verify_persistent_actor_zip(
            self.path,
            expected_zip_sha256=digest or hashlib.sha256(data).hexdigest(),
            expected_head_sha=HEAD,
            expected_tree_sha=TREE,
            expected_run_id=27,
            expected_attempt=1,
            expected_backend_heads=backend_heads or BACKENDS,
            expected_blobs=blobs or BLOBS,
        )

    def denied(self, **kwargs):
        with self.assertRaises(m.ReceiptDenied):
            self.run_report(**kwargs)

    def test_valid_receipt_stays_non_native(self):
        out = self.run_report()
        self.assertEqual(out["tests_reported"], 141)
        self.assertEqual(out["backend_heads_verified"], 5)
        self.assertIs(out["native_compiler_executed"], False)
        self.assertIs(out["guest_runtime_certified"], False)
        self.assertIs(out["release_certified"], False)

    def test_old_44_inventory_rejected(self):
        self.report["test_results"] = {
            "round_counts": [44, 44, 44], "executed_total": 132}
        self.denied()

    def test_partial_round_rejected(self):
        self.report["test_results"] = {
            "round_counts": [47, 47, 46], "executed_total": 140}
        self.denied()

    def test_fake_native_claim_rejected(self):
        self.report["native_backend_certified"] = True
        self.denied()

    def test_fake_guest_claim_rejected(self):
        self.report["guest_runtime_certified"] = True
        self.denied()

    def test_fake_export_authority_rejected(self):
        self.report["private_source_export_authorized"] = True
        self.denied()

    def test_source_transfer_rejected(self):
        self.report["source_runtime_or_compiler_transferred"] = True
        self.denied()

    def test_wrong_backend_head_rejected(self):
        self.report["backend_heads"]["wasm"] = "f" * 40
        self.denied()

    def test_missing_backend_pin_rejected(self):
        pins = dict(BACKENDS)
        pins.pop("forge")
        self.denied(backend_heads=pins)

    def test_wrong_blob_rejected(self):
        self.report["source_free_blobs"][m.BLOB_PATHS[2]] = "f" * 40
        self.denied()

    def test_wrong_independent_blob_set_rejected(self):
        pins = dict(BLOBS)
        pins["evil"] = "f" * 40
        self.denied(blobs=pins)

    def test_digest_mismatch_rejected(self):
        self.denied(digest="f" * 64)

    def test_extra_archive_member_rejected(self):
        self.denied(extra=True)

    def test_wrong_member_rejected(self):
        self.denied(member="other.json")

    def test_duplicate_json_field_rejected(self):
        raw = json.dumps(self.report).encode()
        raw = raw[:-1] + b', "run_id":27}'
        self.denied(payload=raw)

    def test_unexpected_report_field_rejected(self):
        self.report["native_passed"] = True
        self.denied()

    def test_float_run_id_rejected(self):
        self.report["run_id"] = 27.0
        self.denied()

    def test_wrong_schema_rejected(self):
        self.report["schema"] = "oreslang.source_free_persistent_actor_policy_44.v1"
        self.denied()


if __name__ == "__main__":
    unittest.main(verbosity=2)
