#!/usr/bin/env python3
"""Verify a downloaded 47x3 persistent-actor source-free Actions receipt.

All run, artifact, tree, backend-head and Git-blob identities must be pinned
independently from GitHub metadata. This verifies receipt integrity only; it
never certifies native compilers, guest execution, or source-export authority.
"""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_ZIP = 64 * 1024
MAX_JSON = 32 * 1024
REPOSITORY = "scintilla-run-test/gleam-runner-conformance"
SCHEMA = "oreslang.source_free_persistent_actor_policy_47.v1"
MEMBER = "persistent-actor-sourcefree-47.json"
BACKENDS = ("java", "llvm", "net", "wasm", "forge")
BLOB_PATHS = (
    "contracts/v1/persistent_actor_data_v1.json",
    "scripts/verify_persistent_actor_data_contract.py",
    "scripts/test_persistent_actor_data_contract.py",
)


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

    def invalid_constant(_value):
        raise ReceiptDenied("nonstandard JSON number")

    def bounded_integer(value):
        if len(value) > 20:
            raise ReceiptDenied("oversized JSON integer")
        return int(value)

    def finite_float(value):
        if len(value) > 128:
            raise ReceiptDenied("oversized floating-point token")
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ReceiptDenied("nonfinite floating-point token")
        return parsed

    try:
        obj = json.loads(raw.decode("utf-8", errors="strict"),
                         object_pairs_hook=unique,
                         parse_constant=invalid_constant,
                         parse_int=bounded_integer,
                         parse_float=finite_float)
    except ReceiptDenied:
        raise
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ReceiptDenied("invalid UTF-8 JSON receipt") from exc
    if type(obj) is not dict:
        raise ReceiptDenied("report root must be object")
    return obj


def read_pinned_member(zip_path, expected_zip_sha256, member=MEMBER):
    exact_sha(expected_zip_sha256, SHA256, "artifact ZIP digest")
    if type(member) is not str or member != MEMBER:
        raise ReceiptDenied("unexpected persistent-actor receipt member")
    path = Path(zip_path)
    try:
        before = path.lstat()
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or not 0 < before.st_size <= MAX_ZIP):
            raise ReceiptDenied("unsafe or oversized artifact file")
        nofollow = getattr(os, "O_NOFOLLOW", None)
        if type(nofollow) is not int or nofollow <= 0:
            raise ReceiptDenied("secure O_NOFOLLOW unavailable")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | nofollow)
        with os.fdopen(fd, "rb") as stream:
            opened = os.fstat(stream.fileno())
            identity = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns)
            if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                    or identity != (before.st_dev, before.st_ino,
                                    before.st_size, before.st_mtime_ns)):
                raise ReceiptDenied("artifact was replaced before read")
            data = stream.read(MAX_ZIP + 1)
            after = os.fstat(stream.fileno())
            if identity != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise ReceiptDenied("artifact mutated during read")
        post = path.lstat()
        if identity != (post.st_dev, post.st_ino, post.st_size, post.st_mtime_ns):
            raise ReceiptDenied("artifact path was swapped")
    except OSError as exc:
        raise ReceiptDenied("artifact cannot be read securely") from exc
    if len(data) != before.st_size or len(data) > MAX_ZIP:
        raise ReceiptDenied("artifact length changed or exceeded budget")
    if hashlib.sha256(data).hexdigest() != expected_zip_sha256:
        raise ReceiptDenied("ZIP digest mismatches independently pinned GitHub artifact")
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].filename != member:
                raise ReceiptDenied("archive does not contain exactly the reviewed JSON member")
            info = members[0]
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise ReceiptDenied("unsafe ZIP member type")
            if not 0 < info.file_size <= MAX_JSON:
                raise ReceiptDenied("ZIP member empty or decompression budget exceeded")
            with archive.open(info, "r") as stream:
                raw = stream.read(MAX_JSON + 1)
            if len(raw) != info.file_size:
                raise ReceiptDenied("ZIP payload length inconsistent")
    except ReceiptDenied:
        raise
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError,
            NotImplementedError, ValueError) as exc:
        raise ReceiptDenied("invalid or damaged ZIP archive") from exc
    return decode_unique(raw)


