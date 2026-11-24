import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const nativeProtocolRuntimeUnits = Object.freeze([
  "ActorOwnedI64Heap", "NativeActorScheduler", "NativeOresVM", "NativeActorFuture",
  "SourceActorBootstrap", "NativeActorLogicalFramesV1", "NativeExecutionContextStore",
  "NativeContinuationStore", "NativeAwaitTraceBridge", "NativeLogicalTrace",
]);

export async function checkReferenceFrames(lines, commonCheckout) {
  const referenceRoot = resolve(commonCheckout, "reference/verified-core");
  const { elaborateProtocol } = await import(pathToFileURL(join(referenceRoot, "protocols.mjs")).href);
  const { decodeProtocolTurnReceipt, encodeProtocolMailboxMessage } =
    await import(pathToFileURL(join(referenceRoot, "protocol-mailbox.mjs")).href);
  const protocol = elaborateProtocol({
    name: "Connection",
    initial: "Disconnected",
    terminals: ["Failed"],
    edges: [
      { source: "Disconnected", target: "Connecting", message: "connect",
        payload: [{ name: "timeout", type: "Timeout" }] },
      { source: "Connecting", target: "Connected", message: "connected" },
      { source: "Connecting", target: "Failed", message: "fail" },
      { source: "Connected", target: "Connecting", message: "connect",
        payload: [{ name: "timeout", type: "Timeout" }] },
    ],
  }, new Map([["Timeout", { carrier: "i32", unit: "Millis", range: [1n, 60_000n] }]]), [
    { kind: "dimension", name: "Time" },
    { kind: "unit", name: "Second", dimension: "Time" },
    { kind: "unit", name: "Millis", dimension: "Time", relativeTo: "Second", factor: "1000", divide: true },
  ]);
  const [data, firstReceipt] = lines;
  const frame = encodeProtocolMailboxMessage(protocol.mailbox, "connect", [42n]);
  assert.equal(data, "frame " + frame.toString("hex").toUpperCase(),
    "Backend message differs from the independent reference frame");
  assert.match(firstReceipt, /^receipt [0-9A-F]{68}$/);
  const observed = decodeProtocolTurnReceipt(Buffer.from(firstReceipt.slice(8), "hex"));
  const initial = protocol.mailbox.states.findIndex(state => state.name === protocol.initial);
  assert.ok(observed.actorId > 0n);
  assert.deepEqual(observed, { actorId: observed.actorId, generation: 1n,
    turn: 1n, status: 2, source: initial, destination: initial });
}
