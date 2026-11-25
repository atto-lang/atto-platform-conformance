#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const BACKENDS = Object.freeze(['java','llvm','net','wasm','forge','cranelift','rs','js','hdl','atto','realtime']);
export const CASE_IDS = Object.freeze([
  'director-one-for-one-restart','director-one-for-all-restart','director-rest-for-one-restart',
  'director-intensity-quarantine','director-panic-control-only','director-nested-supervision',
  'director-startup-rollback','director-generation-fence','ensemble-multi-group-membership',
  'ensemble-membership-is-not-subscription','ensemble-typed-fanout',
  'ensemble-cross-group-isolation','ensemble-bounded-backpressure',
  'ensemble-revoke-unsubscribe','ensemble-group-retirement',
  'ensemble-teardown-no-reentrant-lock','runtime-mailbox-admission',
  'runtime-control-data-separation','theater-app-lifecycle','theater-no-leaked-tickets',
  'ensemble-share-bang-checked',
  'ensemble-share-bang-reject',
  'ensemble-try-publish-typed-receipt',
  'ensemble-try-publish-full-rollback',
  'ensemble-try-publish-authentication',
  'ensemble-dedicated-subscription-order',
  'ensemble-result-question-cleanup',
  'ensemble-unsupported-profile-denial'
]);
const NEGATIVE_CASES = new Set([
  'director-intensity-quarantine','director-panic-control-only','director-startup-rollback',
  'director-generation-fence','ensemble-membership-is-not-subscription',
  'ensemble-cross-group-isolation','ensemble-bounded-backpressure',
  'ensemble-revoke-unsubscribe','ensemble-group-retirement',
  'ensemble-teardown-no-reentrant-lock','runtime-control-data-separation',
  'theater-no-leaked-tickets',
  'ensemble-share-bang-reject',
  'ensemble-try-publish-full-rollback',
  'ensemble-try-publish-authentication',
  'ensemble-unsupported-profile-denial'
]);
const REQUIRED_EVIDENCE = [
  'exact-compiler-head-and-tree','same-source-guest-fixtures',
  'successful-nonzero-step-job','compiler-generated-guest-artifact',
  'actual-guest-execution','positive-and-negative-case-assertions',
  'independent-provenance-validation',
  'portable-ensemble-share-bang-try-publish-guest-fixtures'
];
const DISALLOWED_EVIDENCE = [
  'host-model-only','parser-only','interpreter-image-standing-in-for-guest-AOT',
  'zero-step-actions','self-attested-pass-without-verified-GitHub-job',
  'legacy-async-publish-substituted-for-try-publish'
];
const sha40 = /^[0-9a-f]{40}$/;
const sha64 = /^[0-9a-f]{64}$/;
const exactSha = (pattern, value) => typeof value === 'string' && pattern.test(value);
const exactArray = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && expected.every((x,i)=>actual[i]===x);
const CASE_ASSERTIONS = Object.freeze([
  "Failed child restarts without replacing unrelated children",
  "All child incarnations restart in deterministic order",
  "Failed child and later siblings restart, earlier siblings survive",
  "Bounded restart budget fences crash loops and escalates",
  "A panicking actor cannot intercept or forge its supervisor CONTROL notice",
  "Nested supervisor failure propagates with stable identities and bounded cleanup",
  "Partial child-start failure rolls back and releases resources",
  "Stale actor incarnation and restart acknowledgments are denied",
  "One actor may join two authorized groups independently",
  "Group membership alone never delivers topic DATA",
  "An explicitly subscribed actor receives matching typed DATA once",
  "Unprivileged cross-group publish and subscribe fail closed",
  "Full recipient mailbox denies RELIABLE admission atomically with no partial fanout",
  "Revocation and unsubscribe prevent future delivery and quiesce in-flight delivery",
  "Group retirement and reincarnation invalidate stale grants",
  "Group/channel cleanup and callbacks do not run under registry/topic locks",
  "Actor message admission and completion honor bounded mailbox limits",
  "User DATA cannot impersonate priority supervisor CONTROL",
  "Application starts supervised children and shuts down in deterministic order",
  "Cancellation, crash and shutdown release every lifecycle and message ticket",
  "Actual .atto actor publisher compiles share! event and rt share event through the same checked immutable Share proof, evaluating payload once",
  "Reject whitespace-split share !event, borrowed or mutable nonshareable payloads, forged ownership, and post-share use-after-move",
  "An authorized RELIABLE publisher compiles and executes Topic<T>.try_publish(share! event) and observes typed Result<PublishReceipt,PublishError> with correct per-topic sequence and admission counts, never processing ack",
  "When any RELIABLE subscriber has no immediately free queue capacity, Topic<T>.try_publish returns typed Full without enqueuing a pending writer, consuming another actor's admission credit, partially delivering to other subscribers, or advancing the unsigned u64 topic sequence",
  "Reject stale incarnation, revoked membership, forged group/topic/publisher grant, cross-group publication and incompatible payload type before delivery",
  "Subscription.next and try_read use dedicated bounded queues ordered by topic sequence; publication cannot silently inject ordinary actor DATA",
  "Inside an eligible Result-returning actor callable, postfix ? propagates the original PublishError from try_publish, performs defer/finally cleanup exactly once and preserves typed success receipt",
  "Unsupported publication policies, topic payload profiles or effects fail at source admission before executable artifact emission; implemented RELIABLE core remains accepted and unimplemented core is never certified"
]);
const PLATFORM = Object.freeze({
  "theater": "OTP-style application framework",
  "director": "supervision and lifecycle policies",
  "ensemble": "actor groups and typed topics with explicit subscriptions",
  "runtime": "scheduler, actor identity, mailbox admission and authenticated CONTROL"
});
const isPlainObject = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const isPositive = n => Number.isSafeInteger(n) && n > 0;

