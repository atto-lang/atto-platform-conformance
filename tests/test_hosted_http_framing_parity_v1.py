"""Source-only numeric parity oracle, never a compiled Atto guest receipt."""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "contracts/hosted-http-framing-numeric-parity-v1.json"
BACKENDS = {"llvm", "java", "net", "wasm", "rs", "forge",
            "cranelift", "js", "atto", "hdl", "realtime"}
SHA40 = re.compile(r"^[0-9a-f]{40}$")


def reference(operation, a):
    if operation == "framing" and len(a) == 4:
        cl, te, chunked, unsupported = a
        if (type(cl) is not int or type(te) is not int
                or type(chunked) is not bool or type(unsupported) is not bool):
            return None
        if cl < 0 or cl > 1 or te < 0 or te > 1:
            return False
        if cl > 0 and te > 0 or unsupported:
            return False
        return not chunked if te == 0 else chunked
    if operation == "chunk" and len(a) == 3:
        consumed, next_bytes, ceiling = a
        if any(type(x) is not int for x in a):
            return None
        return (0 <= consumed <= ceiling <= 1073741824
                and next_bytes >= 0 and next_bytes <= ceiling - consumed)
    return None


def valid(v):
    if not isinstance(v, dict) or set(v) != {
        "schema", "status", "implementation_policy", "operations",
        "vectors", "observed_source_candidates", "backends"
    }:
        return False
    if (v["schema"] != "atto.std.http.numeric_parity.v1"
            or v["status"] != "ALL_GUEST_NOT_EXECUTED"
            or v["implementation_policy"] !=
            "BACKEND_LOCAL_NATIVE_ATTO_NOT_IDENTICAL_SOURCES"
            or set(v["operations"]) != {"framing", "chunk"}
            or not all(isinstance(x, str) and x for x in v["operations"].values())):
        return False
    vec = v["vectors"]
    if not isinstance(vec, list) or len(vec) != 12:
        return False
    seen = set()
    counts = {"framing": 0, "chunk": 0}
    for item in vec:
        if not isinstance(item, dict) or set(item) != {
            "id", "operation", "args", "expected"
        }:
            return False
        if item["id"] in seen or not isinstance(item["id"], str):
            return False
        seen.add(item["id"])
        operation = item["operation"]
        if operation not in counts or not item["id"].startswith(operation + "-"):
            return False
        if not isinstance(item["args"], list) or type(item["expected"]) is not bool:
            return False
        counts[operation] += 1
        if reference(operation, item["args"]) is not item["expected"]:
            return False
    if counts != {"framing": 9, "chunk": 3}:
        return False
    candidates = v["observed_source_candidates"]
    if not isinstance(candidates, list) or len(candidates) != 2:
        return False
    if {c.get("backend") for c in candidates} != {"java", "llvm"}:
        return False
    for c in candidates:
        if set(c) != {
            "backend", "repo", "pr", "head", "path", "blob_sha",
            "framing_function", "chunk_function", "source_status", "guest_status"
        }:
            return False
        if (c["repo"] != "atto-lang/atto-source." + c["backend"]
                or c["pr"] != (1754 if c["backend"] == "java" else 856)
                or not isinstance(c["head"], str)
                or not SHA40.fullmatch(c["head"])
                or not isinstance(c["blob_sha"], str)
                or not SHA40.fullmatch(c["blob_sha"])
                or not str(c["path"]).endswith(".atto")
                or c["source_status"] != "PRESENT_AT_CAPTURED_HEAD"
                or c["guest_status"] != "NOT_EXECUTED"):
            return False
        prefix = "http_" if c["backend"] == "llvm" else ""
        if (c["framing_function"] != prefix + "request_framing_fields_allowed"
                or c["chunk_function"] != prefix + "body_chunk_allowed"):
            return False
    rows = v["backends"]
    if not isinstance(rows, list) or len(rows) != len(BACKENDS):
        return False
    observed = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "backend", "guest_status", "executed_guest_cases"
        }:
            return False
        name = row["backend"]
        if name in observed or name not in BACKENDS:
            return False
        observed.add(name)
        if (row["guest_status"] != "NOT_EXECUTED"
                or type(row["executed_guest_cases"]) is not int
                or row["executed_guest_cases"] != 0):
            return False
    return observed == BACKENDS


class HostedHttpFramingParityV1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(DATA.read_text(encoding="utf-8"))

    def test_twelve_vectors_match_independent_integer_reference(self):
        self.assertTrue(valid(self.data))

    def test_all_eleven_guest_statuses_are_unexecuted(self):
        for name in BACKENDS:
            fake = copy.deepcopy(self.data)
            next(x for x in fake["backends"]
                 if x["backend"] == name)["guest_status"] = "PASS"
            self.assertFalse(valid(fake), name)

    def test_missing_or_falsified_vectors_cannot_unlock_pass(self):
        for i in range(12):
            changed = copy.deepcopy(self.data)
            changed["vectors"][i]["expected"] = not changed["vectors"][i]["expected"]
            self.assertFalse(valid(changed), i)
        missing = copy.deepcopy(self.data)
        missing["vectors"].pop()
        self.assertFalse(valid(missing))

    def test_source_only_snapshot_cannot_be_claimed_as_guest_execution(self):
        modified = copy.deepcopy(self.data)
        modified["observed_source_candidates"][0]["guest_status"] = "PASS"
        self.assertFalse(valid(modified))
        modified = copy.deepcopy(self.data)
        modified["implementation_policy"] = "ONE_CANONICAL_SOURCE_BLOB"
        self.assertFalse(valid(modified))


if __name__ == "__main__":
    unittest.main()
