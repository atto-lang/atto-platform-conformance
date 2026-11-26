// Bounded strict loop cases: actual runtime result or exact diagnostic.
const pre="define dimension Time; define unit Second: Time; type Bounded = int where self >= 1 and self <= 42;";
const cases=[
 ["zero-iterations","let Bounded x=42; while x < 42 { x=x+1; } return x;","42"],
 ["descending","let Bounded x=42; while x > 1 { x=x-1; } return x+41;","42"],
 ["rebind-after-loop","let Bounded x=1; while x < 42 { x=x+1; } x=1; return x+41;","42"],
 ["immutable-snapshot","let Bounded x=1; val int old=x; while x < 42 { x=x+1; } return x+old-1;","42"],
 ["two-loops","let Bounded x=1; while x < 42 { x=x+1; } while x > 1 { x=x-1; } return x+41;","42"],
 ["guard-bounds-carrier","let int x=1; while x < 42 { x=x+1; } return x;","42"],
 ["short-circuit-loop","let Bounded x=1; while x < 42 && x != 0 { x=x+1; } return x;","42"],
 ["exit-zero-divisor","let Bounded x=1; while x < 42 { x=x+1; } return 42/(x-42);","E_VERIFY_UNPROVEN"],
 ["descending-overflow","let int x=-1; while x <= 0 { x=x-1; } return x;","E_VERIFY_UNPROVEN"],
 ["invariant-backedge","let Bounded x=42; while x <= 42 { x=x+1; } return x;","E_REFINEMENT_BINDING"],
];
export const strictLoopCases=cases.map(([id,body,expected])=>({source:id+".atto",text:pre+"\npub fnc main() -> int { "+body+" }\n",expected:expected.startsWith("E_")?{kind:"diagnostic",category:expected}:{kind:"value",decimal:expected}}));
