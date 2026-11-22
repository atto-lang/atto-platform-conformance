"""Contract-only audit: fail closed on claims of compiled std.fs File support.

This validator never executes a compiler or promotes a host/V8 shim result
to Node or native-Atto guest parity.
"""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "contracts" / "hosted-fs-file-handle-port-v1.json"
SHA = re.compile(r"^[a-f0-9]{40}$")
EXPECTED = {
    "wasm": ("atto-lang/atto-source.wasm", 1448701355),
    "js": ("atto-lang/atto-source.js", 1448703338),
}
REQUIRED = {
    "host_owned_ticket_never_guest_supplied",
    "actor_and_tenant_scope_per_port",
    "issuer_recorded_file_objects_never_exposed_to_guest",
    "deny_forged_unissued_or_noninteger_handles",
    "distinct_issued_and_open_budgets",
    "handle_id_not_reused_even_after_open_failure",
    "reserve_pending_open_before_side_effect",
    "serialize_overlapping_operations_per_file",
    "post_cancel_read_completion_must_not_report_success",
    "close_all_waits_inflight_and_pending_opens",
    "unknown_write_outcome_no_implicit_retry",
    "not_cross_org_mirrored_without_transfer_review",
}


def valid(doc):
    if not isinstance(doc, dict):
        return False
    if doc.get("schema") != "atto.std.fs.file_handle_port.v1":
        return False
    if doc.get("scope") != "HOST_ONLY_UNLINKED":
        return False
    if doc.get("guest_import_linked") is not False:
        return False
    if doc.get("native_aot_compiled_guest") != "NOT_EXECUTED":
        return False
    if doc.get("user_public_api") != 'import * as fs from "std.fs";':
        return False
    if not REQUIRED.issubset(set(doc.get("invariants", []))):
        return False
    wire = doc.get("wire_model", {})
    if wire.get("async") != "Promise-only host; Atto susp/await lowering NOT_LINKED":
        return False
    if wire.get("handle") != (
        "positive safe integer, scoped within one actor port, "
        "monotonically issued and not reused"
    ):
        return False
    tests = doc.get("source_tests", {})
    if (
        tests.get("port_groups_per_backend") != 16
        or tests.get("existing_host_vfs_groups_per_backend") != 24
        or tests.get("combined_host_only_groups_per_backend") != 40
        or tests.get("unicode_full_utf8") != "NOT_EXECUTED"
        or tests.get("source_node22_exact_head") != "NOT_EXECUTED"
        or tests.get("compiled_atto_file_guest") != "NOT_EXECUTED"
    ):
        return False
    rows = doc.get("backends")
    if not isinstance(rows, list) or len(rows) != 2:
        return False
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            return False
        name = row.get("backend")
        if name not in EXPECTED or name in seen:
            return False
        seen.add(name)
        repo, numeric_id = EXPECTED[name]
        if row.get("repository") != repo or row.get("numeric_repository_id") != numeric_id:
            return False
        if row.get("node22") != "NOT_EXECUTED" or row.get("guest") != "NOT_EXECUTED":
            return False
        if not isinstance(row.get("head_sha"), str) or not SHA.fullmatch(row["head_sha"]):
            return False
        files = row.get("files")
        if not isinstance(files, dict) or set(files) != {
            "vfs", "vfs_tests", "port", "port_tests"
        }:
            return False
        if any(not isinstance(x, str) or not SHA.fullmatch(x) for x in files.values()):
            return False
    if seen != set(EXPECTED):
        return False
    ci = doc.get("ci", {})
    if (
        ci.get("carrier_repo") != "ORESoftware/ores-e2e-core"
        or ci.get("source_free_admission_run") != 45047556666
        or ci.get("source_free_executed_steps") != 4
        or ci.get("mirror_scope") != "PRIVATE_SOURCE_NOT_TRANSFERRED"
        or ci.get("mirror_authorization") != "BLOCKED"
        or ci.get("security_review_issue")
        != "https://github.com/atto-lang/atto-source.wasm/issues/286"
    ):
        return False
    return True


class FsFileHandlePortContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = json.loads(PATH.read_text(encoding="utf-8"))

    def test_contract_is_host_only_and_sha_pinned(self):
        self.assertTrue(valid(self.current))

    def test_cannot_forge_node_or_compiled_guest_execution(self):
        for field, value in [
            ("guest_import_linked", True),
            ("native_aot_compiled_guest", "PASS"),
        ]:
            changed = copy.deepcopy(self.current)
            changed[field] = value
            self.assertFalse(valid(changed), field)
        changed = copy.deepcopy(self.current)
        changed["backends"][0]["guest"] = "PASS"
        self.assertFalse(valid(changed))
        changed = copy.deepcopy(self.current)
        changed["source_tests"]["source_node22_exact_head"] = "PASS"
        self.assertFalse(valid(changed))

    def test_security_mirror_and_source_hash_tampering_rejected(self):
        changed = copy.deepcopy(self.current)
        changed["ci"]["mirror_authorization"] = "APPROVED"
        self.assertFalse(valid(changed))
        changed = copy.deepcopy(self.current)
        changed["ci"]["mirror_scope"] = "MIRRORED"
        self.assertFalse(valid(changed))
        changed = copy.deepcopy(self.current)
        changed["backends"][1]["files"]["port_tests"] = "unverified"
        self.assertFalse(valid(changed))
        changed = copy.deepcopy(self.current)
        changed["invariants"].remove("actor_and_tenant_scope_per_port")
        self.assertFalse(valid(changed))


if __name__ == "__main__":
    unittest.main()
