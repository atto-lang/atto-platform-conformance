"""Fail-closed validation of executed versus preview-only playground claims."""
import json
import re
import unittest
from pathlib import Path

MATRIX = Path(__file__).resolve().parents[1] / "contracts" / "playground-example-backend-matrix-v1.json"
BACKENDS = ("atto_rs_native", "atto_rs_wasm_compiler", "atto_browser_pinned",
            "ores_java", "ores_llvm", "ores_wasm", "ores_forge", "ores_net")
SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
EVIDENCE = {"atto_rs_native", "atto_rs_wasm_compiler", "atto_browser_pinned"}
UNVERIFIED = set(BACKENDS) - EVIDENCE


def validate_contract(m):
    assert m["schema"] == "atto.playground.backend-execution-matrix.v1"
    assert m["backend_order"] == list(BACKENDS), "backend list is an API contract"
    assert m["statuses"] == ["passed", "expected_reject", "not_executed"]
    assert m["site"]["repository"] == "atto-lang/atto-lang.github.io"
    assert SHA1.fullmatch(m["site"]["commit"]) and SHA1.fullmatch(m["site"]["tree"])
    assert set(m["evidence"]) == EVIDENCE, "cannot add a claimed executed backend without review"
    assert m["backend_gaps"] == dict.fromkeys(UNVERIFIED, "not_executed")
    assert len(m["examples"]) == 43, "all 9 runnable + 34 preview samples required"
    unique_paths, unique_ids, source_hashes = set(), set(), set()
    n_previews = n_runnable = n_reject = 0
    for row in m["examples"]:
        assert set(row) == {"id", "path", "blob_sha1", "bytes", "published_tier",
                            "expected_result", "backend_status"}
        assert row["path"].startswith("play/examples/") and row["path"].endswith(".atto")
        assert not any(segment in ("..", "", ".") for segment in row["path"].split("/"))
        assert SHA1.fullmatch(row["blob_sha1"]) and 0 < row["bytes"] < 65536
        assert row["path"] not in unique_paths and row["id"] not in unique_ids
        unique_paths.add(row["path"])
        unique_ids.add(row["id"])
        source_hashes.add(row["blob_sha1"])
        preview = row["path"].startswith("play/examples/preview/")
        assert row["id"] == ("preview." if preview else "runnable.") + Path(row["path"]).stem
        assert set(row["backend_status"]) == set(BACKENDS)
        assert set(row["backend_status"].values()) <= set(m["statuses"])
        assert all(row["backend_status"][backend] == "not_executed" for backend in UNVERIFIED)
        if preview:
            n_previews += 1
            assert row["published_tier"] == "preview_disabled"
            assert row["expected_result"] == "not_executed"
            assert all(x == "not_executed" for x in row["backend_status"].values()), (
                "preview must never be promoted by a source-only matrix")
        else:
            n_runnable += 1
            expect_reject = row["id"] == "runnable.error"
            expect_panic = row["id"] == "runnable.overflow"
            expected = "expected_reject" if expect_reject else "passed"
            assert all(row["backend_status"][backend] == expected for backend in EVIDENCE)
            assert row["published_tier"] == (
                "expected_diagnostic" if expect_reject else
                "expected_panic" if expect_panic else "runnable")
            assert row["expected_result"] == (
                "E_IMMUTABLE" if expect_reject else
                "panic_code=1" if expect_panic else "guest_executed")
            n_reject += expect_reject
    assert (n_runnable, n_previews, n_reject) == (9, 34, 1)
    for backend, receipt in m["evidence"].items():
        assert receipt["status"] == "executed"
        assert receipt["url"].startswith("https://github.com/")
        assert "/actions/runs/" in receipt["url"]
        assert SHA1.fullmatch(receipt["head"]) and SHA1.fullmatch(receipt["tree"])
        assert receipt["toolchain"].strip() and receipt["description"].strip()
        if backend == "atto_browser_pinned":
            assert receipt["head"] == m["site"]["commit"]
            assert receipt["tree"] == m["site"]["tree"]
        else:
            assert receipt["head"] == "851aedd73c2c23b415949629ba775c149c69c6f8"
            assert receipt["tree"] == "d1a0c428ba810115a3cfeaa3106583b09bda6c88"
    return True


class PlaygroundMatrixContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(MATRIX.read_text("utf-8"))

    def test_exact_included_examples_and_source_identity(self):
        self.assertTrue(validate_contract(self.m))

    def test_full_43_example_inventory_and_feature_gates(self):
        self.assertEqual(len(self.m["examples"]), 43)
        self.assertEqual(sum(x["id"].startswith("preview.") for x in self.m["examples"]), 34)
        self.assertEqual(sum(x["backend_status"]["atto_rs_wasm_compiler"] == "passed"
                             for x in self.m["examples"]), 8)

    def test_explicit_backend_forge_and_net_gaps_are_never_marked_as_passed(self):
        for row in self.m["examples"]:
            for backend in UNVERIFIED:
                self.assertEqual(row["backend_status"][backend], "not_executed")

    def test_forged_executed_claim_and_preview_promotion_are_rejected(self):
        for mutate in (
            lambda m: m["examples"][0]["backend_status"].__setitem__("ores_llvm", "passed"),
            lambda m: m["examples"][0].__setitem__("blob_sha1", "fake"),
            lambda m: m["examples"][0].__setitem__("path", "../escape.atto"),
            lambda m: m["examples"][0].__setitem__("bytes", 0),
            lambda m: m["evidence"]["atto_rs_native"].__setitem__("status", "not_executed"),
            lambda m: m["evidence"]["atto_browser_pinned"].__setitem__("head", "f" * 40),
            lambda m: m["examples"].pop(),
            lambda m: m["examples"].append(m["examples"][0]),
            lambda m: next(x for x in m["examples"] if x["id"].startswith("preview."))[
                "backend_status"].__setitem__("atto_rs_native", "passed"),
        ):
            candidate = json.loads(json.dumps(self.m))
            mutate(candidate)
            with self.assertRaises(AssertionError):
                validate_contract(candidate)


if __name__ == "__main__":
    unittest.main()
