// Shared restricted private typed helper source cases. No execution claim.
const pre = "define dimension Time; define dimension Length; define unit Second: Time; define unit Meter: Length; define unit Millis: Time = Second / 1000; type Positive = int where self > 0 and units in Second; type Bounded = int where self >= 1 and self <= 42; type Duration = int where units in Second;";
const ok={kind:"value",decimal:"42"};
const trap=category=>({kind:category==="refinementViolation"?"refinementFailure":"arithmeticFailure",category});
const deny=category=>({kind:"diagnostic",category});
const main=e=>"pub fnc main() -> int { return "+e+"; }";
const id="fnc identity(Bounded n) -> Bounded { return n; } ";
const tag="fnc tag(int n) -> Duration { return n.<Second>; } ";
const choose="fnc choose(int a, int b) -> int { return a; } ";
const narrow="fnc narrow(int n) -> Bounded { return n::<Bounded>; } ";
const rows=[
 ["scalar",id+main("identity(42)"),ok],
 ["inferred-proof",id+"pub fnc main() -> int { val a=40+2; return identity(a); }",ok],
 ["tag",tag+main("tag(42)/1<Second>"),ok],
 ["quantity","fnc pass(Positive n) -> Positive { return n; } "+main("pass(42<Second>)/1<Second>"),ok],
 ["nested",id+"fnc chain(Bounded n) -> Bounded { return identity(n); } "+main("chain(42)"),ok],
 ["repeat","fnc twice(int n) -> int { return n+n; } "+main("twice(21)"),ok],
 ["two-args",choose+main("choose(42,0)"),ok],
 ["helper-local","fnc f(Bounded n) -> Bounded { val Bounded a=n; return a; } "+main("f(42)"),ok],
 ["checked-return",narrow+main("narrow(42)"),ok],
 ["failed-return",narrow+main("narrow(43)"),trap("refinementViolation")],
 ["unused-argument",choose+main("choose(42,1<Second>/0<Second>)"),trap("divisionByZero")],
 ["first-argument",choose+main("choose(43::<Bounded>,9223372036854775807+1)"),trap("refinementViolation")],
 ["left-before-call",narrow+main("(9223372036854775807+1)+narrow(43)"),trap("integerOverflow")],
 ["unused-local","fnc f(int n) -> int { val a=43::<Bounded>; return n; } "+main("f(42)"),trap("refinementViolation")],
 ["unproved-argument",id+main("identity(43)"),deny("E_REFINEMENT_PRECONDITION")],
 ["unproved-return","fnc f(int n) -> Bounded { return n; } "+main("42"),deny("E_REFINEMENT_RETURN")],
 ["wrong-scale","fnc f(Positive n) -> Positive { return n; } "+main("f(42<Millis>)/1<Second>"),deny("E_UNIT_SCALE")],
 ["wrong-dimension","fnc f(Positive n) -> Positive { return n; } "+main("f(42<Meter>)/1<Second>"),deny("E_UNIT_DIMENSION")],
 ["arity",id+main("identity(42,42)"),deny(null)],
 ["forward","fnc f(int n) -> int { return g(n); } fnc g(int n) -> int { return n; } "+main("f(42)"),deny(null)],
 ["recursion","fnc f(int n) -> int { return f(n); } "+main("42"),deny(null)],
 ["duplicate","fnc f(int n,int n) -> int { return n; } "+main("42"),deny(null)],
 ["public-helper","pub fnc f(int n) -> int { return n; } "+main("f(42)"),deny(null)],
 ["erasure",tag+main("tag(42)"),deny("E_UNIT_ERASURE")]
];
export const typedBindingCases=Object.freeze(rows.map(([id,body,expected])=>Object.freeze({source:"generated-binding-helper-"+id+".atto",text:pre+"\n"+body+"\n",expected:Object.freeze(expected)})));
