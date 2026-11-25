#!/usr/bin/env python3
"""Bounded explicit-state model of supervisor CONTROL vs actor DATA.

Reference model only: passing does not prove Java/LLVM guest execution.
Deterministic breadth-first search returns shortest counterexample paths.
"""
from __future__ import annotations
import argparse
from collections import deque
from dataclasses import dataclass, replace
import json
from typing import Iterator

CAPACITY = 2
MESSAGES = (11, 12, 21, 22)
MUTANTS = ("priority", "stale-admission", "duplicate-settlement", "cancelled-resurrection", "lost-message")

@dataclass(frozen=True)
class State:
    generation: int = 1
    phase: str = "live"
    submitted: frozenset[int] = frozenset()
    accepted: frozenset[int] = frozenset()
    queued: tuple[int, ...] = ()
    control: bool = False
    carrier: tuple[str, int] | None = None
    completed: tuple[int, ...] = ()
    cancelled: frozenset[int] = frozenset()
    stale_attempted: bool = False
    stale_drops: int = 0
    priority_overtake: bool = False

def generation_of(message: int) -> int:
    return message // 10

def transitions(s: State, mutant: str | None = None) -> Iterator[tuple[str, State]]:
    if s.phase == "live":
        for m in MESSAGES:
            if (generation_of(m) == s.generation and m not in s.submitted
                    and len(s.queued) < CAPACITY):
                yield f"DATA.enqueue({m})", replace(
                    s, submitted=s.submitted | {m}, accepted=s.accepted | {m},
                    queued=s.queued + (m,))
        # CONTROL has a reserved slot independent of full DATA capacity.
        if not s.control:
            yield "CONTROL.enqueue(stop)", replace(s, control=True)
        if s.carrier is None:
            if s.control:
                yield "CONTROL.dispatch(stop)", replace(
                    s, control=False, phase="fenced", carrier=("control", s.generation))
            if s.queued and (not s.control or mutant == "priority"):
                m = s.queued[0]
                yield f"DATA.dispatch({m})", replace(
                    s, queued=s.queued[1:], carrier=("data", m),
                    priority_overtake=s.priority_overtake or s.control)
        if s.carrier is not None and s.carrier[0] == "data":
            m = s.carrier[1]
            yield f"DATA.commit({m})", replace(
                s, carrier=None, completed=s.completed + (m,))
    elif s.phase == "fenced" and s.carrier == ("control", s.generation):
        yield "CONTROL.finalize(stop)", replace(
            s, phase="stopped", carrier=None,
            cancelled=s.cancelled | set(s.queued), queued=())
    elif s.phase == "stopped" and s.generation == 1:
        yield "SUPERVISOR.restart(g2)", replace(s, generation=2, phase="live")

    # Old-generation envelope may be replayed after a supervisor restart.
    if s.generation == 2 and s.phase == "live" and not s.stale_attempted:
        if mutant == "stale-admission" and len(s.queued) < CAPACITY:
            yield "MUTANT.admit(stale-g1)", replace(
                s, stale_attempted=True, accepted=s.accepted | {13},
                queued=s.queued + (13,))
        else:
            yield "DATA.reject(stale-g1)", replace(
                s, stale_attempted=True, stale_drops=1)
    if mutant == "cancelled-resurrection" and s.generation == 2 and s.phase == "live" and s.cancelled and len(s.queued) < CAPACITY:
        m = min(s.cancelled)
        yield f"MUTANT.resurrect-cancelled({m})", replace(s, queued=s.queued + (m,))
    if mutant == "lost-message" and s.phase == "live" and s.queued:
        yield "MUTANT.drop-without-settlement", replace(s, queued=s.queued[1:])
    if mutant == "duplicate-settlement" and s.completed:
        m = s.completed[0]
        if s.completed.count(m) == 1:
            yield f"MUTANT.replay-completion({m})", replace(
                s, completed=s.completed + (m,))

def violations(s: State) -> tuple[str, ...]:
    problems = []
    if s.generation not in (1, 2) or s.phase not in ("live", "fenced", "stopped"):
        problems.append("TypeOK")
    if len(s.queued) > CAPACITY or (s.control and s.phase != "live"):
        problems.append("MailboxBounds")
    if s.phase == "stopped" and (s.carrier is not None or s.queued or s.control):
        problems.append("TerminalDrainsPending")
    if s.phase == "fenced" and s.carrier != ("control", s.generation):
        problems.append("FenceOwnsCarrier")
    # Terminal cancellation is a permanent tombstone, including after restart.
    # A stop-time-only check would be implied by TerminalDrainsPending and vacuous.
    if set(s.completed) & set(s.cancelled) or set(s.queued) & set(s.cancelled) or \
            (s.carrier is not None and s.carrier[0] == "data" and s.carrier[1] in s.cancelled):
        problems.append("NoResurrection")
    if any(generation_of(m) != s.generation for m in s.queued):
        problems.append("QueueIncarnation")
    if s.carrier and s.carrier[0] == "data" and generation_of(s.carrier[1]) != s.generation:
        problems.append("DispatchIncarnation")
    if s.priority_overtake:
        problems.append("ControlPriority")
    if len(s.completed) != len(set(s.completed)):
        problems.append("AtMostOnce")
    queued = list(s.queued)
    inflight = [s.carrier[1]] if s.carrier and s.carrier[0] == "data" else []
    accounted = queued + inflight + list(s.completed) + list(s.cancelled)
    if len(accounted) != len(set(accounted)) or set(accounted) != s.accepted:
        problems.append("DataConservation")
    if s.stale_drops not in (0, 1):
        problems.append("BoundedStaleDrops")
    return tuple(problems)

@dataclass
class Result:
    states: int
    edges: int
    witnesses: frozenset[str]
    invariant: str | None = None
    trace: tuple[str, ...] = ()

def check(mutant: str | None = None) -> Result:
    if mutant not in (*MUTANTS, None):
        raise ValueError(f"unknown mutant: {mutant}")
    initial = State()
    visited = {initial}
    queue = deque([(initial, ())])
    edges = 0
    witnesses: set[str] = set()
    while queue:
        state, path = queue.popleft()
        if len(state.queued) == CAPACITY and state.control:
            witnesses.add("full-data-plus-control")
        if state.generation == 2 and state.stale_attempted and state.stale_drops == 1:
            witnesses.add("stale-replay-rejected")
        if state.generation == 2 and state.phase == "stopped":
            witnesses.add("generation-two-stop")
        if state.generation == 2 and state.completed:
            witnesses.add("data-commit-with-restart")
        for name, nxt in transitions(state, mutant):
            edges += 1
            trace = path + (name,)
            broken = violations(nxt)
            if broken:
                return Result(len(visited), edges, frozenset(witnesses), broken[0], trace)
            if nxt not in visited:
                visited.add(nxt)
                queue.append((nxt, trace))
    return Result(len(visited), edges, frozenset(witnesses))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mutant", choices=MUTANTS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = check(args.mutant)
    payload = {
        "model": "actor-control-priority-v1",
        "bounded": {"generations": 2, "data_capacity": CAPACITY, "messages_per_generation": 2},
        "mutant": args.mutant or "none", "states": result.states, "edges": result.edges,
        "violated_invariant": result.invariant, "counterexample": list(result.trace),
        "coverage_witnesses": sorted(result.witnesses),
    }
    print(json.dumps(payload, sort_keys=True) if args.json else json.dumps(payload, indent=2))
    return 1 if result.invariant else 0

if __name__ == "__main__":
    raise SystemExit(main())
