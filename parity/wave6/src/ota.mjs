/** Testable OTA protocol boundary, not a persistent bootloader or MQTT/CoAP stack. */
import { createHash, verify, timingSafeEqual } from 'node:crypto';

const die = message => { throw new Error('ota: '+message); };
const must = (ok, msg) => { if (!ok) die(msg); };
const isRecord = o => o !== null && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
function fields(o, expected) {
  must(isRecord(o) && Object.keys(o).length === expected.length && expected.every(k => Object.hasOwn(o,k)), 'schema fields differ');
  must(Reflect.ownKeys(o).length === expected.length && expected.every(k => Object.getOwnPropertyDescriptor(o,k)?.value !== undefined), 'accessor/symbol or missing value');
}
const hash = b => createHash('sha256').update(b).digest('hex');
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const nonce = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{12,64}$/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(x);
const num = x => Number.isSafeInteger(x) && x > 0;

export const OTA_FIELDS = Object.freeze(['schema','deviceId','target','version','previousVersion','sha256','bytes','nonce','expiresAtMs','keyId']);
export const BOOT_FIELDS = Object.freeze(['schema','deviceId','target','version','sha256','nonce','bootCounter']);

export function validateOtaManifest(m) {
  fields(m, OTA_FIELDS);
  must(m.schema === 1 && id(m.deviceId) && ['cortex-m3','rv32imac','linux-arm64'].includes(m.target), 'device/target/schema');
  must(num(m.version) && Number.isSafeInteger(m.previousVersion) && m.previousVersion >= 0 && m.previousVersion < m.version, 'bad monotonic versions');
  must(sha(m.sha256) && num(m.bytes) && m.bytes <= 16*1024*1024 && nonce(m.nonce) && num(m.expiresAtMs) && id(m.keyId), 'invalid signed envelope');
  return m;
}
export function validateBootReceipt(r) {
  fields(r, BOOT_FIELDS);
  must(r.schema === 1 && id(r.deviceId) && ['cortex-m3','rv32imac','linux-arm64'].includes(r.target) && num(r.version) && sha(r.sha256) && nonce(r.nonce) && num(r.bootCounter), 'invalid boot receipt');
  return r;
}
// Deterministic fixed-field JSON, independently reproducible in firmware.
export function canonicalOta(m) { validateOtaManifest(m); return Buffer.from(JSON.stringify(Object.fromEntries(OTA_FIELDS.map(k=>[k,m[k]]))),'utf8'); }
export function canonicalBoot(r) { validateBootReceipt(r); return Buffer.from(JSON.stringify(Object.fromEntries(BOOT_FIELDS.map(k=>[k,r[k]]))),'utf8'); }
function validSig(bytes,sig,key) {
  must(Buffer.isBuffer(sig) && sig.length===64, 'Ed25519 signature length');
  try { return verify(null,bytes,key,sig); } catch { return false; }
}

export class OtaStagingGate {
  #device;#target;#version;#counter;#firmware;#releaseKeys;#bootKey;#staged=null;#seen=new Set();
  constructor({deviceId,target,activeVersion=1,bootCounter=1,activeSha256,releaseKeys,deviceBootPublicKey}) {
    must(id(deviceId) && ['cortex-m3','rv32imac','linux-arm64'].includes(target), 'invalid device identity');
    must(num(activeVersion) && num(bootCounter) && sha(activeSha256), 'invalid active boot state');
    must(isRecord(releaseKeys) && Object.keys(releaseKeys).length>0 && Object.keys(releaseKeys).length<=8 && deviceBootPublicKey, 'trusted public keys required');
    this.#device=deviceId;this.#target=target;this.#version=activeVersion;this.#counter=bootCounter;this.#firmware=activeSha256;this.#releaseKeys=Object.freeze({...releaseKeys});this.#bootKey=deviceBootPublicKey;
  }
  stage(manifest,firmware,signature,{nowMs}={}) {
    validateOtaManifest(manifest);
    must(Buffer.isBuffer(firmware) && firmware.length===manifest.bytes, 'firmware length');
    must(Number.isSafeInteger(nowMs) && nowMs>=0 && nowMs<manifest.expiresAtMs, 'expired or invalid release time');
    must(this.#staged===null, 'existing staged update must be resolved');
    must(manifest.deviceId===this.#device && manifest.target===this.#target && manifest.previousVersion===this.#version && manifest.version>this.#version, 'wrong target or rollback');
    must(!this.#seen.has(manifest.nonce), 'replayed release nonce');
    must(timingSafeEqual(Buffer.from(hash(firmware),'hex'), Buffer.from(manifest.sha256,'hex')), 'firmware digest mismatch');
    const key=this.#releaseKeys[manifest.keyId]; must(key && validSig(canonicalOta(manifest),signature,key), 'untrusted release signature');
    this.#seen.add(manifest.nonce);
    this.#staged=Object.freeze({manifest:Object.freeze({...manifest}),firmwareHash:manifest.sha256});
    return Object.freeze({status:'STAGED_UNCOMMITTED',version:manifest.version,signatureValidated:true,persistentRecoveryProven:false});
  }
  commit(bootReceipt,signature) {
    validateBootReceipt(bootReceipt);
    const staged=this.#staged; must(staged!==null, 'no staged update');
    must(bootReceipt.deviceId===this.#device && bootReceipt.target===this.#target && bootReceipt.version===staged.manifest.version && bootReceipt.sha256===staged.firmwareHash && bootReceipt.nonce===staged.manifest.nonce && bootReceipt.bootCounter>this.#counter, 'boot receipt does not bind staged release');
    must(validSig(canonicalBoot(bootReceipt),signature,this.#bootKey), 'boot proof signature invalid');
    this.#version=bootReceipt.version;this.#firmware=bootReceipt.sha256;this.#counter=bootReceipt.bootCounter;this.#staged=null;
    return Object.freeze({status:'COMMITTED_AFTER_SIGNED_BOOT_RECEIPT',version:this.#version,realDeviceBootProven:false});
  }
  abort() { const s=this.#staged;this.#staged=null;return s!==null; }
  get state(){return Object.freeze({deviceId:this.#device,target:this.#target,version:this.#version,bootCounter:this.#counter,sha256:this.#firmware,stagedVersion:this.#staged?.manifest.version??null,nonceCount:this.#seen.size});}
}
