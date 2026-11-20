/**
 * Immutable admission snapshot for typed pipeline proposal v1.
 *
 * validatePipelineContract() is a non-authoritative linter over mutable input.
 * Consumers making authorization or construction decisions MUST use the returned
 * contract from admitPipelineContract(), never re-read the caller's graph.
 *
 * Input must be JSON-like own enumerable data objects/arrays. Proxies and mutable
 * shared host-realm intrinsics are outside this trust boundary.
 */
import {validatePipelineContract} from './pipeline-contract.mjs';

function deny() { throw new TypeError('noncanonical pipeline input'); }
const isPlain = x => x !== null && typeof x === 'object' &&
  !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

function copyRecord(value, keys, fieldMap) {
  if (!isPlain(value)) deny();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) deny();
  const result = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) deny();
    Object.defineProperty(result, key, {
      value:fieldMap[key](d.value), enumerable:true, writable:false, configurable:false
    });
  }
  return Object.freeze(result);
}
const primitive = v => {
  if (v !== null && !['string','number','boolean'].includes(typeof v)) deny();
  return v;
};
function copyList(value, min, max, map) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < min || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  const result=[];
  for (let i=0;i<value.length;i++) {
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d || !d.enumerable || !Object.hasOwn(d,'value')) deny();
    result.push(map(d.value));
  }
  return Object.freeze(result);
}
const stageKeys=['id','role','forwardIn','forwardOut','backwardIn','backwardOut'];
const edgeKeys=['from','to','forwardType','backwardType','capacity'];
const opKeys=['forward','backward'];
const semKeys=['forwardAcknowledges','backwardCorrelation','supervisorDataRouting','generationFencing','atomicPublication'];
const proposalKeys=['schemaVersion','kind','operations','semantics','stages','edges','confirmedBackends','pendingBackends'];
const stringFields=keys=>Object.fromEntries(keys.map(k=>[k,primitive]));
const copyStage=x=>copyRecord(x,stageKeys,stringFields(stageKeys));
const copyEdge=x=>copyRecord(x,edgeKeys,stringFields(edgeKeys));
const copyOps=x=>copyRecord(x,opKeys,stringFields(opKeys));
const copySem=x=>copyRecord(x,semKeys,stringFields(semKeys));
function copyProposal(value){
  return copyRecord(value,proposalKeys,{
    schemaVersion:primitive,kind:primitive,operations:copyOps,semantics:copySem,
    stages:x=>copyList(x,3,32,copyStage),
    edges:x=>copyList(x,2,31,copyEdge),
    confirmedBackends:x=>copyList(x,0,0,primitive),
    pendingBackends:x=>copyList(x,4,4,primitive)
  });
}
export function admitPipelineContract(source){
  try {
    const contract=copyProposal(source);
    const verdict=validatePipelineContract(contract);
    if(!verdict.ok)return verdict;
    return Object.freeze({ok:true,errors:Object.freeze([]),contract});
  } catch {
    return {ok:false,errors:['pipeline admission requires bounded own-data snapshot']};
  }
}
