// Shared portable immutable quantity/refinement source corpus.
// Expected results are normative test requirements, not execution receipts.
export const pre = "define dimension Time; define dimension Length; define unit Second: Time; define unit Meter: Length; define unit Millis: Time = Second / 1000; type Positive = int where self > 0 and units in Second; type Bounded = int where self >= 1 and self <= 42;";
const ok={kind:"value",decimal:"42"};
const trap=category=>({kind:category==="refinementViolation"?"refinementFailure":"arithmeticFailure",category});
const deny=category=>({kind:"diagnostic",category});
const rows=[
 ["inferred","val a = 42<Second>; return a/1<Second>;",ok],
 ["prefix","val Positive a = 42<Second>; return a/1<Second>;",ok],
 ["colon","val a: Positive = 42<Second>; return a/1<Second>;",ok],
 ["convert","val a = 42000<Millis>.to_unit<Second>(); val Positive b=a; return b/1<Second>;",ok],
 ["reuse","val a=21<Second>; return (a+a)/1<Second>;",ok],
 ["proof","val Bounded a=40+2; return a;",ok],
 ["read-metadata","val a=42; val b=a.<Second>; return b/1<Second>+a-a;",ok],
 ["cast-proof","val a=1::<Bounded>; val Bounded b=a; return b+41;",ok],
 ["unused-refine","val a=43::<Bounded>; return 42;",trap("refinementViolation")],
 ["unused-div","val unused=1<Second>/0<Second>; return 42;",trap("divisionByZero")],
 ["first-refine","val first=43::<Bounded>; val second=9223372036854775807+1; return 42;",trap("refinementViolation")],
 ["first-overflow","val first=9223372036854775807+1; val second=43::<Bounded>; return 42;",trap("integerOverflow")],
 ["erasure","val a=42<Second>; return a;",deny("E_UNIT_ERASURE")],
 ["wrong-dimension","val a=42<Second>; val int b=a; return b;",deny("E_UNIT_DIMENSION")],
 ["nonpositive","val Positive a=0<Second>; return 42;",deny("E_REFINEMENT_BINDING")],
 ["wrong-scale","val Positive a=42<Millis>; return 42;",deny("E_UNIT_SCALE")],
 ["unproved","val Bounded a=43; return a;",deny("E_REFINEMENT_BINDING")],
 ["forward","val a=b; val b=42; return a;",deny(null)],
 ["self","val a=a; return a;",deny(null)],
 ["duplicate","val a=1; val a=42; return a;",deny(null)],
 ["mutation","val a=42; a=0; return a;",deny(null)],
 ["attach-return","val a=42; return a.<Second>;",deny("E_UNIT_ERASURE")],
 ["reserved","val self=42; return self;",deny(null)],
 ["dynamic-conversion","val a=42<Second>; return a.to_unit<Millis>()/1<Millis>;",deny(null)]
];
export const typedBindingCases=Object.freeze(rows.map(([id,body,expected])=>Object.freeze({source:"generated-binding-"+id+".atto",text:pre+"\npub fnc main() -> int { "+body+" }\n",expected:Object.freeze(expected)})));