export function validateTheaterContract(c) {
  const errors=[];
  if (!isPlainObject(c) || c.schema !== 'atto.theater-contract/1' || c.revision !== 2) return ['invalid contract identity'];
  if (!isPlainObject(c.backends) || Object.keys(c.backends).length !== BACKENDS.length ||
      BACKENDS.some(b=>c.backends[b] !== `atto-lang/atto-source.${b}`)) errors.push('backend registry mismatch');
  if (!Array.isArray(c.cases) || c.cases.length !== CASE_IDS.length ||
      c.cases.some((x,i)=>!isPlainObject(x) || x.id !== CASE_IDS[i] ||
      x.subsystem !== (i<8?'director':i<16||i>=20?'ensemble':i<18?'runtime':'theater') ||
      x.kind !== (NEGATIVE_CASES.has(x.id)?'negative':'positive') ||
      x.assertion !== CASE_ASSERTIONS[i]))
    errors.push('canonical case registry mismatch or downgrade');
  if (!exactArray(c.bootstrapOnlyAtStart, ['atto','realtime']))
    errors.push('bootstrap scope mismatch');
  if (!isPlainObject(c.ensemblePublication) ||
      c.ensemblePublication.source !== 'val receipt = topic.try_publish(share! event)?' ||
      c.ensemblePublication.aliasedReceiverSource !==
        'val receipt = local_topic.try_publish(share! event)?' ||
      c.ensemblePublication.unsupportedAliasDisposition !==
        'reject-before-guest-artifact-until-typed-receiver-ownership-and-result-lowering' ||
      c.ensemblePublication.legacyOperand !== 'rt share event' ||
      c.ensemblePublication.typing !== 'Result<PublishReceipt, PublishError>' ||
      c.ensemblePublication.resultQuestionScope !==
        'Result-returning callable within authenticated actor turn; no automatic ? in void callbacks' ||
      c.ensemblePublication.topicSequenceWidth !== 'unsigned-u64' ||
      c.ensemblePublication.topicSequenceFirst !== '1' ||
      c.ensemblePublication.topicSequenceRefusalSentinel !== '0' ||
      c.ensemblePublication.topicSequenceWire !== 'unsigned-decimal' ||
      c.ensemblePublication.topicSequenceExhaustion !==
        'hard-error-before-Full-at-uint64-max; never wrap, reuse zero, or reserve pending credit' ||
      c.ensemblePublication.receiptVersion !== 'atto.theater-guest-receipt/1' ||
      c.ensemblePublication.targetStatus !== 'NOT_EXECUTED' ||
      c.ensemblePublication.ownership !== "Once-only operand evaluation; copyable immutable Share proof; no false move, credit or sequence consumption on rejected admission" ||
      c.ensemblePublication.queue !== "Dedicated Subscription<T>.next()/try_read(), never implicit DATA injection" ||
      c.ensemblePublication.semantics !== "RELIABLE atomic bounded per-subscriber reserve; receipt is admission, not processing")
    errors.push('canonical share! try_publish contract missing or weakened');
  if (c.evidence !== 'compiled-atto-guest-required' || !isPlainObject(c.platform) ||
      Object.keys(PLATFORM).some(k=>c.platform[k] !== PLATFORM[k]))
    errors.push('platform layer identity mismatch');
  if (!exactArray(c.requiredEvidence, REQUIRED_EVIDENCE) ||
      !exactArray(c.disallowedEvidence, DISALLOWED_EVIDENCE))
    errors.push('evidence gate weakened');
  return errors;
}