def verify_persistent_actor_zip(
        zip_path, *, expected_zip_sha256, expected_head_sha, expected_tree_sha,
        expected_run_id, expected_attempt, expected_backend_heads,
        expected_blobs, member=MEMBER):
    exact_sha(expected_head_sha, SHA1, "carrier HEAD")
    exact_sha(expected_tree_sha, SHA1, "carrier tree")
    exact_positive(expected_run_id, "run ID")
    exact_positive(expected_attempt, "attempt")
    if type(expected_backend_heads) is not dict or set(expected_backend_heads) != set(BACKENDS):
        raise ReceiptDenied("all five independently pinned backend heads required")
    for backend in BACKENDS:
        exact_sha(expected_backend_heads[backend], SHA1, backend + " backend HEAD")
    if type(expected_blobs) is not dict or tuple(sorted(expected_blobs)) != tuple(sorted(BLOB_PATHS)):
        raise ReceiptDenied("all three independently pinned persistent-data blobs required")
    for path in BLOB_PATHS:
        exact_sha(expected_blobs[path], SHA1, path)

    record = read_pinned_member(zip_path, expected_zip_sha256, member)
    required = {
        "backend_heads", "carrier_commit", "carrier_tree", "classification",
        "guest_runtime_certified", "matched_backends", "native_backend_certified",
        "private_source_export_authorized", "repository", "run_attempt", "run_id",
        "schema", "source_free_blobs", "source_runtime_or_compiler_transferred",
        "test_results",
    }
    if set(record) != required:
        raise ReceiptDenied("missing or unexpected receipt fields")
    if (record["carrier_commit"] != expected_head_sha
            or record["carrier_tree"] != expected_tree_sha
            or record["run_id"] != expected_run_id or type(record["run_id"]) is not int
            or record["run_attempt"] != expected_attempt
            or type(record["run_attempt"]) is not int
            or record["schema"] != SCHEMA):
        raise ReceiptDenied("receipt does not match reviewed run/tree/schema")
    if record["repository"] != REPOSITORY:
        raise ReceiptDenied("unexpected carrier identity")
    if record["classification"] != "SOURCE_FREE_CONTRACT_ONLY_NOT_GUEST_RUNTIME":
        raise ReceiptDenied("receipt classification changed")
    if (record["guest_runtime_certified"] is not False
            or record["native_backend_certified"] is not False
            or record["private_source_export_authorized"] is not False
            or record["source_runtime_or_compiler_transferred"] is not False):
        raise ReceiptDenied("invalid native/runtime/privacy claim")
    if record["matched_backends"] != 5 or type(record["matched_backends"]) is not int:
        raise ReceiptDenied("receipt must bind exactly five backends")
    if record["backend_heads"] != expected_backend_heads:
        raise ReceiptDenied("backend head identity mismatch")
    if record["source_free_blobs"] != expected_blobs:
        raise ReceiptDenied("persistent-data source-free blob identity mismatch")
    if record["test_results"] != {"round_counts": [47, 47, 47], "executed_total": 141}:
        raise ReceiptDenied("receipt does not prove the exact 47x3 test inventory")
    return {
        "status": "PERSISTENT_ACTOR_SOURCE_FREE_RECEIPT_INTEGRITY_VERIFIED",
        "run_id": expected_run_id,
        "attempt": expected_attempt,
        "tests_reported": 141,
        "backend_heads_verified": 5,
        "actual_job_execution_independently_verified": False,
        "native_compiler_executed": False,
        "guest_runtime_certified": False,
        "five_backend_parity_certified": False,
        "private_source_export_authorized": False,
        "release_certified": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True)
    parser.add_argument("--zip-sha256", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--tree", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--attempt", type=int, required=True)
    for backend in BACKENDS:
        parser.add_argument("--" + backend + "-head", required=True)
    parser.add_argument("--contract-blob", required=True)
    parser.add_argument("--verifier-blob", required=True)
    parser.add_argument("--tests-blob", required=True)
    try:
        result = verify_persistent_actor_zip(
            parser.parse_args(argv).zip,
            expected_zip_sha256=parser.parse_args(argv).zip_sha256,
            expected_head_sha=parser.parse_args(argv).head,
            expected_tree_sha=parser.parse_args(argv).tree,
            expected_run_id=parser.parse_args(argv).run_id,
            expected_attempt=parser.parse_args(argv).attempt,
            expected_backend_heads={
                backend: getattr(parser.parse_args(argv), backend + "_head")
                for backend in BACKENDS
            },
            expected_blobs={
                BLOB_PATHS[0]: parser.parse_args(argv).contract_blob,
                BLOB_PATHS[1]: parser.parse_args(argv).verifier_blob,
                BLOB_PATHS[2]: parser.parse_args(argv).tests_blob,
            })
    except ReceiptDenied as exc:
        print("PERSISTENT_ACTOR_RECEIPT_REJECTED: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
