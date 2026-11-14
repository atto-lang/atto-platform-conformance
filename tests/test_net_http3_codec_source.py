"""Exact-blob native Atto QUIC and HTTP3 test/receipt audit; not a wire test."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/net-http3-codec-v1.json"


def git_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


class Http3CodecSourceAudit(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(MANIFEST.read_text())

    def test_exhaustive_native_atto_fixtures_have_exact_bytes(self):
        self.assertEqual(self.manifest["schema"], "atto.conformance.http3.codec.v1")
        self.assertEqual(len(self.manifest["fixtures"]), 2)
        total = 0
        for record in self.manifest["fixtures"]:
            path = record["path"]
            self.assertTrue(path.startswith("fixtures/net/") and path.endswith(".atto"))
            src = (ROOT / path).read_bytes()
            self.assertEqual(git_sha(src), record["git_blob_sha"])
            self.assertTrue(src.startswith(b"// expect-exit: 42\n"))
            self.assertTrue(src.endswith(b"\n"))
            self.assertNotIn(b"\r", src)
            main = src.rsplit(b"pub fnc main(): int {", 1)[1]
            checks = sum(line.startswith(b"  if ") for line in main.splitlines())
            self.assertEqual(checks, record["cases"])
            self.assertEqual(record["expected_exit_code"], 42)
            total += checks
        self.assertEqual(total, 714)

    def test_evidence_does_not_claim_actual_http3_networking(self):
        r = self.manifest["guest_evidence"]
        self.assertEqual(r["carrier_head"], "20fa8c4e421d5a438c1db337868bd66bbeb7a184")
        self.assertIn("/actions/runs/43645771501", r["carrier_workflow_run"])
        self.assertEqual(r["compiler_source_head"], "860137bcdc50684ab6cb6aa8f89932506b3beec4")
        self.assertEqual(r["host_imports"], 0)
        self.assertTrue(r["deterministic_wasm"])
        self.assertFalse(r["actual_network_io"])
        self.assertFalse(r["native_machine_aot_test"])
        self.assertEqual([x["cases"] for x in r["results"]], [308, 406])
        self.assertEqual([x["actual_exit_code"] for x in r["results"]], [42, 42])
        self.assertEqual(self.manifest["status"], "EXECUTED_RS_GUEST_ONLY_NO_HTTP3_TRANSPORT")
        self.assertEqual({x["backend"] for x in self.manifest["targets"]},
                         {"llvm", "java", "net", "rs", "wasm"})
        for x in self.manifest["targets"]:
            self.assertEqual(x["http3_wire"], "NOT_IMPLEMENTED")
            self.assertEqual(x["client_server_loopback"], "NOT_EXECUTED")
            if x["backend"] == "rs":
                self.assertEqual(x["guest_codec_execution"], "PASS_RUST_TO_WASM")
            else:
                self.assertEqual(x["guest_codec_execution"], "NOT_EXECUTED")


if __name__ == "__main__":
    unittest.main()
