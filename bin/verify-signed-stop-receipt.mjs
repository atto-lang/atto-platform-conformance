// A host-signed STOP receipt authenticates a configured issuer's assertion,
// not physical effect completion if that issuer signs prematurely or lies.
// Trust anchors must be provided out-of-band; never accept them from a trace.
import { createPublicKey, verify } from 'node:crypto';

const DOMAIN = 'ORESLANG_HOST_STOP_APPLIED_V1\n';
const FIELDS = Object.freeze([
  'backend', 'sourceSha', 'supervisor', 'child', 'actor', 'generation',
  'turn', 'stopPermitId', 'evidenceId', 'operationId', 'status'
]);
const identity = value => typeof value === 'string' &&
  value.length > 0 && value.length <= 256;
const positive = value => Number.isSafeInteger(value) && value > 0;
const source = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function canonicalSignedStopReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    throw new TypeError('STOP receipt must be a record');
  if (!['java', 'llvm'].includes(receipt.backend) || !source(receipt.sourceSha) ||
      !positive(receipt.generation) || !positive(receipt.turn) ||
      !['supervisor', 'child', 'actor', 'stopPermitId', 'evidenceId', 'operationId']
        .every(field => identity(receipt[field])) ||
      receipt.status !== 'applied')
    throw new TypeError('invalid or incomplete applied STOP receipt identity');
  // Immutable field order and a domain-separated prefix make signatures
  // deterministic across Java/LLVM host adapters.
  return Buffer.from(DOMAIN + JSON.stringify(
    Object.fromEntries(FIELDS.map(field => [field, receipt[field]]))), 'utf8');
}

function signatureBytes(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 128 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new TypeError('invalid STOP receipt signature encoding');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== encoded)
    throw new TypeError('invalid STOP receipt Ed25519 signature');
  return bytes;
}

/**
 * Returns a proof callback for verifySupervisorTrace(doc,{verifyProof}).
 *
 * Receipts MUST come from an independently accessed host authority store.
 * The source SHA and public key come from trusted configuration, not the
 * untrusted trace document. A signature authenticates the configured issuer
 * but does not establish that an external effect occurred if the issuer lies.
 * Crash recovery requires the issuer's durable operation ledger.
 */
export function createSignedStopReceiptVerifier({
  trustedPublicKeyPem, receipts, expectedSourceSha, expectedBackend
}) {
  if (!source(expectedSourceSha))
    throw new TypeError('trusted checkout SHA must be supplied out of band');
  if (expectedBackend !== undefined && !['java', 'llvm'].includes(expectedBackend))
    throw new TypeError('invalid trusted backend');
  if (!Array.isArray(receipts))
    throw new TypeError('host receipts must be an independent list');
  const key = createPublicKey(trustedPublicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new TypeError('STOP receipt key must use Ed25519');

  const records = new Map(), operations = new Set();
  for (const receipt of receipts) {
    const payload = canonicalSignedStopReceipt(receipt);
    const signature = signatureBytes(receipt.signature);
    if (receipt.sourceSha !== expectedSourceSha ||
        (expectedBackend !== undefined && receipt.backend !== expectedBackend))
      throw new Error('host STOP receipt belongs to a foreign source/backend');
    if (records.has(receipt.evidenceId) || operations.has(receipt.operationId))
      throw new Error('duplicate host STOP receipt/effect identity');
    if (!verify(null, payload, key, signature))
      throw new Error('untrusted or tampered host STOP receipt');
    records.set(receipt.evidenceId, Object.freeze(
      Object.fromEntries(FIELDS.map(field => [field, receipt[field]]))));
    operations.add(receipt.operationId);
  }
  return proof => {
    if (!proof || typeof proof !== 'object') return false;
    const r = records.get(proof.evidenceId);
    return Boolean(r && r.sourceSha === expectedSourceSha &&
      ['backend', 'sourceSha', 'supervisor', 'child', 'actor',
       'generation', 'turn', 'stopPermitId', 'evidenceId']
        .every(field => r[field] === proof[field]));
  };
}
