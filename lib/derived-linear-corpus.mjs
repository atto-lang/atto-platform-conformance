import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
// Independent base-unit products, not expressions copied from catalog definitions.
const rows=[
 ["Hertz","1<Second>/1<Second>/1<Second>"],
 ["Newton","1<Kilogram>*1<Meter>/1<Second>/1<Second>"],
 ["Pascal","1<Kilogram>/1<Meter>/1<Second>/1<Second>"],
 ["Joule","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>"],
 ["Watt","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>/1<Second>"],
 ["Coulomb","1<Ampere>*1<Second>"],
 ["Volt","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>/1<Second>/1<Ampere>"],
 ["Farad","1<Ampere>*1<Ampere>*1<Second>*1<Second>*1<Second>*1<Second>/1<Kilogram>/1<Meter>/1<Meter>"],
 ["Ohm","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>/1<Second>/1<Ampere>/1<Ampere>"],
 ["Siemens","1<Ampere>*1<Ampere>*1<Second>*1<Second>*1<Second>/1<Kilogram>/1<Meter>/1<Meter>"],
 ["Weber","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>/1<Ampere>"],
 ["Tesla","1<Kilogram>/1<Second>/1<Second>/1<Ampere>"],
 ["Henry","1<Kilogram>*1<Meter>*1<Meter>/1<Second>/1<Second>/1<Ampere>/1<Ampere>"],
 ["Lux","1<Candela>/1<Meter>/1<Meter>"],
 ["Gray","1<Meter>*1<Meter>/1<Second>/1<Second>"],
 ["Katal","1<Mole>/1<Second>"]
];
export function derivedLinearCases(){
 const base=readFileSync(process.env.ATTO_CANONICAL_MEASURE_SOURCE);
 assert.equal(base.length,3072);
 assert.equal(createHash("sha256").update(base).digest("hex"),"a411966eb3188104cd13cc2201b4d1d0de1e12404378aba313b396ae726a3376");
 const extension=readFileSync(process.env.ATTO_DERIVED_LINEAR_SOURCE,"utf8");
 const split=base.toString("utf8").indexOf("type PositiveInt");
 assert.ok(split>0);
 const pre=base.toString("utf8").slice(0,split)+extension+"\n"+base.toString("utf8").slice(split);
 const ok={kind:"value",decimal:"42"},deny=category=>({kind:"diagnostic",category});
 const cases=[];
 const add=(id,body,expected)=>cases.push({source:"generated-binding-derived-"+id+".atto",text:pre+"\npub fnc main() -> int { "+body+" }\n",expected});
 for(const [unit,expr] of rows){
  add(unit.toLowerCase()+"-identity","val a=42<"+unit+">; return a/1<"+unit+">;",ok);
  add(unit.toLowerCase()+"-vector","return 42<"+unit+">/("+expr+");",ok);
 }
 add("mixed","return (42<Newton>+1<Joule>)/1<Newton>;",deny("E_UNIT_DIMENSION"));
 add("erase","return 42<Newton>;",deny("E_UNIT_ERASURE"));
 add("residual-scale","return 42<Joule>/(1<Newton>*1<Centimeter>);",deny("E_UNIT_ERASURE"));
 add("conversion","return 1<Newton>.to_unit<Joule>()/1<Joule>;",deny("E_UNIT_DIMENSION"));
 return cases;
}
