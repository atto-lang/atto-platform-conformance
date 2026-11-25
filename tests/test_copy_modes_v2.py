"""Host-only copy-mode fixture registry checks; NOT compiled AttoLang evidence."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "contracts" / "copy-modes-v2.json"
KNOWN_BACKENDS = {"java", "llvm", "net", "wasm", "forge", "rs", "js", "cranelift"}


def validate(document):
    assert document.get("schema") == "atto-copy-modes-v2"
    assert document.get("status") == "CANDIDATE_NOT_IMPLEMENTED"
    assert document.get("language_semantics", {}).get("user_argument_count") == 0
    statuses = document.get("backends")
    assert isinstance(statuses, dict) and set(statuses) == KNOWN_BACKENDS
    assert set(statuses.values()) == {"NOT_EXECUTED"}
    entries = document.get("fixtures")
    assert isinstance(entries, list) and len(entries) >= 9
    seen_ids, seen_paths = set(), set()
    for entry in entries:
        assert set(entry) in ({"id", "path", "expect"}, {"id", "path", "expect", "exit_code"})
        assert isinstance(entry["id"], str) and entry["id"] and entry["id"] not in seen_ids
        seen_ids.add(entry["id"])
        path = entry["path"]
        assert isinstance(path, str) and path.startswith("fixtures/copy-modes-v2/")
        assert ".." not in Path(path).parts and path not in seen_paths
        seen_paths.add(path)
        expected = entry["expect"]
        assert expected == "PASS" or (expected.startswith("E_") and expected.isupper())
        if expected == "PASS":
            assert isinstance(entry.get("exit_code"), int)
        else:
            assert "exit_code" not in entry
        source = (ROOT / path).read_text(encoding="utf-8")
        expected_header = ("// expect-exit: " + str(entry["exit_code"])) if expected == "PASS" else ("// expect-error: " + expected)
        assert source.startswith(expected_header)
    assert any(x["id"] == "actor-two-recipients" for x in entries)
    assert any(x["id"] == "superclass-concrete" for x in entries)
    assert any(x["id"] == "shallow-exclusive-reject" for x in entries)


class CopyModeManifestTests(unittest.TestCase):
    def test_real_candidate_registry_structure_only(self):
        validate(json.loads(MANIFEST.read_text(encoding="utf-8")))

    def test_forged_backend_pass_rejected(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        data["backends"]["java"] = "PASS"
        with self.assertRaises(AssertionError):
            validate(data)

    def test_missing_actor_fanout_fixture_rejected(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        data["fixtures"] = [x for x in data["fixtures"] if x["id"] != "actor-two-recipients"]
        with self.assertRaises(AssertionError):
            validate(data)

    def test_duplicate_case_rejected(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        data["fixtures"].append(data["fixtures"][0].copy())
        with self.assertRaises(AssertionError):
            validate(data)

    def test_fake_success_failure_pair_rejected(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        data["fixtures"][0]["expect"] = "PASS"
        data["fixtures"][0]["exit_code"] = None
        with self.assertRaises(AssertionError):
            validate(data)


if __name__ == "__main__":
    unittest.main()
