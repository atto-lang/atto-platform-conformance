"""Host-only integrity checks, never guest execution."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
class FreshReturnRegistryTest(unittest.TestCase):
    def test_registry_and_fixture_headers(self):
        m = json.loads((ROOT / "contracts/fresh-return-types-v1.json").read_text())
        self.assertEqual(m["schema"], "atto-fresh-return-v1")
        self.assertEqual(m["status"], "CANDIDATE_NOT_IMPLEMENTED")
        self.assertEqual(set(m["backends"]), {"java", "llvm", "net"})
        self.assertTrue(all(v == "NOT_EXECUTED" for v in m["backends"].values()))
        self.assertEqual(len(m["fixtures"]), 12)
        paths = [case["path"] for case in m["fixtures"]]
        self.assertEqual(len(paths), len(set(paths)))
        for case in m["fixtures"]:
            p = (ROOT / case["path"]).resolve()
            self.assertTrue(p.is_relative_to(ROOT.resolve()))
            self.assertTrue(p.is_file(), str(p))
            contents = p.read_text()
            if case["expect"] == "PASS":
                self.assertIn("// expect-exit: " + str(case["exit_code"]), contents)
            else:
                self.assertIn("// expect-error: " + case["expect"], contents)
if __name__ == "__main__":
    unittest.main()
