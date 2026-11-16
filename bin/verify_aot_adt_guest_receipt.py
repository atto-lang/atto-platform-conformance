#!/usr/bin/env python3
"""Validate the structure of a target AOT guest receipt. NOT runner attestation."""
import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA = "atto.aot-adt-guest-receipt.v1"
HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")

class EvidenceError(ValueError):
    pass

def demand(value, reason):
    if not value:
        raise EvidenceError(reason)

def validate(contract, receipt):
    demand(isinstance(receipt, dict), "receipt is not an object")
    demand(receipt.get("schema") == SCHEMA, "wrong schema")
    target = receipt.get("target")
    demand(target in contract["backends"], "unknown backend target")
    demand(receipt.get("source_commit") == contract["source"]["commit"], "wrong fixture source commit")
    demand(receipt.get("source_root_tree") == contract["source"]["root_tree"], "wrong fixture source tree")
    demand(receipt.get("build_mode") == target, "target and AOT build mode differ")
    demand(receipt.get("runtime_atto_compiler") is False, "runtime Atto compiler forbidden")
    demand(receipt.get("runtime_jit_required") is False, "required runtime JIT forbidden")
    for key, regex in [("compiler_commit", HEX40), ("compiler_tree", HEX40), ("build_artifact_sha256", HEX64)]:
        demand(isinstance(receipt.get(key), str) and regex.fullmatch(receipt[key]), "bad " + key)
    demand(isinstance(receipt.get("toolchain"), str) and receipt["toolchain"].strip(), "missing toolchain")
    run = receipt.get("ci_run")
    demand(isinstance(run, dict), "missing GitHub run metadata")
    demand(isinstance(run.get("url"), str) and re.match(r"^https://github.com/[^/]+/[^/]+/actions/runs/\d+$", run["url"]), "invalid run URL")
    demand(type(run.get("job_id")) is int and run["job_id"] > 0, "missing job ID")
    demand(run.get("steps_executed") is True, "zero-step run is not evidence")
    demand(run.get("conclusion") == "success", "CI did not succeed")
    rows = receipt.get("cases")
    originals = {x["id"]: x for x in contract["cases"]}
    demand(isinstance(rows, list) and len(rows) == len(originals), "incomplete case count")
    demand(all(isinstance(x, dict) for x in rows), "case not a record")
    ids = [x.get("id") for x in rows]
    demand(len(set(ids)) == len(ids) and set(ids) == set(originals), "duplicate, missing or unexpected case ID")
    for row in rows:
        reference = originals[row["id"]]
        label = row["id"] + ": "
        demand(row.get("git_blob_sha") == reference["git_blob_sha"], label + "wrong source blob")
        if reference.get("expectation_scope") == "rust-candidate-only" and target != "rust-wasm-precompiled":
            demand(row.get("status") == "NOT_APPLICABLE", label + "candidate-specific rejection is not portable")
            demand(row.get("compile_invoked") is False, label + "candidate-only source must not gate native support")
            demand(row.get("artifact_emitted") is False and row.get("guest_executed") is False,
                   label + "skipped candidate case must not claim execution")
            continue
        demand(row.get("compile_invoked") is True, label + "compiler did not run")
        if reference["kind"] == "pass":
            demand(row.get("compile_success") is True, label + "expected compilation success")
            demand(row.get("artifact_emitted") is True, label + "missing guest artifact")
            demand(row.get("guest_executed") is True, label + "guest not executed")
            demand(type(row.get("exit_code")) is int and row["exit_code"] == reference["expected_exit"], label + "wrong exit")
            demand(row.get("stdout") == reference["expected_stdout"], label + "wrong stdout")
        else:
            demand(row.get("compile_success") is False, label + "unsupported/invalid case accepted")
            demand(row.get("error_code") == reference["expected_error"], label + "wrong diagnostic")
            demand(row.get("artifact_emitted") is False, label + "invalid case emitted guest")
            demand(row.get("guest_executed") is False, label + "invalid case executed")
    return len(rows)

def main():
    parser = argparse.ArgumentParser(description="Structure-only receipt validator; never use as guest attestation")
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--contract", type=Path, default=Path(__file__).resolve().parents[1] / "contracts/aot-adt-guarded-guest-v1.json")
    args = parser.parse_args()
    try:
        n = validate(json.loads(args.contract.read_text()), json.loads(args.receipt.read_text()))
    except (EvidenceError, OSError, ValueError) as e:
        print("REJECTED: " + str(e), file=sys.stderr)
        return 1
    print(f"STRUCTURE_ONLY: {n} cases; independently inspect full compiler source, CI runner logs, native build and guest evidence")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
