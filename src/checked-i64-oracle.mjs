/**
 * Pure mathematical reference for proposed checked-i64 semantics.
 * Not an Oreslang compiler, Java/Graal/LLVM execution or CI attestation.
 * Direct object APIs take locally trusted inert data; external/untrusted data
 * must enter via evaluateCheckedI64Json (bounded canonical JSON only).
 */
import {Buffer} from 'node:buffer';

export const I64_MIN=-(1n<<63n);
export const I64_MAX=(1n<<63n)-1n;
export const CHECKED_I64_CONTRACT='checked-i64-v1';
export const CHECKED_I64_SOURCE_DIRECTIVE='// oreslang:checked-i64-v1\n';
const MAX_DEPTH=64, MAX_NODES=256, MAX_JSON_BYTES=16384;
const OPS=new Set(['neg','add','sub','mul','rem','div_trunc']);
const SIGNS={add:'+',sub:'-',mul:'*',rem:'%'};

export class CheckedI64ContractError extends Error {
  constructor(code) {
    super(code);
    this.name='CheckedI64ContractError';
    this.code=code;
  }
}
const fail=code=>{throw new CheckedI64ContractError(code);};
function checkRange(n) {
  if(n<I64_MIN||n>I64_MAX)fail('integer_overflow');
  return n;
}

// Active descriptors are forbidden for trusted-object callers. Proxy traps
// cannot be excluded by reflective JS APIs: only use parsed JSON across a
// foreign trust boundary, never an arbitrary live Proxy or getter object.
function inertRecord(value,fields) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype)
    throw TypeError('expected plain expression record');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||
     keys.some(k=>typeof k!=='string'||!fields.includes(k)))
    throw TypeError('invalid expression record fields');
  const out=Object.create(null);
  for(const key of fields) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
      throw TypeError('non-inert expression record field');
    out[key]=d.value;
  }
  return out;
}
function inertArgs(value,arity) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
    throw TypeError('invalid expression argument array');
  // A Proxy .length get trap must not steer expression-tree admission.
  // Read one own native array length descriptor before checking slots.
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(length!==arity||Reflect.ownKeys(value).length!==arity+1)
    throw TypeError('invalid expression argument array');
  const out=[];
  for(let i=0;i<arity;i++){
    const d=Object.getOwnPropertyDescriptor(value,i);
    if(!d||!Object.hasOwn(d,'value')||!d.enumerable)
      throw TypeError('non-inert expression argument');
    out.push(d.value);
  }
  return out;
}
function boundedWalk(expr,visitor) {
  let nodes=0;
  function walk(node,depth) {
    if(depth>MAX_DEPTH||++nodes>MAX_NODES)
      throw RangeError('expression budget exceeded');
    // Read op using a descriptor rather than invoking a getter.
    if(node===null||typeof node!=='object'||Array.isArray(node)||
       Object.getPrototypeOf(node)!==Object.prototype)
      throw TypeError('expected plain expression record');
    const opDescriptor=Object.getOwnPropertyDescriptor(node,'op');
    if(!opDescriptor||!Object.hasOwn(opDescriptor,'value')||
       typeof opDescriptor.value!=='string')
      throw TypeError('invalid expression operator');
    const op=opDescriptor.value;
    if(op==='literal') {
      const {value}=inertRecord(node,['op','value']);
      if(typeof value!=='string'||value.length>64||
         !/^(0|-?[1-9][0-9]*)$/.test(value))
        throw TypeError('noncanonical signed decimal literal');
      return visitor.literal(value);
    }
    if(!OPS.has(op))throw TypeError('unknown operation');
    const {args}=inertRecord(node,['op','args']);
    const arity=op==='neg'?1:2;
    const children=inertArgs(args,arity).map(x=>walk(x,depth+1));
    return visitor.operation(op,children);
  }
  return walk(expr,0);
}
export function evaluateCheckedI64(expr) {
  return boundedWalk(expr,{
    literal:v=>checkRange(BigInt(v)),
    operation:(op,args)=>{
      if(op==='neg')return checkRange(-args[0]);
      const [a,b]=args;
      switch(op) {
        case 'add':return checkRange(a+b);
        case 'sub':return checkRange(a-b);
        case 'mul':return checkRange(a*b);
        case 'rem':
          if(b===0n)fail('division_by_zero');
          return checkRange(a%b);
        case 'div_trunc':
          // Abstract oracle only: source int/int / is floating, NOT truncating.
          if(b===0n)fail('division_by_zero');
          return checkRange(a/b);
        default:throw TypeError('unknown operation');
      }
    }
  });
}

// Deterministic fixture integrity witness: the guest source is derived from
// the same expression tree and cannot secretly execute a different program.
// null means that the abstract integer-quotient op has no Oreslang mapping.
export function renderCheckedI64GuestSource(expr,profile='portable-default') {
  if(profile!=='portable-default'&&profile!=='checked-i64-v1')
    throw TypeError('unsupported checked-i64 source profile');
  const code=boundedWalk(expr,{
    literal:v=>v,
    operation:(op,args)=>{
      if(op==='div_trunc'||args.includes(null))return null;
      if(op==='neg')return '(-'+args[0]+')';
      return '('+args[0]+' '+SIGNS[op]+' '+args[1]+')';
    }
  });
  return code===null?null:
    (profile==='checked-i64-v1'?CHECKED_I64_SOURCE_DIRECTIVE:'')+
    'pub fnc main(): int { return '+code+'; }\n';
}

// Strict text-only entry. Canonical JSON excludes duplicated fields, aliases
// and alternative encodings that could be parsed differently by other tools.
export function evaluateCheckedI64Json(text) {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_JSON_BYTES)
    throw TypeError('missing or oversized canonical JSON expression');
  let parsed;
  try {parsed=JSON.parse(text);}
  catch {throw TypeError('invalid JSON expression');}
  if(JSON.stringify(parsed)!==text)
    throw TypeError('noncanonical JSON expression');
  return evaluateCheckedI64(parsed);
}
