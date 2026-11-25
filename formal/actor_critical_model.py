#!/usr/bin/env python3
"""Bounded exhaustive actor critical-section/generation reference model.

Host-only specification, NOT a proof about compiled Atto guest or AOT execution.
"""
from collections import deque
from dataclasses import dataclass, replace

MUTANTS = ("writer-with-readers", "two-writers", "stale-frame", "teardown-leak")

@dataclass(frozen=True)
class State:
    generation: int = 1
    phase: str = "live"
    modes: tuple[str, str] = ("idle", "idle")
    frames: tuple[int, int] = (0, 0)
    writes: int = 0
    stale_tested: bool = False
    stale_accepted: bool = False


def set_lane(s, i, mode, generation):
    modes, frames = list(s.modes), list(s.frames)
    modes[i], frames[i] = mode, generation
    return replace(s, modes=tuple(modes), frames=tuple(frames))


def edges(s, mutant=None):
    if s.phase == "stopped":
        if s.generation == 1:
            yield "restart(g2)", replace(s, phase="live", generation=2, stale_tested=False)
        return
    for i in range(2):
        if s.modes[i] == "idle":
            if "write" not in s.modes or mutant == "writer-with-readers":
                yield f"begin_read({i})", set_lane(s, i, "read", s.generation)
            if (all(m == "idle" for m in s.modes)
                or (mutant == "writer-with-readers" and "read" in s.modes)
                or (mutant == "two-writers" and "write" in s.modes)):
                yield f"begin_write({i})", set_lane(s, i, "write", s.generation)
        else:
            yield f"release({i})", set_lane(s, i, "idle", 0)
            if s.modes[i] == "write" and s.writes < 2:
                yield f"commit_write({i})", replace(s, writes=s.writes + 1)
    if s.generation == 2 and not s.stale_tested and s.modes[0] == "idle":
        if mutant == "stale-frame":
            yield "admit_stale_frame(g1)", replace(
                set_lane(s, 0, "read", 1), stale_tested=True, stale_accepted=True)
        else:
            yield "reject_stale_frame(g1)", replace(s, stale_tested=True)
    # A supervisor panic/terminate invalidates *all* actor-owned logical stacks.
    if mutant == "teardown-leak" and any(m != "idle" for m in s.modes):
        yield "stop_without_unwind", replace(s, phase="stopped")
    else:
        yield "stop_and_unwind", replace(s, phase="stopped", modes=("idle", "idle"), frames=(0, 0))


def violations(s):
    if s.generation not in (1, 2) or s.phase not in ("live", "stopped"):
        return "TypeOK"
    for m, frame in zip(s.modes, s.frames):
        if m not in ("idle", "read", "write") or (frame == 0) != (m == "idle"):
            return "StackFrameType"
        if m != "idle" and frame != s.generation:
            return "GenerationFence"
    if s.modes.count("write") > 1:
        return "SingleWriter"
    if "write" in s.modes and "read" in s.modes:
        return "ReaderWriterExclusion"
    if s.phase == "stopped" and (s.modes != ("idle", "idle") or s.frames != (0, 0)):
        return "TeardownInvalidatesStacks"
    if s.stale_accepted:
        return "RejectStaleFrames"
    return None


def explore(mutant=None):
    if mutant not in (*MUTANTS, None):
        raise ValueError(mutant)
    initial = State()
    queue = deque([(initial, ())])
    visited = {initial}
    witnesses = set()
    edge_count = 0
    while queue:
        state, trace = queue.popleft()
        if state.modes == ("read", "read"):
            witnesses.add("concurrent-readers")
        if state.writes > 0:
            witnesses.add("exclusive-write")
        if state.generation == 2 and state.stale_tested and not state.stale_accepted:
            witnesses.add("stale-rejection-after-restart")
        if state.generation == 2 and state.phase == "stopped":
            witnesses.add("second-generation-termination")
        for action, successor in edges(state, mutant):
            edge_count += 1
            failure = violations(successor)
            next_trace = trace + (action,)
            if failure:
                return len(visited), edge_count, witnesses, failure, next_trace
            if successor not in visited:
                visited.add(successor)
                queue.append((successor, next_trace))
    return len(visited), edge_count, witnesses, None, ()


def main():
    states, count, witnesses, failure, _ = explore()
    assert failure is None, failure
    assert witnesses == {
        "concurrent-readers", "exclusive-write", "stale-rejection-after-restart",
        "second-generation-termination"
    }, witnesses
    print(f"ACTOR_CRITICAL_BOUNDED_PASS states={states} edges={count}")
    for mutant in MUTANTS:
        _, _, _, failure, trace = explore(mutant)
        assert failure is not None, f"mutation escaped: {mutant}"
        print(f"MUTATION_REJECTED mutant={mutant} invariant={failure} trace={' -> '.join(trace)}")
    print("HOST_MODEL_ONLY Atto guest/JIT/AOT/backend=NOT_EXECUTED")


if __name__ == "__main__":
    main()
