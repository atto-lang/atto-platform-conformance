// Candidate file-local compound dimension grammar; not automatic SI registration.
const base="define dimension Length; define unit Meter: Length; define unit Centimeter: Length = Meter / 100; define dimension Time; define unit Second: Time; define dimension Mass; define unit Kilogram: Mass;";
const derived="define dimension Velocity = Length / Time; define unit MeterPerSecond: Velocity; define dimension Acceleration = Velocity / Time; define unit MeterPerSecondSquared: Acceleration; define dimension Force = Mass * Acceleration; define unit Newton: Force; define unit Kilonewton: Force = Newton * 1000; define dimension Energy = Force * Length; define unit Joule: Energy; define dimension Power = Energy / Time; define unit Watt: Power; define dimension Area = Length * Length; define unit SquareMeter: Area; define dimension Pressure = Force / Area; define unit Pascal: Pressure;";
const ok={kind:"value",decimal:"42"};
const deny=category=>({kind:"diagnostic",category});
const trap=category=>({kind:"arithmeticFailure",category});
const rows=[];
for(const [id,e] of [
 ["velocity","42<MeterPerSecond>/(1<Meter>/1<Second>)"],
 ["acceleration","42<MeterPerSecondSquared>/(1<Meter>/1<Second>/1<Second>)"],
 ["force","42<Newton>/(1<Kilogram>*1<Meter>/1<Second>/1<Second>)"],
 ["energy","42<Joule>/(1<Newton>*1<Meter>)"],
 ["power","42<Watt>/(1<Joule>/1<Second>)"],
 ["area","42<SquareMeter>/(1<Meter>*1<Meter>)"],
 ["pressure","42<Pascal>/(1<Newton>/1<SquareMeter>)"],
 ["scale","42<Kilonewton>.to_unit<Newton>()/1000<Newton>"],
 ["signed","0-(-42<Newton>/1<Newton>)"],
 ["add","(21<Newton>+21<Newton>)/1<Newton>"],
 ["sub","(84<Joule>-42<Joule>)/1<Joule>"],
 ["cancel","42<Newton>*1<Second>*1<Second>/1<Kilogram>/1<Meter>"],
 ["zero","0<Kilonewton>.to_unit<Newton>()/1<Newton>+42"],
 ["exact-down","42000<Newton>.to_unit<Kilonewton>()/1<Kilonewton>"],
 ["inverse","42<Newton>/1<Pascal>/1<SquareMeter>"],
 ["commute","42<Newton>/(1<Meter>*1<Kilogram>/1<Second>/1<Second>)"]
])rows.push([id,"return "+e+";",ok,derived]);
rows.push(
 ["typed","val a=42<Newton>; return a/1<Newton>;",ok,derived],
 ["typed-chain","val a=42<Newton>; val b=a*1<Meter>; return b/1<Joule>;",ok,derived],
 ["mixed","return (42<Newton>+1<Joule>)/1<Newton>;",deny("E_UNIT_DIMENSION"),derived],
 ["mixed-scale","return (42<Newton>+1<Kilonewton>)/1<Newton>;",deny("E_UNIT_SCALE"),derived],
 ["erase","return 42<Newton>;",deny("E_UNIT_ERASURE"),derived],
 ["residual-scale","return 42<Kilonewton>/1<Newton>;",deny("E_UNIT_ERASURE"),derived],
 ["inexact","return 1<Newton>.to_unit<Kilonewton>()/1<Kilonewton>;",deny("E_UNIT_INEXACT"),derived],
 ["overflow","return 9223372036854775807<Kilonewton>.to_unit<Newton>()/1<Newton>;",deny("E_UNIT_RANGE"),derived],
 ["wrong-conversion","return 1<Newton>.to_unit<Joule>()/1<Joule>;",deny("E_UNIT_DIMENSION"),derived],
 ["div-zero","val a=1<Newton>/0<Newton>; return 42;",trap("divisionByZero"),derived],
 ["signed-overflow","val a=9223372036854775807<Newton>+1<Newton>; return 42;",trap("integerOverflow"),derived],
 ["forward","return 42;",deny("E_UNIT_NAME"),"define dimension Force = Mass * Unknown;"],
 ["cycle","return 42;",deny("E_UNIT_NAME"),"define dimension Force = Mass * Force;"],
 ["dimensionless","return 42;",deny("E_UNIT_DIMENSION"),"define dimension Angle = Length / Length;"],
 ["same-vector","return 42;",deny("E_UNIT_DIMENSION"),"define dimension First = Length / Time; define dimension Other = Length / Time;"],
 ["base-vector","return 42;",deny("E_UNIT_DIMENSION"),"define dimension Other = Length * Time / Time;"],
 ["duplicate","return 42;",deny("E_UNIT_DUPLICATE"),"define dimension Force = Mass * Length; define unit First: Force; define unit Other: Force;"],
 ["wrong-scale","return 42;",deny("E_UNIT_DIMENSION"),"define dimension Force = Mass * Length; define unit Bad: Force = Meter * 2;"],
 ["exponent","return 42;",deny("E_UNIT_LIMIT"),"define dimension Huge = "+Array(65).fill("Length").join(" * ")+";"],
 ["factor-limit","return 42;",deny("E_UNIT_LIMIT"),"define dimension Huge = Length"+(" * Time / Time").repeat(64)+";"]
);
export const compoundDimensionCases=Object.freeze(rows.map(([id,body,expected,decl])=>Object.freeze({source:"generated-binding-compound-"+id+".atto",text:base+decl+" type Positive = int where self > 0; pub fnc main() -> int { "+body+" }\n",expected:Object.freeze(expected)})));
