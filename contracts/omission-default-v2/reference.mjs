// Source-free semantic oracle, not a compiler or guest execution.
import assert from 'node:assert/strict';
export const OMIT = Symbol('omitted');
export const NONE = Object.freeze({tag:'None'});
export const some = value => ({tag:'Some',value});
export function resolve(input, formal) {
  const omitted = input === OMIT;
  if (omitted && !formal.omittable) throw Error('REQUIRED');
  let value;
  if (omitted) {
    if (formal.omitted) value = formal.omitted();
    else if (formal.option) value = NONE;
    else throw Error('MISSING_DEFAULT');
  } else if (formal.option && input.tag === 'None' && formal.none) value = formal.none();
  else value = input;
  return {value, omitted};
}
export function select(candidates, args) {
  // Positional/hole, exact nominal types, no conversions/generics/named binding.
  const viable = candidates.filter(c => args.length <= c.types.length &&
    c.types.every((t,i) => i >= args.length || args[i] === OMIT
      ? c.omittable[i] : args[i] === t || (args[i] === 'untyped None' && t.startsWith('Option<'))));
  const exact = viable.filter(c => c.types.length === args.length && !args.includes(OMIT));
  const tier = exact.length ? exact : viable;
  if (tier.length !== 1) throw Error(tier.length ? 'AMBIGUOUS' : 'NO_MATCH');
  return tier[0].id;
}
export function check() {
  let n=0, o=0, checks=0;
  const f={option:true,omittable:true,none:()=>{n++;return some(3)},omitted:()=>{o++;return some(4)}};
  const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
  const err=(fn,msg)=>{assert.throws(fn,new RegExp(msg));checks++};
  eq(resolve(OMIT,f),{value:some(4),omitted:true});eq([n,o],[0,1]);
  eq(resolve(NONE,f),{value:some(3),omitted:false});eq([n,o],[1,1]);
  for(const v of [0,false,'',[],NONE,4]) {eq(resolve(some(v),f),{value:some(v),omitted:false});eq([n,o],[1,1]);}
  eq(resolve(OMIT,{...f,omitted:()=>NONE}),{value:NONE,omitted:true});eq([n,o],[1,1]);
  eq(resolve(OMIT,{option:true,omittable:true,none:f.none}),{value:NONE,omitted:true});eq([n,o],[1,1]);
  eq(resolve(NONE,{option:true,omittable:true}),{value:NONE,omitted:false});
  eq(resolve(OMIT,{option:false,omittable:true,omitted:()=>42}),{value:42,omitted:true});
  eq(resolve(42,{option:false,omittable:true,omitted:()=>42}),{value:42,omitted:false});
  err(()=>resolve(OMIT,{option:true,omittable:false}),'REQUIRED');
  err(()=>resolve(OMIT,{option:false,omittable:true}),'MISSING_DEFAULT');
  const c=(id,types,omittable)=>({id,types,omittable});
  const i=c('intOption',['Option<int>'],[true]), s=c('stringOption',['Option<string>'],[true]);
  for(const family of [[i,s],[s,i]]) {
    err(()=>select(family,[]),'AMBIGUOUS');err(()=>select(family,['untyped None']),'AMBIGUOUS');
    eq(select(family,['Option<int>']),'intOption');eq(select(family,['Option<string>']),'stringOption');
    err(()=>select(family,['int']),'NO_MATCH');err(()=>select(family,[OMIT]),'AMBIGUOUS');
  }
  const a=c('one',['int'],[false]), b=c('two',['int','int'],[false,true]), d=c('other',['string'],[false]), e=c('three',['int','string','int'],[false,true,true]);
  eq(select([a,b],['int']),'one');eq(select([d,b],['int']),'two');eq(select([a,b],['int','int']),'two');
  err(()=>select([b,e],['int']),'AMBIGUOUS');
  const middle=c('middle',['int','int','int'],[true,false,true]);
  err(()=>select([middle],['int']),'NO_MATCH');eq(select([middle],[OMIT,'int']),'middle');
  eq(select([c('zero',[],[]),i],[]),'zero');
  return checks;
}
console.log('reference assertions passed:',check());
