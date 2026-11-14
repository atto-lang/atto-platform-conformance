"""Source-only check; the guest is NOT executed by this test."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def git_blob_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()

class HttpPolicyFixtureTest(unittest.TestCase):
    def test_exact_atto_fixture(self):
        contract = json.loads((ROOT / "contracts/net-http-policy-v1.json").read_text())
        self.assertEqual(contract["status"], "FIXTURE_STAGED_NOT_EXECUTED")
        fixture = contract["guest_fixture"]
        self.assertEqual(fixture["expected_exit_code"], 42)
        self.assertTrue(fixture["path"].endswith(".atto"))
        src = (ROOT / fixture["path"]).read_bytes()
        self.assertEqual(git_blob_sha(src), fixture["git_blob_sha"])
        self.assertTrue(src.startswith(b"// expect-exit: 42\n"))
        self.assertEqual({row["backend"] for row in contract["backend_results"]},
                         {"llvm", "java", "net", "rs", "wasm"})
        self.assertTrue(all(not row["guest_executed"] for row in contract["backend_results"]))
        self.assertTrue(all(not row["guest_compiled"] for row in contract["backend_results"]))

if __name__ == "__main__":
    unittest.main()
