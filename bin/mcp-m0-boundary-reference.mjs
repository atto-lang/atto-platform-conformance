// SOURCE-FREE M0 COMPOSITION REFERENCE ONLY.
// NOT a listener, trusted peer-authenticator, durable audit system,
// production admission implementation or AttoLang guest conformance proof.
//
// The frame guard checks the actual bytes and JSON nesting; this adapter then
// derives (rather than accepts) byte/depth measurements passed to the ledger.
// Pre-admission frame/host errors are NOT durable-audited by the ledger.
import { types as nodeTypes } from 'node:util';
import { parseM0Frame, M0FrameError } from './mcp-m0-frame-guard.mjs';
import { M0AdmissionLedger } from './mcp-m0-admission-ledger.mjs';

const viewByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength'
).get;
const hostKeys = Object.freeze([
  'peerAuthenticated', 'credential', 'hostBootId',
  'hostRuntimeGeneration', 'wallNowMs', 'monotonicNowMs'
]);

function snapshotHostContext(host) {
  // The caller must obtain peer identity, generation and clocks from the host,
  // NEVER from fields inside the JSON-RPC wire frame.
  if (host === null || typeof host !== 'object' || nodeTypes.isProxy(host) ||
      Array.isArray(host)) throw Error('invalid host context');
  const prototype = Object.getPrototypeOf(host);
  if (prototype !== Object.prototype && prototype !== null)
    throw Error('invalid host prototype');
  const descriptors = Object.getOwnPropertyDescriptors(host);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== hostKeys.length ||
      names.some(name => typeof name !== 'string' || !hostKeys.includes(name)))
    throw Error('host context must provide exactly the trusted fields');
  const result = Object.create(null);
  for (const name of hostKeys) {
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, 'value'))
      throw Error('host context accessor rejected');
    Object.defineProperty(result, name, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function measuredJsonDepth(root) {
  // parseM0Frame guarantees a bounded, acyclic JSON tree. No caller-provided
  // JS objects are traversed here; the function visits only JSON.parse output.
  const stack = [[root, 0]];
  let maximum = 0;
  let seen = 0;
  while (stack.length) {
    const [value, parentDepth] = stack.pop();
    if (++seen > 32768) throw Error('unexpected JSON node budget');
    if (value !== null && typeof value === 'object') {
      const depth = parentDepth + 1;
      if (depth > 12) throw Error('unexpected JSON depth');
      maximum = Math.max(maximum, depth);
      for (const child of Object.values(value)) stack.push([child, depth]);
    }
  }
  return maximum;
}

export function admitM0WireFrame(ledger, frame, trustedHost) {
  // A missing/invalid ledger is never a route to an accidental authorization.
  if (!(ledger instanceof M0AdmissionLedger))
    return { ok: false, reason: 'MALFORMED', stage: 'host' };
  let host;
  try { host = snapshotHostContext(trustedHost); }
  catch { return { ok: false, reason: 'MALFORMED', stage: 'host' }; }

  let request;
  try { request = parseM0Frame(frame); }
  catch (error) {
    const reason = error instanceof M0FrameError ? error.reason : 'MALFORMED';
    return { ok: false, reason, stage: 'frame' };
  }

  try {
    // Only the typed-array intrinsic length is authoritative. Host input
    // cannot override either frameBytes or the measured JSON container depth.
    const frameBytes = viewByteLength.call(frame);
    const jsonDepth = measuredJsonDepth(request);
    return ledger.begin({
      peerAuthenticated: host.peerAuthenticated,
      credential: host.credential,
      hostBootId: host.hostBootId,
      hostRuntimeGeneration: host.hostRuntimeGeneration,
      wallNowMs: host.wallNowMs,
      monotonicNowMs: host.monotonicNowMs,
      request, frameBytes, jsonDepth,
    });
  } catch {
    return { ok: false, reason: 'MALFORMED', stage: 'frame' };
  }
}
