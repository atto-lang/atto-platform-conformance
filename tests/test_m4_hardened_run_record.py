"""Historical M4 hardening receipt structure; actual provenance is NOT authenticated here."""
import copy
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "evidence/m4/hardened-dual-native-actor-runs-20261107.json"
M = json.loads(FILE.read_text())
CONTRACT = json.loads((ROOT / "contracts/m4-shared-actor-counter-v1.json").read_text())
SHA40 = re.compile("[a-f0-9]{40}\Z")
SHA64 = re.compile("[a-f0-9]{64}\Z")

def enforce(ok, msg):
    if not ok:
        raise AssertionError(msg)

def check(m):
    source = (ROOT / CONTRACT["fixture"]).read_bytes()
    enforce(m["schema"] == "atto.m4.hardened-native-execution-evidence.v1", "schema")
    enforce(m["source"]["fixture"] == CONTRACT["fixture"], "fixture path")
    enforce(m["source"]["git_blob_sha"] == CONTRACT["source_git_blob_sha"], "git blob")
    enforce(m["source"]["sha256"] == hashlib.sha256(source).hexdigest(), "source SHA256")
    expected = CONTRACT["expected"]
    for backend, repo in (("llvm", "atto-source.llvm"), ("graalvm", "atto-source.java")):
        info = m[backend]
        enforce(SHA40.fullmatch(info["head_sha"]) is not None, "source head")
        enforce(SHA64.fullmatch(info["native_artifact_sha256"]) is not None, "artifact digest")
        enforce(info["run_url"].startswith("https://github.com/atto-lang/" + repo +
                                           "/actions/runs/"), "exact runner URL")
        enforce(info["pr"].startswith("https://github.com/atto-lang/" + repo +
                                     "/pull/"), "PR reference")
        enforce(info["conclusion"] == "success", "workflow failed")
    llvm = m["llvm"]["observed"]
    graal = m["graalvm"]["observed"]
    enforce(llvm["source_main_return"] == expected["return_i64"], "LLVM return")
    enforce(graal["source_main_return"] == expected["return_i64"], "Graal return")
    enforce(llvm["independent_host_reply_trace_digest"] == expected["rolling_digest"],
            "LLVM observed digest")
    enforce(graal["rolling_guest_digest"] == expected["rolling_digest"], "Graal digest")
    enforce(graal["synchronous_actor_sends"] == llvm["original_fixture_message_sends"] ==
            expected["sends"], "message count")
    enforce(graal["actor_arena_closes"] == llvm["original_fixture_actor_stops"] ==
            expected["stops"], "actor closes")
    enforce(llvm["stale_actor_handle_denied"] is True and
            llvm["actor_reincarnation_fresh_state"] is True and
            llvm["neighbor_tenant_survived"] is True, "LLVM lifetime")
    enforce(llvm["wrong_digest_native_loader_refused"] is True and
            llvm["byte_tampered_native_loader_refused"] is True and
            llvm["asan_ubsan_host_passed"] is True, "LLVM admission/san")
    enforce(m["llvm"]["source_blob_verification"] == 57, "upstream source blobs")
    enforce(graal["gc_collections_delta"] == 0, "runtime collector delta")
    enforce(graal["original_parser_tests"] == 17 and
            graal["new_hardening_tests"] == 14 and
            graal["seeded_actor_message_traces"] == 96, "tests")
    enforce(graal["emitted_java_jvm_atomic_rollback_probe"] is True and
            graal["emitted_java_jvm_ffm_arena_retirement_fence"] is True, "JVM native probe")
    enforce(m["graalvm"]["limits"] == {"max_actor_instances":64,
                                        "max_source_sends":1024}, "limits")
    enforce("separate JVM" in m["graalvm"]["scope"], "do not claim native probe")
    enforce("separate native host calls" in " ".join(m["not_verified"]),
            "do not claim identical scheduling")
    enforce("not signed CI attestation" in " ".join(m["not_verified"]),
            "do not claim signed provenance")
    gate = m["release_gates"]
    enforce(gate["same_source_narrow_native_guest"] == "OBSERVED_TWO_BACKENDS",
            "narrow compiled guest evidence")
    for key in ("independent_async_actor_scheduler", "full_ownership_borrow_checker",
                "security_hardened_tenant_sandbox", "long_lived_zero_gc_heap_bound",
                "five_backend_parity"):
        enforce(gate[key] == "NOT_EXECUTED", "unearned release gate: " + key)
    return True

class HardenedM4RunRecord(unittest.TestCase):
    def test_observed_record_structure(self):
        self.assertTrue(check(M))

    def rejected(self, mut):
        obj = copy.deepcopy(M)
        mut(obj)
        with self.assertRaises((AssertionError, KeyError, TypeError)):
            check(obj)

    def test_wrong_compiler_head(self):
        self.rejected(lambda m: m["llvm"].update(head_sha="unverified"))

    def test_wrong_binary_sha(self):
        self.rejected(lambda m: m["graalvm"].update(native_artifact_sha256="pending"))

    def test_unverified_fixture(self):
        self.rejected(lambda m: m["source"].update(sha256="0"*64))

    def test_wrong_native_result(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(source_main_return=44))

    def test_stale_handle_not_denied(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(stale_actor_handle_denied=False))

    def test_slot_recycling_preserves_stale_state(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(actor_reincarnation_fresh_state=False))

    def test_no_neighbor_survival(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(neighbor_tenant_survived=False))

    def test_wrong_digest_bypasses_loader(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(wrong_digest_native_loader_refused=False))

    def test_tampered_guest_bypasses_loader(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(byte_tampered_native_loader_refused=False))

    def test_sanitizers_not_executed(self):
        self.rejected(lambda m: m["llvm"]["observed"].update(asan_ubsan_host_passed=False))

    def test_no_jvm_rollback_probe(self):
        self.rejected(lambda m: m["graalvm"]["observed"].update(emitted_java_jvm_atomic_rollback_probe=False))

    def test_nonzero_gc_collection(self):
        self.rejected(lambda m: m["graalvm"]["observed"].update(gc_collections_delta=1))

    def test_relaxed_actor_instance_cap(self):
        self.rejected(lambda m: m["graalvm"]["limits"].update(max_actor_instances=100000))

    def test_forged_hostile_tenant_security(self):
        self.rejected(lambda m: m["release_gates"].update(security_hardened_tenant_sandbox="PASSED"))

    def test_forged_scheduler_parity(self):
        self.rejected(lambda m: m["release_gates"].update(independent_async_actor_scheduler="PASSED"))

    def test_forged_zero_gc_release_status(self):
        self.rejected(lambda m: m["release_gates"].update(long_lived_zero_gc_heap_bound="PASSED"))

    def test_forged_five_backend_parity(self):
        self.rejected(lambda m: m["release_gates"].update(five_backend_parity="PASSED"))

if __name__ == "__main__":
    unittest.main()
