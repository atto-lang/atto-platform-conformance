#!/usr/bin/env python3
"""Verify a downloaded source-free Oreslang CI receipt (not native or guest parity).

Inputs MUST be pinned independently from the Actions run/job/artifact API and
reviewed Git metadata. A self-asserted receipt is never a CI attestation.
"""
import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
import zipfile
from pathlib import Path

SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_ZIP = 64 * 1024
MAX_JSON = 32 * 1024
EXPECTED_BLOBS = frozenset({
    ".github/workflows/ci-run-evidence-contract.yml",
    "scripts/verify_ci_run.py",
    "scripts/test_verify_ci_run.py",
})


class ReceiptDenied(ValueError):
    pass


def exact_positive(value, name):
    if type(value) is not int or value <= 0:
        raise ReceiptDenied(f"{name} must be a positive integer")
    return value


def exact_sha(value, regex, name):
    if type(value) is not str or regex.fullmatch(value) is None:
        raise ReceiptDenied(f"{name} must be a lowercase full-length digest")
    return value


def decode_unique(raw):
    if not raw or len(raw) > MAX_JSON:
        raise ReceiptDenied("missing or oversized JSON report")

    def unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ReceiptDenied("ambiguous duplicate JSON field")
            obj[key] = value
        return obj

    def invalid_constant(s):
        raise ReceiptDenied("nonstandard JSON number")

    def bounded_integer(s):
        if len(s) > 20:
            raise ReceiptDenied("oversized JSON integer")
        return int(s)

    def finite_float(s):
        if len(s) > 128:
            raise ReceiptDenied("oversized floating-point token")
        value = float(s)
        if not math.isfinite(value):
            raise ReceiptDenied("nonfinite floating-point token")
        return value

    try:
        obj = json.loads(raw.decode("utf-8", errors="strict"),
                         object_pairs_hook=unique, parse_constant=invalid_constant,
                         parse_int=bounded_integer, parse_float=finite_float)
    except ReceiptDenied:
        raise
    except (ValueError, UnicodeError, RecursionError) as err:
        raise ReceiptDenied("invalid UTF-8 JSON receipt") from err
    if type(obj) is not dict:
        raise ReceiptDenied("report root must be object")
    return obj


