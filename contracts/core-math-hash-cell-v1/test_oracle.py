#!/usr/bin/env python3
"""Source-free Atto core math/hash/cell behavioral oracle.

Run: python3 -m unittest discover -s contracts/core-math-hash-cell-v1 -p 'test_*.py' -v
This is NOT a guest compiler or LLVM/Java execution receipt.
"""
from pathlib import Path
import json
import unittest

CONTRACT = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))


def hash_step(state, octet):
    if not (0 <= state < 1000000007 and 0 <= octet <= 255):
        return -1
    candidate = state * 31 + octet
    for _ in range(31):
        if candidate >= 1000000007:
            candidate -= 1000000007
    return candidate


def can_read(readers, writer):
    return 0 <= readers <= 65535 and not writer


def can_write(readers, writer):
    return readers == 0 and not writer


def after_acquire(readers, writer):
    if not can_read(readers, writer) or readers == 65535:
        return -1
    return readers + 1


def after_release(readers, writer):
    if readers <= 0 or readers > 65535 or writer:
        return -1
    return readers - 1


class SourceFreeCoreOracle(unittest.TestCase):
    def test_math_vectors(self):
        for value, want in CONTRACT["math"]["signum"]:
            got = -1 if value < 0 else 1 if value > 0 else 0
            self.assertEqual(got, want)
        for x in CONTRACT["math"]["closed_bounds"]:
            valid = x["lower"] <= x["upper"]
            got = valid and x["lower"] <= x["value"] <= x["upper"]
            self.assertEqual(got, x["expected"])

    def test_hash_vectors_and_boundary_residue(self):
        h = CONTRACT["hash"]
        self.assertFalse(h["cryptographic"])
        self.assertFalse(h["canonical_full_value_Hash_trait"])
        for v in h["vectors"]:
            self.assertEqual(hash_step(v["state"], v["octet"]), v["expected"])
        for state in [0, 1, 17, h["prime"] - 2, h["prime"] - 1]:
            for byte in range(256):
                self.assertEqual(hash_step(state, byte),
                                 (state * 31 + byte) % h["prime"])
        self.assertEqual(hash_step(hash_step(17, 42), 7), 17646)

    def test_cell_policy_vectors_not_borrow_authority(self):
        c = CONTRACT["cell"]
        for name, predicate in (("read_vectors", can_read),
                                ("write_vectors", can_write)):
            for v in c[name]:
                self.assertEqual(predicate(v["readers"], v["writer"]), v["expected"])
        for name, operation in (("acquire_vectors", after_acquire),
                                ("release_vectors", after_release)):
            for v in c[name]:
                self.assertEqual(operation(v["readers"], v["writer"]), v["expected"])
        self.assertFalse(c["usable_cell_T"])
        self.assertFalse(c["usable_refcell_T"])
        self.assertTrue(c["requires_compiler_borrow_enforcement"])

    def test_evidence_never_upgrades_by_presence_of_source(self):
        self.assertEqual(CONTRACT["status"], "candidate_source_free_not_guest_verified")
        self.assertEqual(len(CONTRACT["candidates"]), 11)
        self.assertEqual({x["backend"] for x in CONTRACT["candidates"]},
                         {"java","llvm","net","wasm","rs","forge","js",
                          "cranelift","hdl","atto","realtime"})
        for x in CONTRACT["candidates"]:
            self.assertEqual(x["guest_status"], "NOT_EXECUTED")
            self.assertEqual(x["material_ci_status"], "NOT_EXECUTED")
            self.assertFalse(x["real_cell_T"])
            self.assertTrue(x["module_sources_are_backend_owned"])
            self.assertRegex(x["commit"],r"^[0-9a-f]{40}$")
            self.assertGreater(x["pr"],0)
            self.assertEqual(set(x["source_blobs"]),{"math","hash","cell"})
            for source in x["source_blobs"].values():
                self.assertTrue(source["path"].endswith(".atto"))
                self.assertRegex(source["blob_sha1"],r"^[0-9a-f]{40}$")
        for certified in CONTRACT["certification"].values():
            self.assertIs(certified, False)


if __name__ == "__main__":
    unittest.main()
