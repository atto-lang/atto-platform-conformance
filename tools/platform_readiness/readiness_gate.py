#!/usr/bin/env python3
"""Source-free advisory gate. NEVER authenticates, merges, releases or exports source."""
import argparse
import hashlib
import json
import math
import re
import sys
from datetime import date
from pathlib import Path

BACKENDS = {"java", "llvm", "wasm", "forge", "net"}
OID = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
HOUSEKEEPING = {"Set up job", "Complete job"}
MAX_BYTES = 1048576

class InvalidEvidence(ValueError):
    pass

def need(ok, message):
    if not ok:
        raise InvalidEvidence(message)

def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "duplicate JSON key")
        result[key] = value
    return result

def bad_constant(_):
    raise InvalidEvidence("nonfinite JSON constant")

def finite_number(value):
    parsed = float(value)
    need(math.isfinite(parsed), "nonfinite JSON number")
    return parsed

def no_surrogates(value):
    if isinstance(value, str):
        need(not any(0xd800 <= ord(ch) <= 0xdfff for ch in value), "invalid Unicode scalar")
    elif type(value) is list:
        for member in value:
            no_surrogates(member)
    elif type(value) is dict:
        for key, member in value.items():
            no_surrogates(key)
            no_surrogates(member)

def read_snapshot(path):
    with open(path, "rb") as handle:
        data = handle.read(MAX_BYTES + 1)
    need(len(data) <= MAX_BYTES, "input too large")
    try:
        payload = json.loads(data.decode("utf-8", "strict"),
                             object_pairs_hook=object_pairs,
                             parse_constant=bad_constant,
                             parse_float=finite_number)
    except (ValueError, UnicodeError, OverflowError) as err:
        raise InvalidEvidence("invalid JSON evidence") from err
    no_surrogates(payload)
    return payload, hashlib.sha256(data).hexdigest()

def obj(value, keys):
    need(type(value) is dict and set(value) == set(keys), "missing or unexpected fields")

def oid(value):
    return type(value) is str and OID.fullmatch(value) is not None

def positive_int(value):
    return type(value) is int and value > 0

def job_findings(job, head):
    obj(job, {"head_sha","run_id","run_attempt","job_id","status","conclusion","steps"})
    need(oid(job["head_sha"]), "invalid job source SHA")
    need(positive_int(job["run_id"]) and positive_int(job["job_id"]), "invalid CI ID")
    need(job["run_attempt"] is None or positive_int(job["run_attempt"]), "invalid attempt")
    need(type(job["steps"]) is list and len(job["steps"]) <= 200, "invalid steps")
    findings = []
    if job["head_sha"] != head:
        findings.append("HEAD_MISMATCH")
    if job["run_attempt"] is None:
        findings.append("RUN_ATTEMPT_UNVERIFIED")
    if job["status"] != "completed" or job["conclusion"] != "success":
        findings.append("CI_NOT_SUCCESSFUL")
    if not job["steps"]:
        findings.append("NO_EXECUTED_STEPS")
    executed_test = False
    for step in job["steps"]:
        obj(step, {"name","status","conclusion"})
        need(type(step["name"]) is str and 1 <= len(step["name"]) <= 256, "invalid step name")
        if step["status"] != "completed" or step["conclusion"] != "success":
            findings.append("STEP_NOT_SUCCESSFUL")
        if step["name"] not in HOUSEKEEPING:
            executed_test = True
    if job["steps"] and not executed_test:
        findings.append("NO_TEST_STEP_EVIDENCE")
    return sorted(set(findings))

