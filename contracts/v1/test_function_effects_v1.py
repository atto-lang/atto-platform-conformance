#!/usr/bin/env python3
import copy, json, tempfile
from pathlib import Path
import verify_function_effects_v1 as v

CONTRACT=Path(__file__).with_name("function-effects-v1.json")

def must_fail(data):
    with tempfile.NamedTemporaryFile("w",suffix=".json",delete=False) as f:
        json.dump(data,f); name=f.name
    try:
        try: v.verify(name)
        except (AssertionError, KeyError, TypeError, ValueError): return
        raise AssertionError("mutated contract unexpectedly verified")
    finally:
        Path(name).unlink(missing_ok=True)

def main():
    data=json.loads(CONTRACT.read_text())
    assert v.verify(CONTRACT) >= 18
    m=copy.deepcopy(data); m["effect_names"].remove("panic"); must_fail(m)
    m=copy.deepcopy(data); m["semantics"]["failure_transitions"]["actor_unhandled_raise"]="raise"; must_fail(m)
    m=copy.deepcopy(data); m["cases"][0]["expect"]="reject"; must_fail(m)
    m=copy.deepcopy(data); m["cases"].append(copy.deepcopy(m["cases"][0])); must_fail(m)
    print("function-effects mutation tests passed")

if __name__=="__main__": main()
