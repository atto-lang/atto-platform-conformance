import test from 'node:test';
import assert from 'node:assert/strict';
import { placesOverlap, inspectPlaceFlow } from '../src/ownership-place-cfg-v1.mjs';

// 25 named, independent candidate reference scenarios. These are source-only
// place/CFG model tests; they do NOT compile or execute an .atto guest.
const place = (owner,...path)=>({owner,path});
const field = name=>({field:name});
const index = n=>({index:n});
const a=place('alpha'),b=place('beta');
const left=place('alpha',field('left'));
const right=place('alpha',field('right'));
const inner=place('alpha',field('left'),field('inner'));
const arr0=place('alpha',field('items'),index(0));
const arr1=place('alpha',field('items'),index(1));
const wildcard=place('alpha',field('items'),index('*'));
const layout={independentOwnerPairs:[{kind:'independent-roots',owners:['alpha','beta']}],
  alpha:{owner:'alpha',
  disjointFields:[{kind:'nominal-fields',owner:'alpha',parent:[],members:['left','right']}],
  disjointIndices:[{kind:'independent-elements',parent:[field('items')]}]
}};
const take=p=>({op:'take',place:p});
const read=p=>({op:'read',place:p});
const write=p=>({op:'write',place:p});
const rebind=p=>({op:'rebind',place:p});
const shared=(p,id)=>({op:'borrow',place:p,loan:id,mutable:false});
const exclusive=(p,id)=>({op:'borrow',place:p,loan:id,mutable:true});
const release=id=>({op:'release',loan:id});
const send=(p,mode)=>({op:'send',place:p,payloadMode:mode});
const branch=(yes,no)=>({op:'branch',then:yes,else:no});

const overlaps=[
  ['same owner root',a,a,true,layout],
  ['root and descendant',a,left,true,layout],
  ['nominal siblings without layout',left,right,true,{}],
  ['nominal siblings with exact layout',left,right,false,layout],
  ['independent canonical owners',a,b,false,layout]
];
const loans=[
  ['shared loans can both release',[shared(a,'L'),shared(a,'R'),release('R'),release('L')],null],
  ['shared then exclusive rejected',[shared(a,'L'),exclusive(a,'R')],'OVERLAPPING_LOAN_CONFLICT'],
  ['exclusive then shared rejected',[exclusive(a,'L'),shared(a,'R')],'OVERLAPPING_LOAN_CONFLICT'],
  ['take under shared loan rejected',[shared(a,'L'),take(a)],'TAKE_DURING_ACTIVE_LOAN'],
  ['read under exclusive loan rejected',[exclusive(a,'L'),read(a)],'READ_CONFLICTS_EXCLUSIVE_LOAN']
];
const moves=[
  ['root take followed by read rejected',[take(a),read(a)],'READ_OF_MOVED_PLACE'],
  ['field take poisons ancestor read',[take(left),read(a)],'READ_OF_MOVED_PLACE'],
  ['disjoint sibling stays readable',[take(left),read(right)],null],
  ['exact-field write restores partial move',[take(left),write(left),read(a)],null],
  ['writing child cannot repair moved root',[take(a),write(left)],'WRITE_THROUGH_MOVED_OWNER']
];
const cfg=[
  ['single-arm move remains moved',[branch([take(a)],[]),read(a)],'READ_OF_MOVED_PLACE'],
  ['join rebind restores maybe-moved owner',[branch([take(a)],[take(a)]),rebind(a),read(a)],null],
  ['unbalanced branch loan rejected',[branch([shared(a,'L')],[])],'LOAN_JOIN_MISMATCH'],
  ['released branch loan rejoins cleanly',[branch([shared(a,'L'),release('L')],[])],null],
  ['nested branch moves remain poisoned',[branch([branch([take(a)],[])],[]),read(a)],'READ_OF_MOVED_PLACE']
];
const transport=[
  ['live loan across await rejected',[shared(a,'L'),{op:'suspend'}],'LIVE_LOAN_CROSSES_SUSPENSION'],
  ['borrowed actor payload rejected',[send(a,'borrowed')],'BORROW_ESCAPES_TRANSPORT'],
  ['consumed actor source cannot be read',[send(a,'owned-take'),read(a)],'READ_OF_MOVED_PLACE'],
  ['copied actor source remains readable',[send(a,'owned-copy'),read(a)],null],
  ['duplicate owned transfer rejected',[send(a,'owned-take'),send(a,'owned-take')],'SEND_OF_MOVED_PLACE']
];

for(const [name,leftPlace,rightPlace,expected,claims] of overlaps){
  test('P/alias: '+name,()=>{
    assert.equal(placesOverlap(leftPlace,rightPlace,claims),expected);
    assert.equal(placesOverlap(rightPlace,leftPlace,claims),expected);
  });
}
for(const [category,cases] of [
  ['loan',loans],['move',moves],['cfg',cfg],['transport',transport]
]){
  for(const [name,events,diagnostic] of cases){
    test('P/'+category+': '+name,()=>{
      const result=inspectPlaceFlow({events,layoutClaims:layout});
      assert.equal(result.ok,false,'candidate must not authorize compilation');
      assert.equal(result.verified,false,'reference is never an attestation');
      if(diagnostic===null){
        assert.equal(result.candidateAdmitted,true,result.errors.join(','));
        assert.deepEqual(result.errors,[]);
        assert.equal(result.status,'CANDIDATE_ACCEPTED_UNATTESTED');
      }else{
        assert.equal(result.candidateAdmitted,false,name);
        assert.ok(result.errors.includes(diagnostic),result.errors.join(','));
        assert.equal(result.status,'CANDIDATE_REJECTED_UNATTESTED');
      }
    });
  }
}
const total=overlaps.length+loans.length+moves.length+cfg.length+transport.length;
assert.equal(total,25);
