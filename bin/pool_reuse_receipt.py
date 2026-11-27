"""Additional structural evidence for fixed-buffer reuse; never authenticates CI."""

BACKENDS = frozenset(('java', 'llvm', 'net', 'wasm', 'forge', 'rs', 'js', 'cranelift'))
MIN_CYCLES = 1_000_000


def validate_reuse(receipt):
    """Require independent acquire/release evidence, in addition to v1 transfer proof."""
    if not isinstance(receipt, dict) or receipt.get('schema') != 'atto.fixed-buffer-pool.reuse-receipt.v2':
        raise ValueError('missing v2 reuse receipt')
    if not isinstance(receipt.get('backend'), str) or receipt['backend'] not in BACKENDS:
        raise ValueError('unknown backend')
    if receipt.get('status') != 'passed':
        raise ValueError('reuse not passed')
    for key in ('acquire_release_probe_available', 'preallocated', 'scrub_before_reissue',
                'all_slots_reused', 'exhaustion_no_growth', 'same_backing_region_on_reacquire'):
        if receipt.get(key) is not True:
            raise ValueError('missing reuse evidence: ' + key)
    for key in ('dynamic_allocations_during_reuse', 'backing_allocations_during_reuse',
                'outstanding_leases_after_reuse'):
        if type(receipt.get(key)) is not int or receipt[key] != 0:
            raise ValueError('nonzero or missing reuse counter: ' + key)
    cycles = receipt.get('completed_acquire_release_cycles')
    slots = receipt.get('preallocated_slots')
    if type(cycles) is not int or cycles < MIN_CYCLES:
        raise ValueError('insufficient complete acquire/release cycles')
    if type(slots) is not int or slots < 1 or slots > cycles:
        raise ValueError('invalid preallocated slot count')
    before = receipt.get('retained_backing_bytes_before_reuse')
    after = receipt.get('retained_backing_bytes_after_reuse')
    if type(before) is not int or type(after) is not int or before < 1 or before != after:
        raise ValueError('backing storage changed across reuse window')
    return 'STRUCTURAL_REUSE_EVIDENCE_ONLY'
