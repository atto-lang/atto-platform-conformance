import {
  createHash, randomBytes, randomUUID, sign, verify,
  timingSafeEqual, createPublicKey
} from 'node:crypto';

// Reference protocol only. A signed self-report is not a trusted build receipt.
export const SCHEMA = 'oreslang.device-build-challenge/1';
export const PREDICATE_TYPE = 'https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/predicates/device-build/v1';
export const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const DISPOSITION = 'QUARANTINE_UNTRUSTED_BUILD';
const HEX64 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TARGETS = new Set(['java', 'llvm', 'net', 'wasm', 'forge', 'js']);
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 64 * 1024;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, expected) {
  return object(value) && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}
function validChallenge(challenge) {
  return keys(challenge, ['schema','challengeId','nonce','tenantId','sourceCommit','toolchainSha256','target','expiresAt']) &&
    challenge.schema === SCHEMA && typeof challenge.challengeId === 'string' &&
    /^[0-9a-f-]{36}$/.test(challenge.challengeId) && typeof challenge.nonce === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) && ID.test(challenge.tenantId) &&
    SHA1.test(challenge.sourceCommit) && HEX64.test(challenge.toolchainSha256) &&
    TARGETS.has(challenge.target) && Number.isSafeInteger(challenge.expiresAt);
}
function equalRecord(expected, actual) {
  return keys(actual, Object.keys(expected)) && Object.entries(expected).every(([k,v]) => actual[k] === v);
}
function base64Decode(s, max) {
  if (typeof s !== 'string' || s.length > Math.ceil(max * 4 / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) {
    throw new Error('noncanonical base64');
  }
  const b = Buffer.from(s, 'base64');
  if (b.length > max || b.toString('base64') !== s) throw new Error('noncanonical base64');
  return b;
}
function pae(payloadType, payload) {
  const pt = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([Buffer.from('DSSEv1 ' + pt.length + ' '), pt,
    Buffer.from(' ' + payload.length + ' '), payload]);
}

// Must be called AFTER authenticating the tenant with the API. The returned
// upload token is NOT a signing key and must never be stored in an artifact.
export function issueBuildChallenge({tenantId, sourceCommit, toolchainSha256, target,
  ttlMs = 120_000, now = Date.now()} = {}) {
  if (!ID.test(tenantId ?? '') || !SHA1.test(sourceCommit ?? '') ||
      !HEX64.test(toolchainSha256 ?? '') || !TARGETS.has(target) ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1_000 || ttlMs > 300_000) throw new Error('invalid challenge request');
  const challenge = {schema: SCHEMA, challengeId: randomUUID(),
    nonce: randomBytes(32).toString('base64url'), tenantId,
    sourceCommit, toolchainSha256, target, expiresAt: now + ttlMs};
  const uploadToken = randomBytes(32).toString('base64url');
  return {challenge, uploadToken,
    serverRecord: {challenge: structuredClone(challenge),
      tokenSha256: sha256(Buffer.from(uploadToken)), consumed: false}};
}

export function makeBuildStatement({challenge, artifactBytes, deviceKeyId}) {
  if (!validChallenge(challenge) || !ID.test(deviceKeyId ?? '') ||
      !(artifactBytes instanceof Uint8Array) || artifactBytes.length > MAX_ARTIFACT_BYTES)
    throw new Error('invalid statement inputs');
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{name: 'artifact', digest: {sha256: sha256(artifactBytes)}}],
    predicateType: PREDICATE_TYPE,
    predicate: {
      // These are signed CLIENT CLAIMS, not evidence that compilation ran.
      builder: {id: 'oreslang/untrusted-device/v1', deviceKeyId},
      invocation: {...challenge}
    }
  };
}

// Reference client signer. Private key must NEVER be derived from uploadToken.
export function signBuildStatement(statement, privateKey, deviceKeyId) {
  if (!ID.test(deviceKeyId ?? '')) throw new Error('invalid signer ID');
  const payload = Buffer.from(JSON.stringify(statement), 'utf8');
  if (payload.length > MAX_ENVELOPE_BYTES) throw new Error('statement too large');
  const signature = sign(null, pae(DSSE_PAYLOAD_TYPE, payload), privateKey);
  return {payloadType: DSSE_PAYLOAD_TYPE, payload: payload.toString('base64'),
    signatures: [{keyid: deviceKeyId, sig: signature.toString('base64')}]};
}

