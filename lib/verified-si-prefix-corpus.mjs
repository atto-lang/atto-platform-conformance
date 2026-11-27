// Exact SI decimal prefix guest census. File-local declarations, not a registered prelude.
// All scales are chained through legal signed-i64 factors; no enormous source literal.
export const siPrefixes=Object.freeze([
 ["Decameter","da",1],["Hectometer","h",2],["Kilometer","k",3],
 ["Megameter","M",6],["Gigameter","G",9],["Terameter","T",12],
 ["Petameter","P",15],["Exameter","E",18],["Zettameter","Z",21],
 ["Yottameter","Y",24],["Ronnameter","R",27],["Quettameter","Q",30],
 ["Decimeter","d",-1],["Centimeter","c",-2],["Millimeter","m",-3],
 ["Micrometer","µ",-6],["Nanometer","n",-9],["Picometer","p",-12],
 ["Femtometer","f",-15],["Attometer","a",-18],["Zeptometer","z",-21],
 ["Yoctometer","y",-24],["Rontometer","r",-27],["Quectometer","q",-30]
].map(Object.freeze));
const declarations=["define dimension Length;","define unit Meter: Length;"];
const rows=[];
const ok={kind:"value",decimal:"42"};
const deny=category=>({kind:"diagnostic",category});
const trap=category=>({kind:"arithmeticFailure",category});
for(const direction of [1,-1]){
 let previous="Meter", exponent=0;
 for(const [name,,power] of siPrefixes.filter(x=>Math.sign(x[2])===direction)){
   const ratio=10**Math.abs(power-exponent);
   declarations.push("define unit "+name+": Length = "+previous+(direction>0?" * ":" / ")+ratio+";");
   const from=direction>0?name:previous;
   const to=direction>0?previous:name;
   rows.push([name.toLowerCase(),"val a=42<"+from+">.to_unit<"+to+">(); return a/"+ratio+"<"+to+">;",ok]);
   previous=name;exponent=power;
 }
}
declarations.push("define dimension Time;","define unit Second: Time;","define dimension Mass;","define unit Kilogram: Mass;","define unit Gram: Mass = Kilogram / 1000;","define unit Microgram: Mass = Gram / 1000000;","define dimension Information;","define unit Bit: Information;","define unit Byte: Information = Bit * 8;","define unit Kilobyte: Information = Byte * 1000;","define unit Kibibyte: Information = Byte * 1024;","type PositiveInt = int where self > 0;","type NegativeInt = int where self < 0;");
rows.push(
 ["negative-scale","val a=-4200<Centimeter>.to_unit<Meter>(); return 0-a/1<Meter>;",ok],
 ["mass-gram-prefix","val a=42<Gram>.to_unit<Microgram>(); return a/1000000<Microgram>;",ok],
 ["binary-decimal","val a=42<Kibibyte>.to_unit<Byte>(); val b=42<Kilobyte>.to_unit<Byte>(); return (a-b)/24<Byte>;",ok],
 ["extreme-zero","val a=0<Quettameter>.to_unit<Quectometer>(); return a/1<Quectometer>+42;",ok],
 ["extreme-overflow","return 1<Quettameter>.to_unit<Quectometer>()/1<Quectometer>;",deny("E_UNIT_RANGE")],
 ["extreme-inexact","return 1<Quectometer>.to_unit<Quettameter>()/1<Quettameter>;",deny("E_UNIT_INEXACT")],
 ["cross-dimension","return 1<Quectometer>.to_unit<Second>()/1<Second>;",deny("E_UNIT_DIMENSION")],
 ["mixed-prefix","return (1<Ronnameter>+1<Quettameter>)/1<Quettameter>;",deny("E_UNIT_SCALE")],
 ["negative-overflow","return -9223372036854775808<Kilometer>.to_unit<Meter>()/1<Meter>;",deny("E_UNIT_RANGE")],
 ["residual-scale","return 1<Quettameter>/1<Quectometer>;",deny("E_UNIT_ERASURE")],
 ["divide-zero","val a=1<Quectometer>/0<Quectometer>; return 42;",trap("divisionByZero")],
 ["signed-min-divide","val a=-9223372036854775808<Quettameter>/-1<Quettameter>; return 42;",trap("integerOverflow")]
);
export const siPrefixCases=Object.freeze(rows.map(([id,body,expected])=>Object.freeze({source:"generated-binding-si-"+id+".atto",text:declarations.join("\n")+"\npub fnc main() -> int { "+body+" }\n",expected:Object.freeze(expected)})));
