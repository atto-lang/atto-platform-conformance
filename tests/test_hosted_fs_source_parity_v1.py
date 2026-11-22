"""Local contract checks only. Never interpret source inventory as guest parity."""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/hosted-fs-source-policy-parity-v1.json"
BACKENDS = {"java", "llvm", "net", "wasm", "rs", "forge", "cranelift", "js"}
UNSTAGED = {"atto", "hdl", "realtime"}
HEX40 = re.compile(r"^[a-f0-9]{40}$")


def is_safe_inventory(doc):
    if doc.get("schema") != "atto.std.fs.source_parity.v1":
        return False
    if doc.get("canonical_import") != 'import * as fs from "std.fs";':
        return False
    counts = doc.get("recorded_test_cases", {})
    if counts != {"api_admission": 32, "byte_io": 31, "combined": 63}:
        return False
    rows = doc.get("backend_sources")
    missing = doc.get("remaining_backends")
    if not isinstance(rows, list) or not isinstance(missing, list):
        return False
    if len(rows) != len(BACKENDS) or len(missing) != len(UNSTAGED):
        return False
    seen, api_sha, io_sha = set(), set(), set()
    for row in rows:
        if not isinstance(row, dict) or row.get("backend") not in BACKENDS:
            return False
        if row["backend"] in seen:
            return False
        seen.add(row["backend"])
        if row.get("source_status") != "STAGED_SOURCE_ONLY":
            return False
        if row.get("guest_status") != "NOT_EXECUTED" or row.get("executed_guest_cases") != 0:
            return False
        if not isinstance(row.get("captured_branch_head_sha"), str) or not HEX40.fullmatch(row["captured_branch_head_sha"]):
            return False
        if not row.get("repository", "").startswith("atto-lang/atto-source."):
            return False
        if not row.get("pr_url", "").startswith("https://github.com/atto-lang/atto-source."):
            return False
        for kind in ("api_policy", "io_policy", "api_fixture", "io_fixture"):
            entry = row.get(kind)
            if not isinstance(entry, dict):
                return False
            if not isinstance(entry.get("path"), str) or not isinstance(entry.get("blob_sha"), str):
                return False
            if not HEX40.fullmatch(entry["blob_sha"]):
                return False
        api_sha.add(row["api_fixture"]["blob_sha"])
        io_sha.add(row["io_fixture"]["blob_sha"])
    if seen != BACKENDS or len(api_sha) != 1 or len(io_sha) != 1:
        return False
    seen_missing = set()
    for row in missing:
        if not isinstance(row, dict) or row.get("backend") not in UNSTAGED:
            return False
        if row["backend"] in seen_missing:
            return False
        seen_missing.add(row["backend"])
        if (row.get("source_status"), row.get("guest_status"), row.get("executed_guest_cases")) != (
            "NOT_STAGED", "NOT_EXECUTED", 0
        ):
            return False
    if seen_missing != UNSTAGED:
        return False
    hosts = doc.get("host_vfs_candidates")
    if not isinstance(hosts, list) or len(hosts) != 2:
        return False
    if {x.get("backend") for x in hosts if isinstance(x, dict)} != {"js", "wasm"}:
        return False
    for host in hosts:
        if (host.get("local_v8_shimmed_groups") != 24 or
            host.get("local_v8_status") != "PASS_HOST_SHIM_ONLY" or
            host.get("node_exact_head") != "NOT_EXECUTED" or
            host.get("compiled_atto_guest") != "NOT_EXECUTED"):
            return False
    carrier = doc.get("runner_admission")
    if not isinstance(carrier, dict):
        return False
    if (carrier.get("carrier_repo_id") != 1378753797 or
        carrier.get("run_id") != 45047556666 or
        carrier.get("executed_steps") != 4 or
        carrier.get("job_conclusion") != "success" or
        carrier.get("private_source_transfer") != "NOT_PERFORMED" or
        carrier.get("run_head_sha") != "912dd632c3b29c0db6634a974977eb3bbf2bb2e4"):
        return False
    for host in hosts:
        if (host.get("source_transfer") != "BLOCKED_PENDING_INDEPENDENT_SECURITY_REVIEW" or
            not HEX40.fullmatch(host.get("captured_head_sha", "")) or
            not HEX40.fullmatch(host.get("runtime_blob_sha", "")) or
            not HEX40.fullmatch(host.get("test_blob_sha", ""))):
            return False
        overloads=host.get("file_object_overloads")
        if (not isinstance(overloads, dict) or
            overloads.get("implemented_host_only") is not True or
            overloads.get("typed_guest") != "NOT_EXECUTED" or
            overloads.get("seek") is not True or
            overloads.get("methods") != [
                "read_text","write_text","read_file","write_file"
            ]):
            return False
    return True


class HostedFsSourceParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_source_inventory_is_eight_backends_and_unexecuted(self):
        self.assertTrue(is_safe_inventory(self.doc))

    def test_forged_guest_pass_or_new_unpinned_backend_is_rejected(self):
        for row in self.doc["backend_sources"]:
            forged = copy.deepcopy(self.doc)
            chosen = next(x for x in forged["backend_sources"] if x["backend"] == row["backend"])
            chosen["guest_status"] = "PASS"
            chosen["executed_guest_cases"] = 63
            self.assertFalse(is_safe_inventory(forged), row["backend"])
        forged = copy.deepcopy(self.doc)
        forged["remaining_backends"].pop()
        self.assertFalse(is_safe_inventory(forged))

    def test_source_blob_tampering_and_host_evidence_laundering_are_rejected(self):
        for kind in ("api_policy", "io_policy", "api_fixture", "io_fixture"):
            forged = copy.deepcopy(self.doc)
            forged["backend_sources"][0][kind]["blob_sha"] = "unverified"
            self.assertFalse(is_safe_inventory(forged), kind)
        forged = copy.deepcopy(self.doc)
        forged["host_vfs_candidates"][0]["compiled_atto_guest"] = "PASS"
        self.assertFalse(is_safe_inventory(forged))
        forged = copy.deepcopy(self.doc)
        forged["host_vfs_candidates"][1]["node_exact_head"] = "PASS"
        self.assertFalse(is_safe_inventory(forged))
        forged = copy.deepcopy(self.doc)
        forged["runner_admission"]["private_source_transfer"] = "COMPLETE"
        self.assertFalse(is_safe_inventory(forged))
        forged = copy.deepcopy(self.doc)
        forged["host_vfs_candidates"][0]["source_transfer"] = "APPROVED"
        self.assertFalse(is_safe_inventory(forged))
        forged = copy.deepcopy(self.doc)
        forged["host_vfs_candidates"][0]["file_object_overloads"]["typed_guest"] = "PASS"
        self.assertFalse(is_safe_inventory(forged))


if __name__ == "__main__":
    unittest.main()
