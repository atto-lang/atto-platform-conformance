// Direct automatic refinement alias tests, no explicit unit/dimension/type declarations.
const ok=Object.freeze({kind:"value",decimal:"42"});
const deny=Object.freeze({kind:"diagnostic",category:"E_REFINEMENT_BINDING"});
const trap=Object.freeze({kind:"refinementFailure",category:"refinementViolation"});
const rows=[];
for(const width of ["Int","I32"]){
 for(const [kind,good,bad,expr] of [
  ["Positive","42","0","a"],
  ["Negative","-42","0","0-a"],
  ["NonNegative","0","-1","a+42"],
  ["NonPositive","0","1","42-a"]
 ]){
  const type=kind+width,id=type.toLowerCase();
  rows.push([id+"-prefix","val "+type+" a="+good+"; return "+expr+";",ok]);
  rows.push([id+"-colon","val a: "+type+"="+good+"; return "+expr+";",ok]);
  rows.push([id+"-deny","val "+type+" a="+bad+"; return 42;",deny]);
  // An actual canonical annotation selects the implicit prelude; the
  // deliberately unused cast must still trap at guest execution.
  // Postfix casts bind tighter than unary minus; explicitly cast the signed operand.
  rows.push([id+"-cast","val "+type+" a="+good+"; val b=("+bad+")::<"+type+">; return 42;",trap]);
 }
}
rows.push(
 ["positivei32-max","val PositiveI32 a=2147483647; return a-2147483605;",ok],
 ["negativei32-min","val NegativeI32 a=-2147483648; return a+2147483647+43;",ok],
 ["positiveint-max","val PositiveInt a=9223372036854775807; return a-9223372036854775765;",ok],
 ["negativeint-min","val NegativeInt a=-9223372036854775808; return a+9223372036854775807+43;",ok]
);
export const implicitRefinementCases=Object.freeze(rows.map(([id,body,expected])=>Object.freeze({source:"generated-binding-alias-"+id+".atto",text:"pub fnc main() -> int { "+body+" }\n",expected})));