// registeredPublicKey is looked up by the SERVER for this tenant/key ID; it
// must not come from the upload request. A positive result is QUARANTINE only.
export function verifyBuildSubmission({serverRecord, uploadToken, artifactBytes,
  envelope, registeredPublicKey, registeredKeyId, tenantId, now = Date.now()}) {
  const deny = reason => ({ok: false, disposition: 'REJECT', reason});
  try {
    if (!object(serverRecord) || !validChallenge(serverRecord.challenge) ||
        typeof serverRecord.tokenSha256 !== 'string' || !HEX64.test(serverRecord.tokenSha256) ||
        serverRecord.consumed) return deny('invalid-or-consumed-challenge');
    const c = serverRecord.challenge;
    if (!Number.isSafeInteger(now) || now >= c.expiresAt) return deny('expired');
    if (c.tenantId !== tenantId) return deny('tenant-mismatch');
    if (typeof uploadToken !== 'string' || uploadToken.length !== 43 ||
        !/^[A-Za-z0-9_-]{43}$/.test(uploadToken)) return deny('invalid-upload-token');
    const receivedHash = Buffer.from(sha256(Buffer.from(uploadToken)), 'hex');
    const storedHash = Buffer.from(serverRecord.tokenSha256, 'hex');
    if (!timingSafeEqual(receivedHash, storedHash)) return deny('invalid-upload-token');
    if (!(artifactBytes instanceof Uint8Array) || artifactBytes.length > MAX_ARTIFACT_BYTES)
      return deny('invalid-artifact');
    if (!ID.test(registeredKeyId ?? '') || !registeredPublicKey)
      return deny('unregistered-signer');
    if (!keys(envelope, ['payloadType','payload','signatures']) ||
        envelope.payloadType !== DSSE_PAYLOAD_TYPE ||
        !Array.isArray(envelope.signatures) || envelope.signatures.length !== 1)
      return deny('invalid-envelope');
    const sig = envelope.signatures[0];
    if (!keys(sig, ['keyid','sig']) || sig.keyid !== registeredKeyId)
      return deny('signer-mismatch');
    const payload = base64Decode(envelope.payload, MAX_ENVELOPE_BYTES);
    const signature = base64Decode(sig.sig, 128);
    if (signature.length !== 64) return deny('signature-invalid');
    const publicKey = registeredPublicKey?.type === 'public' ? registeredPublicKey : createPublicKey(registeredPublicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519' ||
        !verify(null, pae(DSSE_PAYLOAD_TYPE, payload), publicKey, signature))
      return deny('signature-invalid');
    const statement = JSON.parse(payload.toString('utf8'));
    if (!keys(statement, ['_type','subject','predicateType','predicate']) ||
        statement._type !== 'https://in-toto.io/Statement/v1' ||
        statement.predicateType !== PREDICATE_TYPE ||
        !Array.isArray(statement.subject) || statement.subject.length !== 1 ||
        !keys(statement.subject[0], ['name','digest']) ||
        statement.subject[0].name !== 'artifact' ||
        !keys(statement.subject[0].digest, ['sha256']) ||
        statement.subject[0].digest.sha256 !== sha256(artifactBytes))
      return deny('artifact-digest-mismatch');
    if (!keys(statement.predicate, ['builder','invocation']) ||
        !keys(statement.predicate.builder, ['id','deviceKeyId']) ||
        statement.predicate.builder.id !== 'oreslang/untrusted-device/v1' ||
        statement.predicate.builder.deviceKeyId !== registeredKeyId ||
        !equalRecord(c, statement.predicate.invocation))
      return deny('untrusted-claims-mismatch');
    return {ok: true, disposition: DISPOSITION, artifactSha256: sha256(artifactBytes),
      challengeId: c.challengeId};
  } catch {
    return deny('malformed-or-invalid-proof');
  }
}

// In-memory reference adapter only: synchronized in one Node process, NOT
// distributed-safe. Production MUST use a transaction/unique insert or CAS in
// a durable server-side datastore to consume a challenge exactly once.
export class InMemoryChallengeStore {
  #records = new Map();
  add(record) {
    if (!validChallenge(record?.challenge) || this.#records.has(record.challenge.challengeId))
      throw new Error('invalid or duplicate challenge');
    this.#records.set(record.challenge.challengeId, structuredClone(record));
  }
  verifyAndConsume(challengeId, request) {
    const record = this.#records.get(challengeId);
    const result = verifyBuildSubmission({...request, serverRecord: record});
    if (result.ok) record.consumed = true;
    return result;
  }
}
