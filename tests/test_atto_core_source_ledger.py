"""Adversarial source-only ledger tests: never produce native guest receipts."""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ledger", HERE / "verify_atto_core_source_ledger.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name) / "ledger.json"
        self.base = v.check(HERE.parent / v.REL)
        self.write(self.base)

    def write(self, obj):
        self.p.write_text(json.dumps(obj, sort_keys=True), encoding="utf-8")

    def denied(self):
        with self.assertRaises(v.Rejected): v.check(self.p)

    def test_baseline(self):
        self.assertEqual(v.check(self.p)["backends"]["llvm"], "NOT_EXECUTED")

    def test_fake_java_execution_denied(self):
        self.base["backends"]["java"] = "EXECUTED"
        self.write(self.base)
        self.denied()

    def test_false_backend_status_denied(self):
        self.base["backends"]["wasm"] = False
        self.write(self.base)
        self.denied()

    def test_missing_backend_denied(self):
        del self.base["backends"]["forge"]
        self.write(self.base)
        self.denied()

    def test_extra_backend_denied(self):
        self.base["backends"]["remote-executor"] = "NOT_EXECUTED"
        self.write(self.base)
        self.denied()

    def test_modified_canonical_source_denied(self):
        self.base["modules"]["ores.core/numeric"] = "0" * 40
        self.write(self.base)
        self.denied()

    def test_unknown_source_module_denied(self):
        self.base["modules"]["ores.std/unsafe"] = "0" * 40
        self.write(self.base)
        self.denied()

    def test_wrong_organization_denied(self):
        self.base["source_organization"] = "another-org"
        self.write(self.base)
        self.denied()

    def test_forged_guest_claim_denied(self):
        self.base["claim_tier"] = "GUEST_EXECUTED"
        self.write(self.base)
        self.denied()

    def test_duplicate_json_keys_denied(self):
        self.p.write_text('{"schema":"x","schema":"x"}', encoding="utf-8")
        self.denied()

    def test_oversized_ledger_denied(self):
        self.p.write_bytes(b" " * (v.MAX_JSON + 1))
        self.denied()

    def test_invalid_utf8_denied(self):
        self.p.write_bytes(b"\xff")
        self.denied()

    def test_nan_denied(self):
        self.p.write_text('{"value":NaN}', encoding="utf-8")
        self.denied()

    def test_symlink_denied(self):
        target = self.p.parent / "backup.json"
        self.p.rename(target)
        self.p.symlink_to(target)
        self.denied()

if __name__ == "__main__":
    unittest.main(verbosity=2)
