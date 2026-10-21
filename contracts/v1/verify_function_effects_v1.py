#!/usr/bin/env python3
import json, sys
from pathlib import Path

EFFECTS={"state.read","state.write","suspend","io","alloc","block","ffi","throw","raise","panic"}

def load(path):
    data=json.loads(Path(path).read_text())
    if data.get("version") != 1: raise AssertionError("version")
    if set(data["effect_names"]) != EFFECTS: raise AssertionError("effect_names")
    if len(data["effect_names"]) != len(set(data["effect_names"])): raise AssertionError("duplicate effects")
    return data

def evaluate(data, case):
    declared=set(case["declared"])
    if not declared <= EFFECTS: raise AssertionError(case["name"]+": unknown declared effect")
    inferred=set()
    for op in case["ops"]:
        if op=="unknown.call":
            return "reject"
        try: inferred.update(data["operations"][op])
        except KeyError: raise AssertionError(case["name"]+": unknown op "+op)
    ctx=case.get("context")
    if ctx=="trap" and "throw" in inferred:
        return "reject"
    if ctx=="state.read" and "state.write" in inferred:
        return "reject"
    if ctx in {"state.read","state.write"} and inferred & {"suspend","block"}:
        return "reject"
    return "accept" if inferred <= declared else "reject"

def verify(path):
    data=load(path)
    seen=set()
    for case in data["cases"]:
        if case["name"] in seen: raise AssertionError("duplicate case "+case["name"])
        seen.add(case["name"])
        got=evaluate(data,case)
        if got != case["expect"]:
            raise AssertionError(f'{case["name"]}: expected {case["expect"]}, got {got}')
    expected_transitions={
      "actor_unhandled_throw":"raise",
      "actor_unhandled_raise":"panic",
      "actor_panic":"supervisor_control",
    }
    if data["semantics"]["failure_transitions"] != expected_transitions:
        raise AssertionError("failure transitions")
    if data["semantics"]["with_clause"] != "upper_bound":
        raise AssertionError("with semantics")
    return len(data["cases"])

if __name__=="__main__":
    p=sys.argv[1] if len(sys.argv)>1 else "contracts/v1/function-effects-v1.json"
    print(f"verified {verify(p)} function-effect cases")
