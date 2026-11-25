#!/usr/bin/env python3
"""Structural validation only: does NOT authenticate CI or prove guest sandboxing."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "actor-tenant-conformance-v1.json"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ReceiptError(ValueError):
    pass


def require(ok, msg):
    if not ok:
        raise ReceiptError(msg)


def validate_manifest(manifest):
    require(manifest.get("schema") == "atto.actor-tenant-conformance.v1", "schema")
    cases = manifest.get("cases")
    require(isinstance(cases, list) and len(cases) >= 10, "cases")
    ids = [case.get("id") for case in cases]
    require(all(isinstance(value, str) and value for value in ids)
            and len(set(ids)) == len(ids), "duplicate-or-missing-case")
    require(set(manifest.get("backends", {})) >= {"java", "llvm", "wasm", "forge", "net"}, "backends")
    require(all(info.get("status") == "NOT_EXECUTED"
                for info in manifest["backends"].values()), "baseline-cannot-claim-execution")
    return {case["id"]: case for case in cases}


def validate_receipt(receipt, manifest):
    """Validate shape only. A receipt never independently authenticates GitHub."""
    cases = validate_manifest(manifest)
    require(isinstance(receipt, dict), "receipt-is-not-object")
    require(receipt.get("backend") in manifest["backends"], "unknown-backend")
    require(receipt.get("case_id") in cases, "unknown-case")
    status = receipt.get("status")
    require(status in {"passed", "failed", "unsupported", "not_executed"}, "unknown-status")
    if status in {"unsupported", "not_executed"}:
        require(isinstance(receipt.get("reason"), str)
                and bool(receipt["reason"].strip()), "missing-reason")
        require(receipt.get("guest_executed") is not True, "nonexecuted-claim")
        return
    if status == "failed":
        require(isinstance(receipt.get("reason"), str)
                and bool(receipt["reason"].strip()), "missing-failure-reason")
        return

    case = cases[receipt["case_id"]]
    compile_denial = case["kind"] == "compile-negative"
    sandbox_denial = receipt["case_id"] == "untrusted-tenant-missing-sandbox"
    admission_denial = compile_denial or sandbox_denial
    expected_kind = ("compiler-rejection" if compile_denial else
                     "sandbox-admission-rejection" if sandbox_denial else "compiled-guest")
    require(receipt.get("evidence_kind") == expected_kind, "wrong-evidence-class")
    # A compiler rejection and a deny-before-execution case MUST NOT claim that
    # a guest ran. A negative test still needs a real executed CI test step.
    require(receipt.get("guest_executed") is (not admission_denial),
            "guest-execution-misclassified")

    head = receipt.get("head_sha")
    require(isinstance(head, str) and SHA40.fullmatch(head), "invalid-head-sha")
    require(receipt.get("checked_out_sha") == head, "checkout-is-not-pr-head")
    tree = receipt.get("head_tree_sha")
    require(isinstance(tree, str) and SHA40.fullmatch(tree), "invalid-head-tree")
    require(isinstance(receipt.get("artifact_sha256"), str)
            and SHA256.fullmatch(receipt["artifact_sha256"]), "invalid-artifact-sha")
    for key in ("run_id", "run_attempt", "job_id"):
        require(type(receipt.get(key)) is int and receipt[key] > 0, "invalid-" + key)
    url = receipt.get("workflow_url")
    require(isinstance(url, str) and re.fullmatch(
        r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/([1-9][0-9]*)", url),
        "invalid-workflow-url")
    require(url.rsplit("/", 1)[-1] == str(receipt["run_id"]),
            "workflow-run-id-mismatch")
    command = receipt.get("command")
    require(isinstance(command, str) and bool(command.strip()), "missing-command")
    steps = receipt.get("steps")
    require(isinstance(steps, list) and len(steps) > 0, "zero-executed-steps")
    require(all(isinstance(step, dict) and
                isinstance(step.get("name"), str) and bool(step["name"].strip()) and
                step.get("status") == "completed" and
                step.get("conclusion") in {"success", "failure"} and
                isinstance(step.get("command"), str) and bool(step["command"].strip())
                for step in steps), "invalid-step-evidence")
    require(len({step["name"] for step in steps}) == len(steps),
            "ambiguous-step-names")
    require(any(step["conclusion"] == "success" and step["command"] == command
                for step in steps), "no-executed-matching-test-step")

    require(isinstance(receipt.get("observed"), str)
            and receipt["observed"] == case["expect"], "unexpected-outcome")
    require(type(receipt.get("exit_code")) is int, "missing-exit-code")
    if admission_denial:
        require(receipt["exit_code"] != 0, "denial-must-exit-nonzero")
    else:
        require(receipt["exit_code"] == 0, "guest-must-exit-successfully")
    if case["kind"].startswith("security-"):
        if sandbox_denial:
            require(receipt.get("boundary") == "none" and
                    receipt.get("enforcement_tested") is False,
                    "missing-sandbox-must-not-claim-enforcement")
        else:
            require(receipt.get("boundary") in
                    {"validated-wasm-isolate", "graal-isolate", "os-process",
                     "hardware-compartment"}, "no-identified-enforced-boundary")
            require(receipt.get("enforcement_tested") is True,
                    "sandbox-enforcement-not-tested")


def main(argv):
    if len(argv) not in (1, 2):
        print("usage: verify_actor_tenant_receipt.py [receipt.json]", file=sys.stderr)
        return 2
    manifest = json.loads(MANIFEST.read_text())
    try:
        validate_manifest(manifest)
        if len(argv) == 2:
            validate_receipt(json.loads(Path(argv[1]).read_text()), manifest)
    except (ReceiptError, json.JSONDecodeError, OSError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    print("VALID STRUCTURE ONLY; NOT VERIFIED GUEST PROVENANCE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
