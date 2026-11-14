#!/usr/bin/env python3
"""Mutation tests for v2 actor trace refinement. No compiled guest is claimed."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
from check_actor_trace_v2 import TraceViolation, verify_trace, load_json, main, CONTRACT

CONTRACT_DATA = json.loads(CONTRACT.read_text())
BASE = {"schema": "atto.actor-trace.v2", "complete": True, "producer": {
    "backend": "llvm", "subject": "runtime_host",
    "emission": "online_linearization_points"}, "events": []}


def ev(kind, generation=1, actor_id="actor-a", **extra):
    return dict(kind=kind, actor_id=actor_id, generation=generation, **extra)


def fixture():
    t = copy.deepcopy(BASE)
    items = [
        ev("actor_spawn", serial=False),
        ev("send_accept", message_id="m1"),
        ev("send_accept", message_id="m2"),
        ev("send_accept", message_id="m3"),
        ev("receive_start", message_id="m1", receiver_id="r1"),
        ev("receive_start", message_id="m2", receiver_id="r2"),
        ev("critical_read_enter", receiver_id="r1"),
        ev("critical_read_enter", receiver_id="r2"),
        ev("critical_read_exit", receiver_id="r2"),
        ev("critical_read_exit", receiver_id="r1"),
        ev("critical_write_enter", receiver_id="r1"),
        ev("critical_write_exit", receiver_id="r1"),
        ev("control_admit"),
        ev("actor_close"),
        ev("control_dispatch"),
        ev("message_discard", message_id="m3"),
        ev("receive_complete", message_id="m2", receiver_id="r2"),
        ev("receive_complete", message_id="m1", receiver_id="r1"),
        ev("actor_retire"),
        ev("actor_spawn", generation=2, serial=True),
        ev("send_accept", generation=2, message_id="m4"),
        ev("receive_start", generation=2, message_id="m4", receiver_id="r3"),
        ev("receive_complete", generation=2, message_id="m4", receiver_id="r3"),
        ev("actor_close", generation=2),
        ev("actor_retire", generation=2),
    ]
    t["events"] = [dict(seq=i, **e) for i, e in enumerate(items)]
    return t


def mutate(which):
    t = fixture()
    e = t["events"]
    if which == "gap": e[5]["seq"] = 8
    elif which == "missing field": del e[4]["receiver_id"]
    elif which == "unexpected field": e[4]["data"] = "forged"
    elif which == "duplicate message": e[2]["message_id"] = "m1"
    elif which == "stale generation": e[20]["generation"] = 1
    elif which == "wrong actor": e[6]["actor_id"] = "other"
    elif which == "serial parallel": e[0]["serial"] = True
    elif which == "critical writer while readers": e[10]["seq"] = 7; e[10], e[7] = e[7], e[10]; renumber(e)
    elif which == "critical read while writer": e[7], e[11] = e[11], e[7]; renumber(e)
    elif which == "wrong lock owner": e[8]["receiver_id"] = "r3"
    elif which == "unmatched write exit": e[11]["receiver_id"] = "r2"
    elif which == "complete with lock": e.pop(11); renumber(e)
    elif which == "DATA over CONTROL":
        e.insert(13, ev("receive_start", message_id="m3", receiver_id="r4")); renumber(e)
    elif which == "CONTROL duplicate":
        e.insert(13, ev("control_admit")); renumber(e)
    elif which == "CONTROL missing": e.pop(12); renumber(e)
    elif which == "discard live message": e[15]["message_id"] = "m2"
    elif which == "discard before close": e[15], e[13] = e[13], e[15]; renumber(e)
    elif which == "double completion":
        e.insert(17, ev("receive_complete", message_id="m2", receiver_id="r2")); renumber(e)
    elif which == "unsettled retire": e.pop(16); renumber(e)
    elif which == "double retire": e.insert(19, ev("actor_retire")); renumber(e)
    elif which == "restart without retire": e.pop(18); renumber(e)
    elif which == "wrong restart generation": e[19]["generation"] = 3
    elif which == "send after close": e.insert(14, ev("send_accept", message_id="late")); renumber(e)
    elif which == "incomplete": t["complete"] = False
    elif which == "empty": t["events"] = []
    elif which == "fake producer": t["producer"]["backend"] = "magic"
    elif which == "guest posthoc": t["producer"]["subject"] = "compiled_atto_guest"; t["producer"]["emission"] = "reconstructed_after_quiescence"
    elif which == "unknown field": t["producer"]["claimed_pass"] = True
    elif which == "bool generation": e[1]["generation"] = True
    elif which == "negative seq": e[0]["seq"] = -1
    elif which == "wrong fifo": e[4]["message_id"] = "m2"
    elif which == "no close": e.pop(13); renumber(e)
    else: raise AssertionError("unknown mutation: " + which)
    return t


def renumber(events):
    for i, event in enumerate(events):
        event["seq"] = i


MUTANTS = [
    "gap", "missing field", "unexpected field", "duplicate message",
    "stale generation", "wrong actor", "serial parallel",
    "critical writer while readers", "critical read while writer",
    "wrong lock owner", "unmatched write exit", "complete with lock",
    "DATA over CONTROL", "CONTROL duplicate", "CONTROL missing",
    "discard live message", "discard before close", "double completion",
    "unsettled retire", "double retire", "restart without retire",
    "wrong restart generation", "send after close", "incomplete", "empty",
    "fake producer", "guest posthoc", "unknown field", "bool generation",
    "negative seq", "wrong fifo", "no close",
]


class ActorTraceV2Test(unittest.TestCase):
    def test_valid_parallel_reader_writer_control_and_restart(self):
        outcome = verify_trace(fixture(), CONTRACT_DATA)
        self.assertEqual(outcome["spawns"], 2)
        self.assertEqual((outcome["admitted"], outcome["completed"], outcome["discarded"]), (4, 3, 1))
        self.assertEqual(outcome["control_dispatches"], 1)
        self.assertTrue(outcome["parallel_receives_witnessed"])
        self.assertTrue(outcome["parallel_reads_witnessed"])

    def test_mutants_all_rejected(self):
        for mutant in MUTANTS:
            with self.subTest(mutant=mutant):
                with self.assertRaises(TraceViolation):
                    verify_trace(mutate(mutant), CONTRACT_DATA)

    def test_json_duplicate_fields_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "dup.json"
            p.write_text('{"schema":"x","schema":"atto.actor-trace.v2"}')
            with self.assertRaisesRegex(TraceViolation, "duplicate JSON"):
                load_json(p)

    def test_receipt_exact_roundtrip_and_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "valid.json"
            p.write_text(json.dumps(fixture()) + "\n")
            self.assertEqual(main([str(p)]), 0)
            self.assertEqual(verify_trace(load_json(p))["admitted"], 4)

    def test_oversize_trace_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "big.json"
            p.write_bytes(b" " * (8_000_001))
            with self.assertRaises(TraceViolation):
                load_json(p)

    def test_backend_provenance_not_promoted(self):
        t = fixture()
        t["producer"] = {"backend": "reference", "subject": "reference_model",
                         "emission": "reconstructed_after_quiescence"}
        self.assertEqual(verify_trace(t)["spawns"], 2)
        t["producer"]["backend"] = "java"
        with self.assertRaises(TraceViolation):
            verify_trace(t)
        t["producer"] = {"backend": "reference", "subject": "runtime_host",
                         "emission": "online_linearization_points"}
        with self.assertRaisesRegex(TraceViolation, "must agree"):
            verify_trace(t)
        t["producer"]["subject"] = "compiled_atto_guest"
        with self.assertRaises(TraceViolation):
            verify_trace(t)

    def test_cli_requires_backend_tier_and_parallel_witnesses(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "valid.json"
            p.write_text(json.dumps(fixture()) + "\n")
            requirements = ["--require-backend", "llvm", "--require-subject",
                            "runtime_host", "--require-emission",
                            "online_linearization_points", "--min-admitted", "4",
                            "--min-control-dispatches", "1",
                            "--require-parallel-receives", "--require-parallel-reads"]
            self.assertEqual(main(requirements + [str(p)]), 0)
            self.assertEqual(main(["--require-subject", "compiled_atto_guest", str(p)]), 1)
            self.assertEqual(main(["--require-backend", "java", str(p)]), 1)
            self.assertEqual(main(["--require-emission", "reconstructed_after_quiescence", str(p)]), 1)
            self.assertEqual(main(["--min-admitted", "5", str(p)]), 1)
            self.assertEqual(main(["--min-control-dispatches", "2", str(p)]), 1)
            self.assertEqual(main(["--min-admitted", "-1", str(p)]), 1)
            self.assertEqual(main(["--min-admitted", "100001", str(p)]), 1)
            self.assertEqual(main(["--min-control-dispatches", "-1", str(p)]), 1)
            t = fixture()
            t["events"] = [e for e in t["events"] if e["kind"] not in
                           {"critical_read_enter", "critical_read_exit",
                            "critical_write_enter", "critical_write_exit"}]
            for i, event in enumerate(t["events"]):
                event["seq"] = i
            p.write_text(json.dumps(t) + "\n")
            self.assertEqual(main(["--require-parallel-reads", str(p)]), 1)
            self.assertEqual(main(["--require-parallel-receives", str(p)]), 0)

    def test_cli_refuses_missing_parallel_receivers(self):
        t = fixture()
        # A separate serial host receipt legitimately has no overlapping turn
        # witnesses, but MUST NOT satisfy the concurrent guest CI gate.
        t["events"] = [
            dict(seq=0, kind="actor_spawn", actor_id="a", generation=1, serial=True),
            dict(seq=1, kind="send_accept", actor_id="a", generation=1, message_id="m"),
            dict(seq=2, kind="receive_start", actor_id="a", generation=1,
                 message_id="m", receiver_id="r"),
            dict(seq=3, kind="receive_complete", actor_id="a", generation=1,
                 message_id="m", receiver_id="r"),
            dict(seq=4, kind="actor_close", actor_id="a", generation=1),
            dict(seq=5, kind="actor_retire", actor_id="a", generation=1),
        ]
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "serial.json"
            p.write_text(json.dumps(t) + "\n")
            self.assertEqual(main(["--require-parallel-receives", str(p)]), 1)
            self.assertEqual(main(["--require-parallel-reads", str(p)]), 1)
            self.assertEqual(main(["--min-admitted", "1", str(p)]), 0)


if __name__ == "__main__":
    unittest.main()
