/**
 * Mathematical reference for the candidate portable checked-i64 contract.
 * Not an Oreslang parser, compiler, Java execution, or parity attestation.
 * Accept only bounded JSON-decoded expression trees.
 */
export const I64_MIN=-(1n<<63n);
export const I64_MAX=(1n<<63n)-1n;
export const CHECKED_I64_CONTRACT='checked-i64-v1';

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
function record(value,fields) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     Object.getPrototypeOf(value)!==Object.prototype)
    throw TypeError('expected plain expression record');
  const keys=Object.keys(value);
  if(keys.some(k=>!fields.includes(k))||keys.length!==fields.length||
     fields.some(k=>!Object.hasOwn(value,k)))
    throw TypeError('invalid expression record fields');
}
export function evaluateCheckedI64(expr) {
  let nodes=0;
  function visit(node,depth) {
    if(depth>64||++nodes>256)throw RangeError('expression budget exceeded');
    if(node?.op==='literal') {
      record(node,['op','value']);
      if(typeof node.value!=='string'||node.value.length>64||
         !/^(0|-?[1-9][0-9]*)$/.test(node.value))
        throw TypeError('noncanonical signed decimal literal');
      return checkRange(BigInt(node.value));
    }
    record(node,['op','args']);
    if(!Array.isArray(node.args))throw TypeError('expected argument array');
    const arity=node.op==='neg'?1:2;
    if(!['neg','add','sub','mul','rem','div_trunc'].includes(node.op)||
       node.args.length!==arity)
      throw TypeError('unknown operation or arity');
    const args=node.args.map(x=>visit(x,depth+1));
    if(node.op==='neg')return checkRange(-args[0]);
    const [a,b]=args;
    switch(node.op) {
      case 'add':return checkRange(a+b);
      case 'sub':return checkRange(a-b);
      case 'mul':return checkRange(a*b);
      case 'rem':
        if(b===0n)fail('division_by_zero');
        // ECMAScript BigInt remainder uses truncation-toward-zero quotient.
        return checkRange(a%b);
      case 'div_trunc':
        // Abstract reference ONLY; Oreslang int/int / currently yields float.
        if(b===0n)fail('division_by_zero');
        return checkRange(a/b);
      default:throw TypeError('unknown operation');
    }
  }
  return visit(expr,0);
}
