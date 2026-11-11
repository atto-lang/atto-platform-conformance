#!/usr/bin/env python3
"""Source-free frozen Git-tree metadata audit. Never certifies guest compilation.

No network, checkout of backend source, or transfer of private Git trees.
"""
import copy
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "five-backend-shared-contract-shas-20261111.json"
SHA1 = re.compile(r"^[0-9a-f]{40}$")
BACKENDS = ("java", "llvm", "wasm", "net", "forge")
EXPECTED_HEADS = {
    "java": "6d8eb70048eafc9a84c5aebe9c1bb06104f16e76",
    "llvm": "0ee037ca3e5dd9ac6ac1e9cc3d40f19ee6326a9c",
    "wasm": "2c6ce5988592080ea47b8877e2b8c1d3df5cb9bd",
    "net": "3f3606cc3ef81dad117047b4cb57609ad1a92672",
    "forge": "2acf59d589f8016f879581f17a27df144fa73075",
}
EXPECTED_CANDIDATES = {
    "wasm": ("269e215c8298c47ce5fbae9adb37f46bef4e6ee4",
             "contracts/v2/cpu-gpu-task-unsupported-v2.json",
             "067d557ac02b85a9f1ea44811bf106a1529926de"),
    "forge": ("68bb7bc0c7d236390f822a9e19cabdf355934974",
              "contracts/structural/v2/cases.json",
              "57c80adaa4029c6fd3e46a63c490cb193f951568"),
    "java": ("e593cbd7047ba2395e4b8c753e39392f04c20d70",
             "contracts/v1/scoped-permissions-v1.json",
             "f06c65d00c33b4339369a4a9235aab588bf4d935"),
}
EXPECTED_COUNTS = {
    "shared_at_least_two": 166,
    "equal_at_main": 155,
    "divergent_at_main": 11,
    "shared_all_five": 9,
    "equal_all_five": 8,
}

class InvalidLedger(ValueError):
    pass

def unique_fields(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise InvalidLedger("duplicate JSON object field: " + key)
        out[key] = value
    return out

def read_ledger(path):
    raw = path.read_bytes()
    if not raw or len(raw) > 128 * 1024:
        raise InvalidLedger("manifest absent or exceeds bounded read")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields,
                      parse_constant=lambda v: (_ for _ in ()).throw(
                          InvalidLedger("nonstandard JSON number: " + v)))

def sha(value):
    return isinstance(value, str) and SHA1.fullmatch(value) is not None

def require(condition, message):
    if not condition:
        raise InvalidLedger(message)

