#!/usr/bin/env python3
"""Source-only AttoLang lifetime oracle. NOT a compiler or guest execution."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts/effects-lifetimes-v1/contract.json"
DIAGNOSTICS = {"move_while_borrowed", "incompatible_borrow", "borrow_across_suspension"}

def git_blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def evaluate(events):
    """Minimal linear NLL oracle; compiler must independently prove CFG joins."""
    last = {e["loan"]: i for i,e in enumerate(events) if e["op"] == "use"}
    live = {}
    moved = set()
    for i, e in enumerate(events):
        live = {name: loan for name, loan in live.items() if last.get(name, -1) >= i}
        kind = e["op"]
        if kind == "borrow":
            place, mode, name = e["place"], e["mode"], e["loan"]
            if mode not in {"read", "write"} or name in live or place in moved:
                return "incompatible_borrow"
            overlaps = [loan for loan in live.values() if loan[0] == place]
            if overlaps and (mode == "write" or any(x[1] == "write" for x in overlaps)):
                return "incompatible_borrow"
            live[name] = (place, mode)
        elif kind == "move":
            place = e["place"]
            if any(x[0] == place for x in live.values()):
                return "move_while_borrowed"
            if place in moved:
                return "move_while_borrowed"
            moved.add(place)
        elif kind == "await":
            if live:
                return "borrow_across_suspension"
        elif kind == "use":
            if e["loan"] not in live:
                return "incompatible_borrow"
        else:
            raise AssertionError("unrecognized model operation")
    return "accept"


def verify_llvm_observation(observation, candidate_contract):
    """Never upgrade an unrelated parser rejection to lifetime/effect proof."""
    def require(ok, reason):
        if not ok:
            raise ValueError("invalid LLVM effect/lifetime observation: " + reason)
    require(observation.get("schema") == "atto-effects-lifetimes-llvm-observation-v1", "schema")
    require(observation.get("status") == "EXECUTED_COMPILER_FEATURES_NOT_VERIFIED", "status")
    require(observation.get("evidence_tier") == "COMPILER_EXECUTED_GUEST_TASK_SUBSET_ONLY", "scope")
    source = observation.get("source", {})
    mirror = observation.get("mirror", {})
    require(source.get("tree") and source.get("tree") == mirror.get("snapshot_tree"), "source tree")
    require(isinstance(mirror.get("run_id"), int) and mirror["run_id"] > 0, "run id")
    require(isinstance(mirror.get("job_id"), int) and mirror["job_id"] > 0, "job id")
    rows = observation.get("candidate_fixture_evidence", [])
    cases = candidate_contract["cases"]
    require(isinstance(rows, list) and len(rows) == len(cases), "case count")
    by_id = {row.get("id"): row for row in rows}
    require(len(by_id) == len(cases), "duplicate case")
    for case in cases:
        row = by_id.get(case["id"])
        require(isinstance(row, dict), "missing " + case["id"])
        require(row.get("fixture_git_blob") == case["blob_sha"], "blob " + case["id"])
        require(row.get("result") == "NOT_VERIFIED", "false promotion " + case["id"])
        require(isinstance(row.get("compiler_exit"), int) and row["compiler_exit"] != 0,
                "false execution " + case["id"])
        require(isinstance(row.get("observed"), str) and bool(row["observed"].strip()),
                "missing diagnostic " + case["id"])
        if case["kind"] == "compile_reject":
            require(row.get("expected_diagnostic") == case["diagnostic"],
                    "target mismatch " + case["id"])
            require(case["diagnostic"] not in row["observed"],
                    "unexpected target diagnostic requires independent guest verification")
        else:
            require(row.get("expected_result") == "compiled guest exit 42",
                    "positive oracle mismatch")
    return len(rows)

def verify(data=None, root=ROOT):
    if data is None:
        data = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert data["schema_version"] == 1
    assert data["contract_id"] == "attolang-effects-lifetimes-v1"
    assert data["status"] == "CANDIDATE_NOT_EXECUTED"
    assert data["source_policy"]["canonical_extension"] == ".atto"
    assert data["backends"] == ["java","llvm","dotnet","wasm","forge","cranelift"]
    assert data["evidence"]["baseline"] == "NOT_EXECUTED"
    assert data["evidence"]["source_only_is_guest"] is False
    assert "runner_id" in data["evidence"]["mandatory"]
    assert "nonzero_executed_steps" in data["evidence"]["mandatory"]
    assert "generic_parse_failure" in data["evidence"]["never_passing"]
    ids = [x["id"] for x in data["cases"]]
    assert len(ids) == 4 and len(set(ids)) == len(ids)
    for case in data["cases"]:
        assert case["path"] == f'contracts/effects-lifetimes-v1/fixtures/{case["id"]}.atto'
        assert case["status"] == "AUTHORED_NOT_EXECUTED"
        blob = (root / case["path"]).read_bytes()
        assert git_blob_sha(blob) == case["blob_sha"], case["id"] + " fixture blob mismatch"
        assert blob.endswith(b"\n")
        assert b"rt borrow owner" in blob
        outcome = evaluate(case["trace"])
        if case["kind"] == "compile_reject":
            assert case["expected_exit"] is None
            assert case["diagnostic"] in DIAGNOSTICS
            assert outcome == case["diagnostic"], (case["id"], outcome)
        else:
            assert case["kind"] == "compile_and_execute" and case["expected_exit"] == 42
            assert case["diagnostic"] is None and outcome == "accept"
    return len(data["cases"])

if __name__ == "__main__":
    print(f"validated {verify()} source-only effects/lifetimes candidates; guest status NOT_EXECUTED")
