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
        exhaustive = contract["exhaustive_guest_fixture"]
        self.assertEqual(exhaustive["policy_cases"], 48)
        self.assertEqual(exhaustive["expected_exit_code"], 42)
        guest = (ROOT / exhaustive["path"]).read_bytes()
        self.assertEqual(git_blob_sha(guest), exhaustive["git_blob_sha"])
        self.assertIn(b"pub fnc main(): int {", guest)
        main_body = guest.rsplit(b"pub fnc main(): int {", 1)[1]
        self.assertEqual(sum(line.startswith(b"  if ") for line in main_body.splitlines()), 48)
        for row in contract["backend_results"]:
            if row["backend"] == "rs":
                self.assertTrue(row["guest_compiled"])
                self.assertTrue(row["guest_executed"])
                evidence = row["evidence"]
                self.assertEqual(evidence["status"], "PASS_POLICY_GUEST_ONLY")
                self.assertEqual(evidence["fixture_blob_sha"], exhaustive["git_blob_sha"])
                self.assertEqual(evidence["exhaustive_cases"], 48)
                self.assertEqual(evidence["expected_exit_code"], 42)
                self.assertFalse(evidence["actual_http3_wire_proven"])
                self.assertIn("/actions/runs/43644258623", evidence["run_url"])
            else:
                self.assertFalse(row["guest_executed"])
                self.assertFalse(row["guest_compiled"])
                self.assertNotIn("evidence", row)
            self.assertEqual(row["network_protocol_execution"], "NOT_EXECUTED")

if __name__ == "__main__":
    unittest.main()