def verify(data):
    require(type(data) is dict, "manifest must be an object")
    require(set(data) == {
        "schema", "as_of", "scope", "backends", "summary", "shared",
        "findings", "proposed_candidate_heads", "candidate_status",
        "compiler_guest_execution_verified", "toolchain_aot_execution_verified"
    }, "unknown or missing manifest fields")
    require(data["schema"] == "oreslang.five-source-shared-contract-metadata.v1",
            "unrecognized schema")
    require(data["as_of"] == "2026-11-11", "snapshot date changed")
    require(data["scope"] == "immutable-git-blob-metadata-only-not-guest-execution",
            "data cannot impersonate executed parity")
    require(data["candidate_status"] == "draft-pr-unmerged",
            "unmerged candidate falsely promoted")
    require(data["compiler_guest_execution_verified"] is False
            and data["toolchain_aot_execution_verified"] is False,
            "metadata ledger cannot certify guest/AOT execution")
    backends = data["backends"]
    require(type(backends) is dict and set(backends) == set(BACKENDS),
            "wrong five compiler identities")
    for backend in BACKENDS:
        info = backends[backend]
        require(type(info) is dict and set(info) == {"repo", "head", "tree"},
                "invalid backend metadata")
        require(info["repo"] == "ores-truffle-oreslang/oreslang-source." + backend
                and info["head"] == EXPECTED_HEADS[backend]
                and sha(info["tree"]), "stale or foreign compiler head")

    rows = data["shared"]
    require(type(rows) is list and len(rows) == 166, "missing shared contracts")
    paths, drift = [], {}
    all_five, equal_all_five, equal = 0, 0, 0
    by_path = {}
    for row in rows:
        require(type(row) is dict and set(row) == {"path", "blobs"},
                "invalid shared row shape")
        path, blobs = row["path"], row["blobs"]
        require(type(path) is str and path.startswith("contracts/")
                and ".." not in path.split("/") and "\\" not in path
                and all(segment not in ("", ".", "..") for segment in path.split("/")),
                "invalid contract path")
        require(type(blobs) is dict and 2 <= len(blobs) <= 5
                and set(blobs).issubset(BACKENDS)
                and all(sha(value) for value in blobs.values()),
                "invalid Git blob metadata")
        paths.append(path)
        by_path[path] = blobs
        unique = set(blobs.values())
        if len(unique) == 1:
            equal += 1
        else:
            drift[path] = blobs
        if len(blobs) == 5:
            all_five += 1
            if len(unique) == 1:
                equal_all_five += 1
    require(paths == sorted(set(paths)), "duplicate or noncanonical path inventory")
    counts = {
        "shared_at_least_two": len(rows),
        "equal_at_main": equal,
        "divergent_at_main": len(drift),
        "shared_all_five": all_five,
        "equal_all_five": equal_all_five,
    }
    require(counts == EXPECTED_COUNTS == data["summary"],
            "pinned coverage or divergence totals changed")

    findings = data["findings"]
    require(type(findings) is list and len(findings) == len(drift),
            "unexplained divergent contract")
    seen = set()
    for f in findings:
        require(type(f) is dict and set(f) == {"path", "category", "draft_pr"},
                "invalid drift classification")
        path = f["path"]
        require(path in drift and path not in seen, "missing/duplicate drift")
        seen.add(path)
        require(type(f["category"]) is str and 4 <= len(f["category"]) <= 90
                and f["category"].replace("-", "").isalnum(),
                "invalid classification")
        proposal = f["draft_pr"]
        require(proposal is None or (
            type(proposal) is str
            and proposal.startswith("https://github.com/ores-truffle-oreslang/")
            and "/pull/" in proposal), "invalid proposal link")
    require(seen == set(drift), "drift inventory differs from findings")

    candidates = data["proposed_candidate_heads"]
    require(type(candidates) is dict and set(candidates) == set(EXPECTED_CANDIDATES),
            "missing or extra unmerged proposals")
    proposed = copy.deepcopy(by_path)
    for backend, expected in EXPECTED_CANDIDATES.items():
        item = candidates[backend]
        require(type(item) is dict and set(item) == {"head", "path", "blob_sha"},
                "candidate fields invalid")
        require((item["head"], item["path"], item["blob_sha"]) == expected,
                "candidate SHA/path is not pinned to proposed PR")
        path = item["path"]
        require(path in proposed and backend in proposed[path]
                and path in drift and item["blob_sha"] != proposed[path][backend],
                "candidate does not repair a recorded mismatch")
        other_hashes = {v for b, v in proposed[path].items() if b != backend}
        require(other_hashes == {item["blob_sha"]},
                "candidate does not converge other backend Git blobs")
        proposed[path][backend] = item["blob_sha"]
    remaining = sum(len(set(blobs.values())) > 1 for blobs in proposed.values())
    require(remaining == 8, "three proposed exact-hash repairs do not converge")
    return counts, remaining

def self_test(data):
    mutants = []
    one = copy.deepcopy(data)
    one["compiler_guest_execution_verified"] = True
    mutants.append(one)
    one = copy.deepcopy(data)
    one["summary"]["divergent_at_main"] = 0
    mutants.append(one)
    one = copy.deepcopy(data)
    one["shared"].pop()
    mutants.append(one)
    one = copy.deepcopy(data)
    one["shared"][0]["blobs"]["llvm"] = "f" * 40
    mutants.append(one)
    one = copy.deepcopy(data)
    one["proposed_candidate_heads"]["wasm"]["blob_sha"] = "a" * 40
    mutants.append(one)
    one = copy.deepcopy(data)
    one["candidate_status"] = "merged-and-certified"
    mutants.append(one)
    for mutant in mutants:
        try:
            verify(mutant)
        except InvalidLedger:
            continue
        raise InvalidLedger("source-free adversarial ledger mutation passed")

def main(argv):
    if argv not in ([], ["--self-test"]):
        print("usage: check_five_backend_shared_contract_shas.py [--self-test]",
              file=sys.stderr)
        return 2
    try:
        ledger = read_ledger(MANIFEST)
        counts, projected = verify(ledger)
        if argv:
            self_test(ledger)
    except (OSError, ValueError, UnicodeError, TypeError) as error:
        print("FIVE_BACKEND_SOURCE_METADATA_FAILED: " + str(error), file=sys.stderr)
        return 1
    print("FIVE_BACKEND_SOURCE_METADATA_VALIDATED=" + str(counts)
          + " proposed_remaining_divergent=" + str(projected))
    print("HOST_METADATA_ONLY; NO ACTUAL COMPILER/VM/AOT GUEST EXECUTION CERTIFIED")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
