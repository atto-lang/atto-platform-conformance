#!/usr/bin/env python3
"""Incomplete but fail-closed static checks before actual TLC execution.

Not a TLA+ parser, not a TLA+ model checker, not a native guest proof.
"""
import argparse
import re
from pathlib import Path

ACTIONS = ('Start', 'AdmitAuthorization', 'TimeoutAuthorization', 'SettleAuthorization',
           'AdmitCapture', 'SettleCapture', 'CloseSession', 'StageImage',
           'ValidateImage', 'PublishImage', 'UnsafePublishImage', 'RetireImage',
           'UnsafeRetire', 'UnsafeTimeout')
INVARIANTS = ('TypeOK', 'ActiveImagePresent', 'CapacityBounded',
              'StagedImagePresent', 'PublishedValidated', 'ValidatedImagesPresent',
              'NoDanglingPins', 'TerminalReleasesPin',
              'NoSpentPhaseResurrection', 'TokenMatchesPhase')


def check_tla(source):
    vars_head = re.search(r'(?m)^VARIABLES ([a-zA-Z0-9_, ]+)$', source)
    tuple_head = re.search(r'(?m)^vars == <<([^<>]+)>>$', source)
    if not vars_head or not tuple_head:
        raise ValueError('VARIABLES or full state-vector definition missing')
    variables = vars_head.group(1).replace(' ', '').split(',')
    state_vector = tuple_head.group(1).replace(' ', '').split(',')
    if len(variables) != len(set(variables)) or variables != state_vector:
        raise ValueError('state-vector duplicates or omits a declared variable')
    for name in ACTIONS:
        found = re.search(rf'(?ms)^{name}(?:\([^\n]+\))? ==\n(.*?)(?=\n\n(?:\(\*|[A-Za-z]|Next ==))', source)
        if not found:
            raise ValueError(f'missing action {name}')
        body = found.group(1)
        unchanged_match = re.search(r'UNCHANGED <<([^<>]+)>>', body)
        if not unchanged_match:
            raise ValueError(f'no explicit UNCHANGED in action {name}')
        unchanged = unchanged_match.group(1).replace(' ', '').split(',')
        if len(unchanged) != len(set(unchanged)):
            raise ValueError(f'duplicate UNCHANGED entry: {name}')
        primed = [v for v in variables if re.search(rf'\b{re.escape(v)}\s*\x27', body)]
        if set(primed) & set(unchanged):
            raise ValueError(f'next-state variable both assigned and unchanged: {name}')
        if set(primed) | set(unchanged) != set(variables):
            raise ValueError(f'incomplete next-state assignment: {name}: missing={set(variables)-set(primed)-set(unchanged)}')
    must_contain = {
        'PublishImage': r'/\ staging \in validated',
        'UnsafePublishImage': r'/\ UnsafePublish',
        'RetireImage': r'/\ \A s \in Sessions : pinned[s] # v',
        'UnsafeRetire': r'/\ UnsafePurge',
        'UnsafeTimeout': r'/\ UnsafeResurrect',
    }
    for action, phrase in must_contain.items():
        if phrase not in source:
            raise ValueError(f'missing explicit safety/negative precondition in {action}')
    return len(variables), len(ACTIONS)


def check_config(text, unsafe):
    for flag in ('UnsafePurge', 'UnsafeResurrect', 'UnsafePublish'):
        found = re.findall(rf'(?m)^\s*{flag}\s*=\s*(TRUE|FALSE)\s*$', text)
        if len(found) != 1 or (found[0] == 'TRUE') != (flag == unsafe):
            raise ValueError('invalid missing/duplicate mutation flag ' + flag)
    for inv in INVARIANTS:
        if not re.search(rf'(?m)^\s*{inv}\s*$', text):
            raise ValueError('missing invariant in config: ' + inv)
    return True


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    args=p.parse_args()
    root=args.directory
    variables, actions = check_tla((root/'ThreeGuarantees.tla').read_text())
    for filename, mutation in (('ThreeGuarantees.cfg', None),
                               ('ThreeGuaranteesUnsafePurge.cfg','UnsafePurge'),
                               ('ThreeGuaranteesUnsafeTimeout.cfg','UnsafeResurrect'),
                               ('ThreeGuaranteesUnsafePublish.cfg','UnsafePublish')):
        check_config((root/filename).read_text(), mutation)
    print(f'STATIC_TLA_STRUCTURE_OK variables={variables} actions={actions} configs=4; NOT TLC proof')


if __name__ == '__main__':
    main()
