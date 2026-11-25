#!/usr/bin/env python3
"""Source-free AttoLang unified effect reference oracle. Not a compiler proof."""
from collections import deque
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "contract.json"
STATUS = "SOURCE_FREE_MODEL_NOT_GUEST_EXECUTION"
PROFILES = {"general", "pure", "deterministic", "hard_rt"}
WORK = {"bounded", "unbounded", "unknown"}
CONTEXTS = {"ordinary", "critical_read", "critical_write"}
BACKENDS = {"java", "llvm", "net", "wasm", "forge", "rs", "cranelift", "js", "hdl", "atto", "realtime"}


class InvalidContract(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidContract(message)


def exact_keys(obj, keys, where):
    require(type(obj) is dict and set(obj) == set(keys), where + ": invalid fields")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key: " + key)
        result[key] = value
    return result


def load(path=CONTRACT):
    raw = Path(path).read_bytes()
    require(len(raw) <= 1024 * 1024, "contract too large")
    try:
        contract = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InvalidContract("invalid JSON") from exc
    validate(contract)
    return contract


def validate(contract):
    exact_keys(contract, {
        "schema_version", "contract_id", "status", "supersedes", "extends", "effect_names",
        "operations", "rules", "backends", "cases"
    }, "contract")
    require(type(contract["schema_version"]) is int and contract["schema_version"] == 2, "wrong version")
    require(contract["contract_id"] == "attolang-unified-effects-v2", "wrong contract")
    require(contract["status"] == STATUS and contract["supersedes"] is None, "status/supersession changed")
    require(contract["extends"] == "contracts/v1/function-effects-v1.json", "v1 compatibility")
    names = contract["effect_names"]
    require(type(names) is list and len(names) == len(set(names)), "duplicate effects")
    require(all(type(x) is str for x in names) and "nondet" in names and "alloc" in names
            and "state.write" in names and "spawns" in names, "required effects missing")
    require(set(contract["backends"]) == BACKENDS and
            all(value == "NOT_EXECUTED" for value in contract["backends"].values()), "fake backend evidence")
    require(type(contract["rules"]) is dict and contract["rules"]["declared"] == "upper_bound_not_authority"
            and contract["rules"]["work_bounded"] == "producer_claim_not_a_wcet_certificate", "unsafe semantics")
    ops = contract["operations"]
    require(type(ops) is dict and len(ops) <= 64, "invalid operations")
    for key, effects in ops.items():
        require(type(key) is str and type(effects) is list and len(set(effects)) == len(effects)
                and set(effects) <= set(names), "invalid operation: " + str(key))
    require(type(contract["cases"]) is list and 20 <= len(contract["cases"]) <= 128, "invalid cases")
    seen = set()
    for case in contract["cases"]:
        exact_keys(case, {"name", "profile", "entry", "functions", "expected", "diagnostic"}, "case")
        require(type(case["name"]) is str and case["name"] not in seen, "duplicate case")
        seen.add(case["name"])
        require(case["profile"] in PROFILES, "invalid profile")
        require(case["expected"] in {"accept", "reject"}, "invalid expected")
        require((case["diagnostic"] is None) == (case["expected"] == "accept"), "diagnostic/expected mismatch")
        funcs = case["functions"]
        require(type(funcs) is list and 1 <= len(funcs) <= 128, "invalid function list")
        ids = set()
        for fn in funcs:
            exact_keys(fn, {"id", "ops", "calls", "bound", "work", "context"}, "function")
            require(type(fn["id"]) is str and fn["id"] and fn["id"] not in ids, "duplicate function")
            ids.add(fn["id"])
            require(type(fn["ops"]) is list and all(type(op) is str for op in fn["ops"]), "invalid ops")
            require(fn["bound"] is None or (type(fn["bound"]) is list
                    and len(fn["bound"]) == len(set(fn["bound"])) and set(fn["bound"]) <= set(names)), "invalid bound")
            require(fn["work"] in WORK and fn["context"] in CONTEXTS, "invalid context/cost")
            require(type(fn["calls"]) is list and len(fn["calls"]) <= 64, "invalid calls")
            for call in fn["calls"]:
                exact_keys(call, {"targets", "sealed"}, "call")
                require(type(call["sealed"]) is bool and type(call["targets"]) is list
                        and 1 <= len(call["targets"]) <= 32
                        and all(type(t) is str and t for t in call["targets"])
                        and len(set(call["targets"])) == len(call["targets"]), "invalid call targets")
        require(case["entry"] in ids, "unresolved entry")


def assess(contract, case):
    """Return accept/reject and stable diagnostic, never a release certificate."""
    funcs = {fn["id"]: fn for fn in case["functions"]}
    ops = contract["operations"]
    reachable = set()
    queue = deque([case["entry"]])
    edges = {}
    while queue:
        name = queue.popleft()
        if name in reachable:
            continue
        if name not in funcs:
            return "reject", "E_EFFECT_UNKNOWN"
        reachable.add(name)
        fn = funcs[name]
        if any(op not in ops for op in fn["ops"]):
            return "reject", "E_EFFECT_UNKNOWN"
        children = []
        for call in fn["calls"]:
            if not call["sealed"]:
                return "reject", "E_EFFECT_UNKNOWN"
            children.extend(call["targets"])
        edges[name] = children
        queue.extend(children)
    effects = {name: set(e for op in funcs[name]["ops"] for e in ops[op]) for name in reachable}
    # Finite monotone union -> a fixed point, including mutually recursive calls.
    while True:
        changed = False
        for name in sorted(reachable):
            row = effects[name] | set().union(*(effects[c] for c in edges[name]))
            if row != effects[name]:
                effects[name] = row
                changed = True
        if not changed:
            break

    for name in sorted(reachable):
        fn = funcs[name]
        row = effects[name]
        if fn["context"] == "critical_read" and "state.write" in row:
            return "reject", "E_EFFECT_CRITICAL_WRITE"
        if fn["context"] != "ordinary" and row & {
            "suspend", "block", "spawns", "ffi", "io.net"
        }:
            return "reject", "E_EFFECT_CRITICAL_SUSPEND"
        bound = fn["bound"]
        if bound is not None and any(e not in bound and not (e.startswith("io.") and "io" in bound)
                                     for e in row):
            return "reject", "E_EFFECT_BOUND"

    row = effects[case["entry"]]
    if case["profile"] == "pure":
        if row & {"state.read", "state.write", "ffi", "nondet", "spawns", "block"} or any(
            e == "io" or e.startswith("io.") for e in row
        ):
            return "reject", "E_PURITY_EFFECT"
    if case["profile"] == "deterministic":
        if row & {"state.read", "state.write", "nondet", "ffi"} or any(
            e == "io" or e.startswith("io.") for e in row
        ):
            return "reject", "E_NONDETERMINISTIC"
    if case["profile"] == "hard_rt":
        if "alloc" in row:
            return "reject", "E_HARD_RT_ALLOCATION"
        if any(funcs[name]["work"] != "bounded" for name in reachable):
            return "reject", "E_HARD_RT_UNBOUNDED"
        # Kahn elimination: any residual reachable cycle requires a separate proof.
        indegree = {name: 0 for name in reachable}
        for caller in reachable:
            for target in edges[caller]:
                indegree[target] += 1
        pending = deque(name for name in reachable if indegree[name] == 0)
        removed = 0
        while pending:
            caller = pending.popleft()
            removed += 1
            for target in edges[caller]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    pending.append(target)
        if removed != len(reachable):
            return "reject", "E_HARD_RT_UNBOUNDED"
        if row & {"throw", "raise", "panic", "suspend", "block", "ffi", "spawns", "nondet"} or any(
            e == "io" or e.startswith("io.") for e in row
        ):
            return "reject", "E_HARD_RT_EFFECT"
    return "accept", None


def verify(contract):
    validate(contract)
    for case in contract["cases"]:
        actual, code = assess(contract, case)
        require((actual, code) == (case["expected"], case["diagnostic"]),
                case["name"] + ": expected " + str((case["expected"], case["diagnostic"]))
                + ", got " + str((actual, code)))
    return len(contract["cases"])


if __name__ == "__main__":
    try:
        data = load(Path(sys.argv[1]) if len(sys.argv) > 1 else CONTRACT)
        print("verified", verify(data), "source-free unified-effect target cases;", STATUS)
    except (InvalidContract, OSError, KeyError, TypeError) as exc:
        print("effect contract REJECTED:", exc, file=sys.stderr)
        raise SystemExit(1)
