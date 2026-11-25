#!/usr/bin/env python3
"""Independent source-free constructor state model, not a compiler test."""
from itertools import product
from random import Random

REQUIRED = frozenset(('fixed', 'mutable'))
FIXED = frozenset(('fixed',))
OPS = ('fixed', 'mutable', 'escape', 'return', 'noop')


def expand(program):
    paths = [()]
    for step in program:
        if isinstance(step, tuple):
            _, then_arm, else_arm = step
            continuations = expand(then_arm) + expand(else_arm)
            paths = [prefix + suffix for prefix in paths for suffix in continuations]
        else:
            paths = [prefix + (step,) for prefix in paths]
    return paths


def ground_truth(program):
    for trace in expand(program):
        initialized = set()
        for step in trace:
            if step in ('fixed', 'mutable'):
                if step in FIXED and step in initialized:
                    return False
                initialized.add(step)
            elif step in ('escape', 'return'):
                if not REQUIRED.issubset(initialized):
                    return False
                if step == 'return':
                    break
        else:
            if not REQUIRED.issubset(initialized):
                return False
    return True


def symbolic(program, states):
    for step in program:
        next_states = set()
        for initialized in states:
            if isinstance(step, tuple):
                _, t, f = step
                left = symbolic(t, {initialized})
                right = symbolic(f, {initialized})
                if left is None or right is None:
                    return None
                next_states.update(left)
                next_states.update(right)
            elif step in ('fixed', 'mutable'):
                if step in FIXED and step in initialized:
                    return None
                next_states.add(initialized | {step})
            elif step == 'escape':
                if not REQUIRED.issubset(initialized):
                    return None
                next_states.add(initialized)
            elif step == 'return':
                if not REQUIRED.issubset(initialized):
                    return None
            else:
                next_states.add(initialized)
        states = next_states
    return states


def verified(program):
    end = symbolic(program, {frozenset()})
    return end is not None and all(REQUIRED.issubset(state) for state in end)


def generated(rng, depth=0):
    result=[]
    for _ in range(rng.randint(0, 6)):
        if depth < 2 and rng.randrange(5) == 0:
            result.append(('if', generated(rng, depth+1), generated(rng, depth+1)))
        else:
            result.append(rng.choice(OPS))
    return result


def main():
    n=0
    for size in range(7):
        for steps in product(OPS, repeat=size):
            assert ground_truth(steps) == verified(steps), steps
            n+=1
    rng=Random(22027)
    for _ in range(2000):
        program=generated(rng)
        assert ground_truth(program) == verified(program), program
        n+=1
    assert verified(('fixed', 'mutable', 'mutable', 'escape', 'return'))
    assert not verified(('fixed','fixed','mutable'))
    assert not verified((('if', ('fixed',), ('noop',)), 'mutable'))
    assert not verified(('escape','fixed','mutable'))
    assert verified((('if', ('fixed',), ('fixed',)), 'mutable'))
    print(f'ORESLANG_SOURCE_FREE_CONSTRUCTOR_REFERENCE_PASS programs={n} coverage=fixed-exact-once,mutable-at-least-once,branches,escape,return compiler=NOT_EXECUTED')


if __name__ == '__main__':
    main()