def verify_zip(zip_path, *, expected_zip_sha256, expected_head_sha,
               expected_tree_sha, expected_run_id, expected_attempt,
               expected_schema, expected_blobs, min_tests_per_round,
               min_rounds, member="77-parity.json"):
    exact_sha(expected_zip_sha256, SHA256, "artifact ZIP digest")
    exact_sha(expected_head_sha, SHA1, "carrier HEAD")
    exact_sha(expected_tree_sha, SHA1, "carrier tree")
    exact_positive(expected_run_id, "run ID")
    exact_positive(expected_attempt, "attempt")
    exact_positive(min_tests_per_round, "minimum tests/round")
    exact_positive(min_rounds, "minimum rounds")
    if (type(member) is not str or not re.fullmatch(r"[A-Za-z0-9_.-]+\.json", member)
            or len(member) > 100):
        raise ReceiptDenied("invalid exact receipt member")
    if (type(expected_blobs) is not dict or set(expected_blobs) != EXPECTED_BLOBS):
        raise ReceiptDenied("all three independently pinned source-free blobs required")
    for name, sha in expected_blobs.items():
        exact_sha(sha, SHA1, name)
    if type(expected_schema) is not str or not expected_schema:
        raise ReceiptDenied("schema must be independently pinned")

    path = Path(zip_path)
    try:
        before = path.lstat()
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or not 0 < before.st_size <= MAX_ZIP):
            raise ReceiptDenied("unsafe or oversized artifact file")
        # Reject symlink replacement of the final path between lstat and open.
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        nofollow = getattr(os, "O_NOFOLLOW", None)
        if type(nofollow) is not int or nofollow <= 0:
            raise ReceiptDenied("secure O_NOFOLLOW unavailable")
        fd = os.open(path, flags | nofollow)
        with os.fdopen(fd, "rb") as stream:
            opened = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
                raise ReceiptDenied("unsafe artifact after open")
            if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != (
                    before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
                raise ReceiptDenied("artifact was replaced before read")
            data = stream.read(MAX_ZIP + 1)
            after = os.fstat(stream.fileno())
            if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != (
                    opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns):
                raise ReceiptDenied("artifact mutated during read")
        post = path.lstat()
        if (post.st_dev, post.st_ino, post.st_size, post.st_mtime_ns) != (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns):
            raise ReceiptDenied("artifact path was swapped")
    except OSError as exc:
        raise ReceiptDenied("artifact cannot be read securely") from exc
    if len(data) != before.st_size or len(data) > MAX_ZIP:
        raise ReceiptDenied("artifact length changed or exceeded budget")
    if hashlib.sha256(data).hexdigest() != expected_zip_sha256:
        raise ReceiptDenied("ZIP digest mismatches independently pinned GitHub artifact")
    try:
        with zipfile.ZipFile(__import__("io").BytesIO(data), "r") as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].filename != member:
                raise ReceiptDenied("archive does not contain exactly the reviewed JSON member")
            info = members[0]
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise ReceiptDenied("unsafe ZIP member type")
            if not 0 < info.file_size <= MAX_JSON:
                raise ReceiptDenied("ZIP member empty or decompression budget exceeded")
            with archive.open(info, "r") as f:
                raw = f.read(MAX_JSON + 1)
            if len(raw) != info.file_size:
                raise ReceiptDenied("ZIP payload length inconsistent")
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, NotImplementedError, ValueError) as exc:
        raise ReceiptDenied("invalid or damaged ZIP archive") from exc

    record = decode_unique(raw)
    required = {"carrier_head_sha", "carrier_tree_sha", "expected_total", "git_blobs",
                "guest_runtime_certified", "private_runtime_or_compiler_source_transferred",
                "repository", "rounds", "run_attempt", "run_id", "schema",
                "source_free_only", "source_repository_native_ci_certified", "tests_per_round"}
    if set(record) != required:
        raise ReceiptDenied("missing or unexpected receipt fields")
    if (record["carrier_head_sha"] != expected_head_sha
            or record["carrier_tree_sha"] != expected_tree_sha
            or record["run_id"] != expected_run_id
            or type(record["run_id"]) is not int
            or record["run_attempt"] != expected_attempt
            or type(record["run_attempt"]) is not int
            or record["schema"] != expected_schema):
        raise ReceiptDenied("report does not match independently reviewed run/tree/schema")
    if (record["source_free_only"] is not True
            or record["guest_runtime_certified"] is not False
            or record["source_repository_native_ci_certified"] is not False
            or record["private_runtime_or_compiler_source_transferred"] is not False):
        raise ReceiptDenied("invalid source-free / native / privacy claims")
    if record["repository"] != "scintilla-run-test/gleam-runner-conformance":
        raise ReceiptDenied("unexpected carrier identity")
    rounds = exact_positive(record["rounds"], "reported rounds")
    per_round = exact_positive(record["tests_per_round"], "reported tests/round")
    if (rounds < min_rounds or per_round < min_tests_per_round
            or type(record["expected_total"]) is not int
            or record["expected_total"] != rounds * per_round):
        raise ReceiptDenied("receipt does not substantiate requested test inventory")
    if type(record["git_blobs"]) is not dict or record["git_blobs"] != expected_blobs:
        raise ReceiptDenied("source-free verifier/test/workflow blob identity mismatch")
    return {"status": "SOURCE_FREE_RECEIPT_INTEGRITY_VERIFIED",
            "run_id": expected_run_id, "attempt": expected_attempt,
            "rounds_reported": rounds, "tests_per_round_reported": per_round,
            "tests_reported": rounds * per_round,
            "actual_job_execution_independently_verified": False,
            "native_compiler_executed": False,
            "guest_runtime_certified": False,
            "five_backend_parity_certified": False,
            "release_certified": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("zip", "zip-sha256", "head", "tree", "schema", "workflow-blob",
                "verifier-blob", "tests-blob", "member"):
        parser.add_argument("--" + key, required=(key != "member"))
    for key in ("run-id", "attempt", "min-tests-per-round", "min-rounds"):
        parser.add_argument("--" + key, type=int, required=True)
    a = parser.parse_args(argv)
    try:
        result = verify_zip(a.zip, expected_zip_sha256=a.zip_sha256,
                            expected_head_sha=a.head, expected_tree_sha=a.tree,
                            expected_run_id=a.run_id, expected_attempt=a.attempt,
                            expected_schema=a.schema,
                            expected_blobs={
                                ".github/workflows/ci-run-evidence-contract.yml": a.workflow_blob,
                                "scripts/verify_ci_run.py": a.verifier_blob,
                                "scripts/test_verify_ci_run.py": a.tests_blob},
                            min_tests_per_round=a.min_tests_per_round,
                            min_rounds=a.min_rounds,
                            member=a.member or "77-parity.json")
    except ReceiptDenied as exc:
        print("SOURCE_FREE_RECEIPT_REJECTED: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
