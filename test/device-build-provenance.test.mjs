import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {issueBuildChallenge, makeBuildStatement, signBuildStatement,
  verifyBuildSubmission, InMemoryChallengeStore, DISPOSITION
} from '../src/device-build-provenance.mjs';

const now = 1_800_000_000_000;
const sourceCommit = 'a'.repeat(40);
const toolchainSha256 = 'b'.repeat(64);
const deviceKeyId = 'tenant-device-01';
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const {publicKey: outsiderKey} = generateKeyPairSync('ed25519');
const artifactBytes = Buffer.from('untrusted fixture bytes: NOT a real compiler output');
function setup(changes = {}) {
  const issued = issueBuildChallenge({tenantId: 'tenant-A', sourceCommit, toolchainSha256,
    target: 'llvm', now});
  const statement = makeBuildStatement({challenge: issued.challenge, artifactBytes, deviceKeyId});
  const envelope = signBuildStatement(statement, privateKey, deviceKeyId);
  return {issued, statement, envelope, args: {
    serverRecord: issued.serverRecord, uploadToken: issued.uploadToken, artifactBytes,
    envelope, registeredPublicKey: publicKey, registeredKeyId: deviceKeyId,
    tenantId: 'tenant-A', now: now + 1_000, ...changes}};
}
function reject(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.disposition, 'REJECT');
  if (reason) assert.equal(result.reason, reason);
}
test('valid device-signed bytes are QUARANTINED, never release-trusted', () => {
  const {args} = setup();
  assert.deepEqual(verifyBuildSubmission(args), {
    ok: true, disposition: DISPOSITION,
    artifactSha256: '56747e515d66f9e94ab0fcb053e17be9f164870ccedcef9cbd78a672479bc17a',
    challengeId: args.serverRecord.challenge.challengeId
  });
});
test('rejects tampered artifact bytes', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, artifactBytes: Buffer.from('other bytes')}), 'artifact-digest-mismatch');
});
test('rejects different tenant', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, tenantId: 'tenant-B'}), 'tenant-mismatch');
});
test('rejects token substitution even with a valid signature', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, uploadToken: 'z'.repeat(43)}), 'invalid-upload-token');
});
test('expires at exact boundary', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, now: args.serverRecord.challenge.expiresAt}), 'expired');
});
test('rejects unknown or substituted device identity', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, registeredKeyId: 'other'}), 'signer-mismatch');
  reject(verifyBuildSubmission({...args, registeredPublicKey: outsiderKey}), 'signature-invalid');
  reject(verifyBuildSubmission({...args, registeredPublicKey: undefined}), 'unregistered-signer');
});
test('rejects changed challenge and source even when client re-signs', () => {
  const {issued, args} = setup();
  const bogus = {...issued.challenge, sourceCommit: 'f'.repeat(40)};
  const forged = signBuildStatement(makeBuildStatement({challenge: bogus, artifactBytes, deviceKeyId}),
    privateKey, deviceKeyId);
  reject(verifyBuildSubmission({...args, envelope: forged}), 'untrusted-claims-mismatch');
});
test('rejects changed target and toolchain in client-signed statement', () => {
  const {issued, args} = setup();
  for (const changed of [{target:'java'}, {toolchainSha256:'c'.repeat(64)},
    {nonce:'z'.repeat(43)}, {challengeId:'b'.repeat(36)}]) {
    const forged = signBuildStatement(makeBuildStatement({
      challenge:{...issued.challenge, ...changed}, artifactBytes, deviceKeyId}), privateKey, deviceKeyId);
    reject(verifyBuildSubmission({...args, envelope: forged}), 'untrusted-claims-mismatch');
  }
});
test('rejects tampered DSSE signature and untrusted high-assurance claims', () => {
  const {args, statement} = setup();
  const altered = structuredClone(args.envelope);
  altered.signatures[0].sig = Buffer.alloc(64).toString('base64');
  reject(verifyBuildSubmission({...args, envelope: altered}), 'signature-invalid');
  const forgedStatement = structuredClone(statement);
  forgedStatement.predicate.builder.id = 'slsa-level-3';
  const forged = signBuildStatement(forgedStatement, privateKey, deviceKeyId);
  reject(verifyBuildSubmission({...args, envelope: forged}), 'untrusted-claims-mismatch');
});
test('rejects malformed and multi-signature envelopes', () => {
  const {args} = setup();
  reject(verifyBuildSubmission({...args, envelope: {}}), 'invalid-envelope');
  reject(verifyBuildSubmission({...args, envelope: {
    ...args.envelope, signatures: [...args.envelope.signatures, ...args.envelope.signatures]
  }}), 'invalid-envelope');
  reject(verifyBuildSubmission({...args, envelope: {...args.envelope, payload: '!!'}}), 'malformed-or-invalid-proof');
});
test('replay is rejected after single successful quarantine admission', () => {
  const {issued,args} = setup();
  const store = new InMemoryChallengeStore();
  store.add(issued.serverRecord);
  assert.equal(store.verifyAndConsume(issued.challenge.challengeId, args).disposition, DISPOSITION);
  reject(store.verifyAndConsume(issued.challenge.challengeId, args), 'invalid-or-consumed-challenge');
});
test('failed attempts do not consume the challenge', () => {
  const {issued,args} = setup();
  const store = new InMemoryChallengeStore();
  store.add(issued.serverRecord);
  reject(store.verifyAndConsume(issued.challenge.challengeId, {...args, uploadToken: 'z'.repeat(43)}));
  assert.equal(store.verifyAndConsume(issued.challenge.challengeId, args).ok, true);
});
test('validate requests fail closed', () => {
  assert.throws(() => issueBuildChallenge({tenantId:'a',sourceCommit,toolchainSha256,
    target:'llvm', ttlMs: 400_000, now}));
  assert.throws(() => issueBuildChallenge({tenantId:'a',sourceCommit,toolchainSha256,
    target:'unknown', now}));
  assert.throws(() => makeBuildStatement({challenge: {}, artifactBytes, deviceKeyId}));
});
