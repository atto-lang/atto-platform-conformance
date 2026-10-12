// Host-owned STOP receipt adapter. A trace is NEVER its own evidence.
// The loader must read an authoritative, independently persisted host record
// (e.g. the lifecycle owner's durable stop ledger), not a trace-supplied blob.
// This library neither performs a STOP nor creates trustworthy host records.
const exact = (a, b) => typeof a === typeof b && a === b;
const required = ['backend','sourceSha','supervisor','child','actor',
  'generation','turn','stopPermitId','evidenceId'];

export function createHostStopReceiptVerifier(loadHostReceipt) {
  if (typeof loadHostReceipt !== 'function')
    throw new TypeError('trusted host receipt loader required');
  return function verifyHostStopReceipt(request) {
    if (!request || typeof request !== 'object') return false;
    if (!required.every(field => request[field] !== undefined)) return false;
    // The evidence ID is a locator, not an authorization token. The loader
    // must own its namespace and storage; it must never trust trace fields.
    let record;
    try { record = loadHostReceipt(request.evidenceId); }
    catch { return false; }
    if (!record || typeof record !== 'object' || Array.isArray(record))
      return false;
    if (!required.every(field => exact(record[field], request[field])))
      return false;
    if (record.effect !== 'physical-stop' || record.status !== 'applied'
        || record.provenance !== 'host-lifecycle-owner') return false;
    if (!Number.isSafeInteger(record.generation) || record.generation < 1
        || !Number.isSafeInteger(record.turn) || record.turn < 1) return false;
    // Disallow caller-supplied "proof" of arbitrary previous occurrences.
    // A host record must explicitly bind the original reserved host effect.
    if (typeof record.operationId !== 'string' || !record.operationId
        || record.operationId.length > 256) return false;
    if (record.stopOperationId !== record.operationId) return false;
    return true;
  };
}
