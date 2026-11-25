"""Fail-closed source-byte and status-gate tests for ADT discard contract v1."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "adt-payload-discard-v1.json"

def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\x00" + content).hexdigest()

class AdtDiscardContractTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_blob_pins_are_exact_and_unique(self):
        doc = self.doc
        self.assertEqual(doc["schema"], "atto-adt-payload-discard-v1")
        self.assertEqual(doc["status"], "DRAFT")
        self.assertRegex(doc["source_head"], r"^[a-f0-9]{40}$")
        self.assertEqual(len(doc["cases"]), 6)
        self.assertEqual(len(set(x["id"] for x in doc["cases"])), 6)
        for case in doc["cases"]:
            with self.subTest(case=case["id"]):
                path = ROOT / case["fixture"]
                self.assertTrue(path.is_file())
                self.assertEqual(git_blob_sha(path.read_bytes()), case["git_blob_sha1"])
                self.assertIn(case["expect"]["kind"], {"guest_main_i64","compiler_diagnostic_no_artifact"})
                if case["expect"]["kind"] == "guest_main_i64":
                    self.assertEqual(case["expect"]["value"], 42)
                else:
                    self.assertIn(case["expect"]["code"], {"E_MATCH","E_UNBOUND"})

    def test_backend_status_is_strict_and_explicit(self):
        b = self.doc["backends"]
        self.assertEqual(set(b), {"rust-wasm", "java", "llvm", "net", "forge"})
        for name, entry in b.items():
            with self.subTest(backend=name):
                self.assertIn(entry["status"], {"PASS", "FAIL", "UNSUPPORTED", "NOT_EXECUTED"})
                if name == "rust-wasm":
                    self.assertEqual(entry["status"], "PASS")
                    receipt = entry["receipt"]
                    self.assertEqual(receipt["source_head"], self.doc["source_head"])
                    self.assertEqual(receipt["verified_scoped_git_blobs"], 58)
                    self.assertEqual(receipt["executed_positive_guest_count"], 3)
                    self.assertEqual(receipt["executed_negative_guest_count"], 3)
                    self.assertIsInstance(receipt["run_id"], int)
                else:
                    self.assertEqual(entry["status"], "NOT_EXECUTED")
                    self.assertTrue(entry["reason"])

if __name__ == "__main__":
    unittest.main()