def evaluate(s):
    obj(s, {"schema","snapshot_date","source_organization","protection","security","pull_requests","backends"})
    need(s["schema"] == "atto.platform.readiness.v1", "invalid schema")
    need(type(s["snapshot_date"]) is str, "invalid date")
    try:
        need(date.fromisoformat(s["snapshot_date"]).isoformat() == s["snapshot_date"], "invalid date")
    except ValueError as err:
        raise InvalidEvidence("invalid calendar date") from err
    need(s["source_organization"] == "ores-truffle-oreslang", "wrong organization")
    obj(s["protection"], {"main_protection_verified","independent_review_enforced"})
    need(all(type(v) is bool for v in s["protection"].values()), "invalid protection flags")
    obj(s["security"], {"cross_org_export_requested","open_export_incidents"})
    need(type(s["security"]["cross_org_export_requested"]) is bool, "invalid export flag")
    incidents = s["security"]["open_export_incidents"]
    need(type(incidents) is list and len(incidents) <= 100 and
         all(type(i) is str and 1 <= len(i) <= 100 for i in incidents), "invalid incident list")
    prs = s["pull_requests"]
    need(type(prs) is list and 1 <= len(prs) <= 25, "invalid PR inventory")
    seen = set()
    results = []
    for pr in prs:
        obj(pr, {"repository","number","head_sha","author","draft","mergeable","approvals","ci_job"})
        need(type(pr["repository"]) is str and
             re.fullmatch(r"ores-truffle-oreslang/[A-Za-z0-9_.-]+", pr["repository"]) is not None, "invalid repo")
        need(positive_int(pr["number"]) and oid(pr["head_sha"]), "invalid PR identity")
        need(type(pr["author"]) is str and pr["author"] and len(pr["author"]) <= 128, "invalid PR author")
        need(type(pr["draft"]) is bool and type(pr["mergeable"]) is bool, "invalid PR state")
        need(type(pr["approvals"]) is list and len(pr["approvals"]) <= 100 and
             all(type(a) is str and 1 <= len(a) <= 128 for a in pr["approvals"]), "invalid approvals")
        key = (pr["repository"], pr["number"])
        need(key not in seen, "duplicate PR")
        seen.add(key)
        reasons = []
        if pr["draft"]:
            reasons.append("DRAFT")
        if not pr["mergeable"]:
            reasons.append("CONFLICT")
        if not s["protection"]["main_protection_verified"]:
            reasons.append("PROTECTION_UNVERIFIED")
        if not s["protection"]["independent_review_enforced"]:
            reasons.append("REVIEW_ENFORCEMENT_UNVERIFIED")
        if not {x.casefold() for x in pr["approvals"] if x.casefold()!=pr["author"].casefold()}:
            reasons.append("NO_INDEPENDENT_REVIEW")
        reasons.extend(job_findings(pr["ci_job"], pr["head_sha"]))
        results.append({"repository":pr["repository"],"number":pr["number"],"head_sha":pr["head_sha"],
                        "state":"BLOCKED" if reasons else "REQUIRES_LIVE_ATTESTATION",
                        "findings":sorted(set(reasons))})
    need(type(s["backends"]) is dict and set(s["backends"]) == BACKENDS, "incomplete five-backend inventory")
    backend_results = {}
    for name in sorted(BACKENDS):
        b = s["backends"][name]
        obj(b, {"guest_execution","source_sha","artifact_sha256","compiler_executed",
                "guest_executed","verified_output","source_ci_job"})
        need(b["guest_execution"] in ("EXECUTED","NOT_EXECUTED"), "invalid execution status")
        need(b["source_sha"] is None or oid(b["source_sha"]), "invalid backend SHA")
        need(b["artifact_sha256"] is None or
             (type(b["artifact_sha256"]) is str and DIGEST.fullmatch(b["artifact_sha256"])), "invalid artifact SHA")
        need(all(type(b[x]) is bool for x in ("compiler_executed","guest_executed","verified_output")), "invalid guest flags")
        failures = []
        if b["guest_execution"] != "EXECUTED" or not b["compiler_executed"] or not b["guest_executed"]:
            failures.append("COMPILED_GUEST_NOT_EXECUTED")
        if not b["verified_output"]:
            failures.append("GUEST_OUTPUT_NOT_VERIFIED")
        if b["source_sha"] is None or b["artifact_sha256"] is None:
            failures.append("SOURCE_OR_ARTIFACT_NOT_PINNED")
        if b["source_ci_job"] is None:
            failures.append("SOURCE_CI_RECEIPT_MISSING")
        else:
            failures.extend(job_findings(b["source_ci_job"], b["source_sha"] or "0"*40))
        backend_results[name] = sorted(set(failures))
    exports = []
    if s["security"]["cross_org_export_requested"]:
        if incidents:
            exports.append("OPEN_SECURITY_INCIDENT")
        exports.append("INDEPENDENT_EXPORT_AUTHORIZATION_REQUIRED")
    return {
        "schema":"atto.platform.readiness.result.v1",
        "merge_state":"BLOCKED" if any(x["findings"] for x in results) else "REQUIRES_LIVE_ATTESTATION",
        "release_state":"BLOCKED" if any(backend_results.values()) else "REQUIRES_LIVE_ATTESTATION",
        "export_state":"BLOCKED" if exports else "NO_EXPORT_REQUESTED",
        "export_findings":exports,"pull_requests":results,"backend_findings":backend_results,
        "limit":"OFFLINE_JSON_NEVER_AUTHORIZES_MERGE_RELEASE_OR_PRIVATE_SOURCE_EXPORT"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        snapshot, digest = read_snapshot(args.snapshot)
        report = evaluate(snapshot)
        report["input_sha256"] = digest
        encoded = json.dumps(report, sort_keys=True, indent=2)+"\n"
        if args.output:
            args.output.write_text(encoded, encoding="utf-8")
        else:
            print(encoded,end="")
        if "BLOCKED" in (report["merge_state"],report["release_state"],report["export_state"]):
            return 1
        # A synthetic all-green snapshot remains untrusted and exits nonzero.
        return 3
    except (InvalidEvidence, OSError, TypeError, OverflowError) as err:
        print("INVALID_EVIDENCE: "+str(err),file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
