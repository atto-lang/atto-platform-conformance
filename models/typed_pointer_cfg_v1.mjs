// Reference verifier for already-typed, bounded, closed CFGs. Not a compiler,
// allocator, concurrency runtime or proof of actual destructor execution.
const MAX_GEN=0xffffffff;
const die=(reason)=>{throw new Error('E_TYPED_POINTER_CFG: '+reason);};
const require=(ok,reason)=>{if(!ok)die(reason);};
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(x);
const validLayout=t=>t&&id(t.id)&&Number.isSafeInteger(t.size)&&t.size>0&&t.size<=1048576&&Number.isInteger(t.align)&&t.align>0&&t.align<=4096&&(t.align&(t.align-1))===0&&t.size%t.align===0&&Number.isInteger(t.fields)&&t.fields>=0&&t.fields<=32&&typeof t.copy==='boolean';
const sorted=m=>[...m].sort(([a],[b])=>a<b?-1:a>b?1:0);
const key=s=>JSON.stringify([sorted(s.stores),sorted(s.slots),sorted(s.loans)]);
const copy=s=>({stores:new Map([...s.stores].map(([k,v])=>[k,{...v}])),slots:new Map([...s.slots].map(([k,v])=>[k,{...v}])),loans:new Map([...s.loans].map(([k,v])=>[k,{...v}]))});
export function verifyTypedPointerCfg(program){
  require(program&&id(program.actor)&&Array.isArray(program.types)&&program.types.length<=64&&Array.isArray(program.blocks)&&program.blocks.length>0&&program.blocks.length<=128&&id(program.entry),'invalid envelope');
  const types=new Map(),blocks=new Map();
  for(const t of program.types){require(validLayout(t)&&!types.has(t.id),'invalid or duplicate type');types.set(t.id,{...t});}
  for(const b of program.blocks){require(b&&id(b.id)&&!blocks.has(b.id)&&Array.isArray(b.ops)&&b.ops.length<=128&&Array.isArray(b.next)&&b.next.length<=2&&new Set(b.next).size===b.next.length,'invalid block');blocks.set(b.id,b);}
  require(blocks.has(program.entry),'missing entry');
  for(const b of blocks.values())for(const n of b.next)require(blocks.has(n),'unknown successor');
  const incoming=new Map([[program.entry,{stores:new Map(),slots:new Map(),loans:new Map()}]]),queue=[program.entry];
  let exits=0,processed=0;
  while(queue.length){
    const b=blocks.get(queue.shift()),s=copy(incoming.get(b.id));processed++;
    const get=(m,k)=>{require(id(k)&&m.has(k),'unknown authority');return m.get(k);};
    const fresh=(m,k)=>require(id(k)&&!m.has(k),'duplicate authority');
    const active=k=>[...s.slots.values()].some(p=>p.store===k);
    const liveLoans=k=>[...s.loans.values()].filter(l=>l.store===k);
    const occupied=k=>active(k)||liveLoans(k).length>0;
    const bound=k=>{const p=get(s.slots,k);require(p.store!==null,'empty slot');const a=get(s.stores,p.store);require(a.phase==='live'&&a.gen===p.gen&&a.type===p.type,'stale or mistyped slot');return [p,a];};
    for(const o of b.ops){
      require(o&&typeof o.op==='string','invalid operation');
      // This closed model has one actor domain and does not admit external provenance.
      if('actor' in o)require(o.actor===program.actor,'cross actor');
      switch(o.op){
        case 'alloc':{
          fresh(s.stores,o.store);const t=get(types,o.type);
          require(o.size===t.size&&o.align===t.align,'layout mismatch');
          s.stores.set(o.store,{type:o.type,phase:'empty',gen:0,fields:0});break;
        }
        case 'begin':{
          const a=get(s.stores,o.store);require(a.phase==='empty'&&!occupied(o.store)&&a.gen<MAX_GEN,'construction authority');
          a.phase='building';a.fields=0;break;
        }
        case 'init':{
          const a=get(s.stores,o.store);require(a.phase==='building'&&o.field===a.fields&&a.fields<get(types,a.type).fields,'field order or duplicate init');
          a.fields++;break;
        }
        case 'commit':{
          const a=get(s.stores,o.store);require(a.phase==='building'&&a.fields===get(types,a.type).fields,'incomplete constructor');
          a.phase='live';a.gen++;break;
        }
        case 'rollback_field':{
          const a=get(s.stores,o.store);require(a.phase==='building'&&a.fields>0&&o.field===a.fields-1,'rollback order');
          a.fields--;break;
        }
        case 'abort':{
          const a=get(s.stores,o.store);require(a.phase==='building'&&a.fields===0,'incomplete rollback');
          a.phase='empty';break;
        }
        case 'slot':{
          fresh(s.slots,o.slot);get(types,o.type);
          s.slots.set(o.slot,{type:o.type,store:null,gen:0});break;
        }
        case 'bind':{
          const p=get(s.slots,o.slot),a=get(s.stores,o.store);
          require(p.store===null&&a.phase==='live'&&p.type===a.type&&!liveLoans(o.store).some(l=>l.mutable),'bind authority');
          p.store=o.store;p.gen=a.gen;break;
        }
        case 'copy_read':{
          const [p,a]=bound(o.slot);
          require(get(types,a.type).copy&&!liveLoans(p.store).some(l=>l.mutable),'not Copy or mutable loan live');break;
        }
        case 'loan':{
          fresh(s.loans,o.loan);const [p]=bound(o.slot);
          require(typeof o.mutable==='boolean','loan access');
          const loans=liveLoans(p.store);
          if(o.mutable)require(loans.length===0&&[...s.slots.values()].filter(v=>v.store===p.store).length===1&&o.exclusive===true,'exclusive proof required');
          else require(!loans.some(l=>l.mutable),'mutable loan live');
          s.loans.set(o.loan,{slot:o.slot,store:p.store,gen:p.gen,mutable:o.mutable});break;
        }
        case 'end_loan':get(s.loans,o.loan);s.loans.delete(o.loan);break;
        case 'detach':{
          const [p]=bound(o.slot);require(![...s.loans.values()].some(l=>l.slot===o.slot),'derived loan live');
          p.store=null;p.gen=0;break;
        }
        case 'end_slot':{
          const p=get(s.slots,o.slot);require(p.store===null,'bound slot exit');s.slots.delete(o.slot);break;
        }
        case 'destroy':{
          const a=get(s.stores,o.store);require(a.phase==='live'&&!occupied(o.store),'destroy authority');
          a.phase='empty';a.fields=0;break;
        }
        case 'free':{
          const a=get(s.stores,o.store);require(a.phase==='empty'&&!occupied(o.store),'free authority');
          // Retain retired identity to prevent ABA via forged allocation IDs.
          a.phase='retired';break;
        }
        case 'suspend':
          require(s.loans.size===0&&[...s.slots.values()].every(p=>p.store===null)&&[...s.stores.values()].every(a=>a.phase!=='building'),'unproved suspension');break;
        default:die('unknown or escaping operation');
      }
    }
    if(!b.next.length){exits++;require(s.loans.size===0&&s.slots.size===0&&[...s.stores.values()].every(a=>a.phase==='retired'),'incomplete cleanup on exit');}
    for(const n of b.next){const prior=incoming.get(n);if(prior)require(key(prior)===key(s),'incompatible CFG join or loop state');else{incoming.set(n,copy(s));queue.push(n);}}
  }
  require(processed===blocks.size&&exits>0,'unreachable blocks or no exit');
  return {blocks:processed,exits};
}