// This is deliberately a *candidate* shape check, never an authentication service.
// Caller must independently fetch GitHub Actions job/run, source blobs and target output.
export function validateGuestReceipt(receipt, contract) {
  const errors=validateTheaterContract(contract);
  if (errors.length) return {status:'rejected',errors};
  const fail=(condition,reason)=>{if(!condition)errors.push(reason);};
  if (!isPlainObject(receipt)) return {status:'rejected',errors:[...errors,'receipt must be a plain object']};
  fail(receipt.schema==='atto.theater-guest-receipt/1','receipt schema invalid');
  const b=receipt.backend;
  const known=typeof b==='string' && BACKENDS.includes(b);
  fail(known,'unknown backend');
  fail(known && receipt.repository===contract.backends?.[b],'backend repository mismatch');
  const compiler=receipt.compiler, fixture=receipt.fixture, run=receipt.run, guest=receipt.guest;
  fail(isPlainObject(compiler),'compiler evidence missing');
  fail(isPlainObject(fixture),'fixture evidence missing');
  fail(isPlainObject(run),'job evidence missing');
  fail(isPlainObject(guest),'guest execution evidence missing');
  if (isPlainObject(compiler)) {
    fail(exactSha(sha40, compiler.sourceHeadSha),'compiler HEAD must be lowercase 40-hex SHA');
    fail(exactSha(sha40, compiler.sourceTreeSha),'compiler tree must be lowercase 40-hex SHA');
    fail(exactSha(sha64, compiler.binarySha256),'compiler artifact SHA256 missing');
    fail(['jit','native-aot','wasm-aot','hardware'].includes(compiler.mode),'compiler mode unsupported');
  }
  if (isPlainObject(fixture)) {
    fail(exactSha(sha40, fixture.gitBlobSha),'fixture Git blob missing');
    fail(exactSha(sha64, fixture.sourceSha256),'fixture source digest missing');
    fail(fixture.language==='atto','fixture must be canonical AttoLang source');
  }
  if (isPlainObject(run)) {
    fail(isPositive(run.id) && isPositive(run.jobId) && isPositive(run.runnerId),'CI run/job/runner identifiers missing');
    fail(run.status==='completed' && run.conclusion==='success','CI not successful');
    fail(isPositive(run.executedSteps),'CI has zero executed steps');
    fail(exactSha(sha40, run.headSha) && run.headSha===compiler?.sourceHeadSha,'CI HEAD does not match compiler source');
    fail(known && run.url===`https://github.com/${contract.backends[b]}/actions/runs/${run.id}`,'CI run URL or repository mismatch');
  }
  if (isPlainObject(guest)) {
    fail(guest.compilerGenerated===true && guest.executedOnTarget===true && guest.hostModelOnly===false,
      'host/interpreter/parser evidence cannot substitute for compiled guest');
    fail(Array.isArray(guest.cases),'case results missing');
    if (Array.isArray(guest.cases)) {
      const seen=new Set();
      fail(guest.cases.length===CASE_IDS.length,'required case count mismatch');
      for (const c of guest.cases) {
        if (!isPlainObject(c) || !CASE_IDS.includes(c.id) || seen.has(c.id) ||
            c.status!=='pass' || c.mode!=='compiled-guest' || !isPositive(c.assertions)) {
          errors.push('unexecuted, duplicate, unknown or failed guest case');
          continue;
        }
        seen.add(c.id);
      }
      for (const id of CASE_IDS) if (!seen.has(id)) errors.push(`missing guest case ${id}`);
    }
  }
  return {status:errors.length ? 'rejected' : 'candidate-only',errors};
}

export function auditParityIndex(index, contract) {
  const contractErrors=validateTheaterContract(contract);
  if (contractErrors.length) return {status:'invalid-contract',errors:contractErrors,backends:{}};
  if (!isPlainObject(index) || index.schema !== 'atto.theater-receipt-index/1' || !Array.isArray(index.receipts))
    return {status:'invalid-index',errors:['invalid index schema'],backends:{}};
  const results=Object.fromEntries(BACKENDS.map(b=>[b,{status:'not-executed'}]));
  const errors=[];
  const seen=new Set();
  for (const receipt of index.receipts) {
    if (!isPlainObject(receipt) || !BACKENDS.includes(receipt.backend) || seen.has(receipt.backend)) {
      errors.push('duplicate or unknown backend in receipt index');
      continue;
    }
    seen.add(receipt.backend);
    const r=validateGuestReceipt(receipt,contract);
    results[receipt.backend]={status:r.status,...(r.errors.length?{errors:r.errors}:{})};
    if (r.errors.length) errors.push(...r.errors.map(e=>`${receipt.backend}: ${e}`));
  }
  // 'candidate-only' must NEVER be promoted to certified through this file or a CI boolean.
  return {status:errors.length?'invalid-evidence':'not-certified',errors,backends:results};
}

const here=path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const base=path.resolve(here,'..');
  const contract=JSON.parse(fs.readFileSync(path.join(base,'contracts/atto-theater-v1.json'),'utf8'));
  const index=JSON.parse(fs.readFileSync(path.join(base,'verification/atto-theater-v1.receipts.json'),'utf8'));
  const audit=auditParityIndex(index,contract);
  for(const [b,r] of Object.entries(audit.backends)) console.log(`${b}: ${r.status}`);
  console.log(`ATTO_THEATER_GUEST_PARITY=${audit.status.toUpperCase().replaceAll('-','_')}`);
  if (audit.errors.length) {
    console.error(audit.errors.join('\n'));
    process.exitCode=1;
  }
  if (process.argv.includes('--require-certified')) {
    console.error('CERTIFICATION_UNAVAILABLE: independent authenticated GitHub run and artifact validation required');
    process.exitCode=1;
  }
}
