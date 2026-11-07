"""Strict source/semantic registry tests only; never a compiled-guest attestation."""
import copy
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "contracts/m4-shared-actor-counter-v1.json"
SPEC = json.loads(PATH.read_text())

def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def check(spec):
    assert spec["schema"] == "atto.m4.cross-backend-actor-fixture.v1"
    assert spec["scope"].startswith("exact identical .atto source bytes")
    rel = spec["fixture"]
    assert rel == "fixtures/m4/shared_actor_counter.atto"
    path = ROOT / rel
    assert path.is_file() and not path.is_symlink()
    data = path.read_bytes()
    assert blob_sha(data) == spec["source_git_blob_sha"]
    source = data.decode("utf-8", "strict")
    assert "define actor Counter as {" in source
    assert "pub fnc on_message(int increment): int {" in source
    assert "return 43;" in source
    assert re.findall(r"(first|second)\.send\((-?\d+)\);", source) == [
        ("first", "7"), ("second", "9"), ("first", "8")]
    assert re.findall(r"stop\s+(first|second);", source) == ["first", "second"]
    assert spec["actor_instances"] == 2 and spec["actor_kind"] == "Counter"
    operations = spec["operations"]
    assert [x["kind"] for x in operations] == [
        "spawn", "spawn", "send", "send", "send", "stop", "stop"]
    assert [x["actor"] for x in operations] == [
        "first", "second", "first", "second", "first", "first", "second"]
    live = {}
    digest = sends = stops = 0
    for op in operations:
        actor = op["actor"]
        if op["kind"] == "spawn":
            assert actor not in live
            live[actor] = 0
        elif op["kind"] == "send":
            assert actor in live
            assert type(op["value"]) is int
            live[actor] += op["value"]
            assert -(1 << 63) <= live[actor] < (1 << 63)
            assert op["expected_state"] == live[actor]
            digest = digest * 31 + live[actor]
            assert -(1 << 63) <= digest < (1 << 63)
            sends += 1
        elif op["kind"] == "stop":
            assert actor in live
            del live[actor]
            stops += 1
        else:
            raise AssertionError("unknown operation")
    assert not live
    expect = spec["expected"]
    assert expect["return_i64"] == 43
    assert expect["sends"] == sends and sends == 3
    assert expect["stops"] == stops and stops == 2
    assert expect["final_actor_states"] == {"first": 15, "second": 9}
    assert expect["rolling_digest"] == digest == 7021
    required = spec["required_evidence"]
    assert {"compilation", "source_identity", "runtime", "observable_guest_return",
            "extended_message_telemetry", "tenant_security", "zero_gc"} == set(required)
    assert "only if runtime actually exposes them" in required["extended_message_telemetry"]
    assert "adversarially tested" in required["tenant_security"]
    assert "collector counters" in required["zero_gc"]
    status = spec["backend_evidence"]
    assert set(status) == {"llvm", "graalvm-native", "wasm", "forge", "net"}
    assert all(v["status"] != "PASSED" for v in status.values())
    assert status["llvm"]["status"] == "NOT_EXECUTED_FOR_THIS_EXACT_FIXTURE"
    assert status["wasm"]["status"] == "UNSUPPORTED_ACTOR_ABI"
    return True


class M4ContractTest(unittest.TestCase):
    def test_canonical_semantics_and_blob(self):
        self.assertTrue(check(SPEC))

    def rejects(self, mutator):
        spec = copy.deepcopy(SPEC)
        mutator(spec)
        with self.assertRaises((AssertionError, KeyError, ValueError)):
            check(spec)

    def test_reject_modified_source_hash(self):
        self.rejects(lambda s: s.update(source_git_blob_sha="0" * 40))

    def test_reject_message_reordering(self):
        self.rejects(lambda s: s["operations"].__setitem__(2, dict(
            actor="second", kind="send", value=9, expected_state=9)))

    def test_reject_false_rolling_digest(self):
        self.rejects(lambda s: s["expected"].update(rolling_digest=7020))

    def test_reject_fake_return(self):
        self.rejects(lambda s: s["expected"].update(return_i64=0))

    def test_reject_extra_send(self):
        self.rejects(lambda s: s["expected"].update(sends=4))

    def test_reject_fake_tenant_claim(self):
        self.rejects(lambda s: s["backend_evidence"]["llvm"].update(status="PASSED"))

    def test_reject_false_wasm_actor_abi(self):
        self.rejects(lambda s: s["backend_evidence"]["wasm"].update(status="PASSED"))

    def test_reject_missing_native_gc_observation(self):
        self.rejects(lambda s: s["required_evidence"].update(zero_gc="none"))

    def test_reject_claim_without_message_observability(self):
        self.rejects(lambda s: s["required_evidence"].update(
            extended_message_telemetry="always passed"))

    def test_reject_missing_guest_execution_requirement(self):
        self.rejects(lambda s: s["required_evidence"].pop("runtime"))

if __name__ == "__main__":
    unittest.main()
