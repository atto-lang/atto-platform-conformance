// HOST_ONLY model of proposed local pointer type and authority rules. Does not parse or compile Atto, verify real storage, or prove runtime safety.
function runIdempotentPointerOracle() {
  // Deliberately HOST_ONLY, closed symbolic type and lease model; not a source parser.
  const check=(b,m)=>{if(!b)throw Error(m)};
  const reject=f=>{try{f()}catch{return true}return false};
  const atom=name=>({kind:"atom",name});
  const pointer=(target,rights="read",family="local")=>({kind:"ptr",target,rights,family});
  const normalize=t=>{
    if(t.kind==="alias")return normalize(t.to);
    if(t.kind==="atom")return t;
    if(t.kind!=="ptr")throw Error("unsupported type");
    const inner=normalize(t.target);
    if(inner.kind==="ptr"){
      if(t.family!=="local"||inner.family!=="local"||t.rights!==inner.rights)throw Error("authority mismatch");
      return inner;
    }
    return pointer(inner,t.rights,t.family);
  };
  const equal=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
  const acquire=(operand,ctx)=>{
    if(!ctx.trusted)throw Error("untrusted");
    const v=operand();
    if(v.kind==="handle"){valid(v,ctx);return v}
    if(v.kind!=="place"||!v.live||!v.initialized||v.domain!==ctx.domain)throw Error("invalid place");
    return {kind:"handle",place:v,domain:v.domain,generation:v.generation,rights:"read",live:true};
  };
  const valid=(p,c)=>{
    if(!c.trusted||p.kind!=="handle"||!p.live||!p.place.live||!p.place.initialized||p.domain!==c.domain||p.generation!==p.place.generation)throw Error("invalid handle");
  };
  const access=(p,c)=>{valid(p,c);return p.place.value};
  const retain=(p,c)=>{valid(p,c);if(p.rights!=="read")throw Error("exclusive");return {...p}};
  const detach=(p,c)=>{valid(p,c);p.live=false};
  const T=atom("int"), A={kind:"alias",to:pointer(T)}, C={trusted:true,domain:1};
  const x={kind:"place",domain:1,generation:1,value:42,live:true,initialized:true};
  let evaluations=0; const p=acquire(()=>{evaluations++;return x},C);
  const cases=[
    ["type idempotence",()=>equal(pointer(pointer(T)),pointer(T))],
    ["alias normalization",()=>equal(pointer(A),pointer(T))],
    ["deep normalization",()=>equal(pointer(pointer(pointer(T))),pointer(T))],
    ["referent nominal identity",()=>!equal(pointer(T),pointer(atom("Person")))],
    ["qualifier mismatch",()=>reject(()=>normalize(pointer(pointer(T,"write"))))],
    ["authority family mismatch",()=>reject(()=>normalize(pointer(pointer(T,"read","owned"))))],
    ["symbolic acquisition target",()=>p.place===x],
    ["reacquire is same handle",()=>acquire(()=>p,C)===p],
    ["repeated identity",()=>acquire(()=>acquire(()=>p,C),C)===p],
    ["one evaluation",()=>{let n=0;acquire(()=>{n++;return p},C);return n===1&&evaluations===1}],
    ["dereference target",()=>access(p,C)===42],
    ["strict nonpointer dereference",()=>reject(()=>access(x,C))],
    ["untrusted acquisition",()=>reject(()=>acquire(()=>x,{...C,trusted:false}))],
    ["untrusted existing pointer",()=>reject(()=>acquire(()=>p,{...C,trusted:false}))],
    ["untrusted dereference",()=>reject(()=>access(p,{...C,trusted:false}))],
    ["cross-domain acquisition",()=>reject(()=>acquire(()=>x,{...C,domain:2}))],
    ["cross-domain dereference",()=>reject(()=>access(p,{...C,domain:2}))],
    ["exclusive alias rejected",()=>reject(()=>retain({...p,rights:"write"},C))],
    ["invalid temporary",()=>reject(()=>acquire(()=>42,C))],
    ["uninitialized place",()=>reject(()=>acquire(()=>({...x,initialized:false}),C))],
    ["independent read lease",()=>{const q=retain(p,C);detach(q,C);return access(p,C)===42&&reject(()=>access(q,C))}],
    ["detached acquisition",()=>{const q=retain(p,C);detach(q,C);return reject(()=>acquire(()=>q,C))}],
    ["double detach",()=>{const q=retain(p,C);detach(q,C);return reject(()=>detach(q,C))}],
    ["stale generation",()=>{const y={...x};const q=acquire(()=>y,C);y.generation++;return reject(()=>access(q,C))}],
    ["retired place",()=>{const y={...x};const q=acquire(()=>y,C);y.live=false;return reject(()=>access(q,C))}],
    ["referent survives last detach",()=>{detach(p,C);return x.live&&x.value===42&&reject(()=>access(p,C))}]
  ];
  for(const [name,fn] of cases)check(fn(),name);
  return cases.length;
}
console.log(`HOST_ONLY: ${runIdempotentPointerOracle()} pointer normalization checks passed`);
