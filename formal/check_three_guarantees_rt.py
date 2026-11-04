#!/usr/bin/env python3
"""Fail-closed SMT verification for the abstract Oreslang RT admission formula.

A passing result is NOT a hardware WCET certificate or compiler-correctness proof.
"""
import argparse
import ctypes
import hashlib
import json
import re
import sys
from pathlib import Path

FIELDS = ('wcet', 'jitter', 'interference', 'blocking', 'cleanup', 'activation', 'deadline')


def validate_output(output):
    statuses = re.findall(r'(?m)^(sat|unsat|unknown)$', output)
    if statuses != ['unsat', 'sat']:
        raise ValueError(f'expected exact unsat/sat results; got {statuses!r}')
    if 'error' in output.lower():
        raise ValueError('solver reported an error')
    witness = {}
    for field in (*FIELDS, 'allKnown', 'certMatches'):
        kind = 'Bool' if field in ('allKnown', 'certMatches') else 'Int'
        match = re.search(r'\(define-fun\s+' + field + r'\s+\(\)\s+' + kind + r'\s+([^\s()]+|\(-\s+\d+\))\s*\)', output)
        if not match:
            raise ValueError('missing/invalid counterexample field ' + field)
        raw = match.group(1)
        if kind == 'Bool':
            if raw not in ('true', 'false'):
                raise ValueError('invalid Boolean ' + field)
            witness[field] = (raw == 'true')
        else:
            witness[field] = int(raw.strip('()').replace('- ', '-'))
    if not (witness['allKnown'] and witness['certMatches']):
        raise ValueError('counterexample does not meet admission premises')
    if any(witness[f] < 0 for f in FIELDS):
        raise ValueError('counterexample violates nonnegativity premise')
    without_cleanup = sum(witness[f] for f in FIELDS[:4]) + witness['activation']
    with_cleanup = without_cleanup + witness['cleanup']
    if not (without_cleanup <= witness['deadline'] < with_cleanup):
        raise ValueError('counterexample does not demonstrate cleanup omission')
    return witness


def run(path, required_version, explicit_lib=None):
    if explicit_lib is None or not Path(explicit_lib).is_file():
        raise RuntimeError('exact solver library path is required for digest-bound evidence')
    shared_lib = Path(explicit_lib)
    z = ctypes.CDLL(str(shared_lib))
    z.Z3_get_full_version.restype = ctypes.c_char_p
    version = z.Z3_get_full_version().decode()
    if version != required_version:
        raise RuntimeError(f'wrong Z3 solver version: {version}; expected {required_version}')
    z.Z3_mk_config.restype = ctypes.c_void_p
    z.Z3_mk_context.argtypes = [ctypes.c_void_p]
    z.Z3_mk_context.restype = ctypes.c_void_p
    z.Z3_del_config.argtypes = [ctypes.c_void_p]
    z.Z3_del_context.argtypes = [ctypes.c_void_p]
    z.Z3_eval_smtlib2_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    z.Z3_eval_smtlib2_string.restype = ctypes.c_char_p
    data = path.read_bytes()
    cfg = z.Z3_mk_config()
    ctx = z.Z3_mk_context(cfg)
    z.Z3_del_config(cfg)
    if not ctx:
        raise RuntimeError('failed to create Z3 context')
    try:
        result = z.Z3_eval_smtlib2_string(ctx, data)
        if not result:
            raise RuntimeError('no solver output')
        witness = validate_output(result.decode('utf8'))
    finally:
        z.Z3_del_context(ctx)
    return {'status': 'abstract_smt_checked', 'solver': 'Z3',
            'solver_version': version,
            'solver_library_sha256': hashlib.sha256(shared_lib.read_bytes()).hexdigest(),
            'model_sha256': hashlib.sha256(data).hexdigest(),
            'queries': ['unsat', 'sat'], 'counterexample': witness,
            'compiler_proof': False, 'wcet_certificate': False}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('model', type=Path)
    p.add_argument('--z3-version', default='4.13.3.0')
    p.add_argument('--z3-lib', type=Path, required=True)
    args = p.parse_args()
    try:
        receipt = run(args.model, args.z3_version, args.z3_lib)
    except Exception as exc:
        print(f'SMT_VERIFICATION_FAILED: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(receipt, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
