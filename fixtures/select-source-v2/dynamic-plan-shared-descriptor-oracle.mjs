// Independent shared descriptor storage model; not compiled guest evidence.
function verifySharedDescriptors(){
 let assertions=0;const check=(ok,msg)=>{assertions++;if(!ok)throw Error(msg)};
 let cap=256,version=0,root={cursor:0,refs:1},cache=null,active=new Map(),cells=[root],blocks=[],freeCells=[],freeBlocks=[],copies=0;
 function releaseCell(c){check(c.refs>0,"cell ref underflow");if(--c.refs===0)freeCells.push(c)}
 function releaseBlock(b){check(b.refs>0,"descriptor ref underflow");if(--b.refs===0){releaseCell(b.cell);b.cell=null;freeBlocks.push(b)}}
 function acquire(id){if(active.size===cap)return false;if(cache===null){cache=freeBlocks.pop();if(!cache){cache={};blocks.push(cache)}Object.assign(cache,{refs:1,cell:root,version});root.refs++;copies++}cache.refs++;active.set(id,cache);return true}
 function mutate(){if(cache!==null){let b=cache;cache=null;releaseBlock(b)}if(root.refs!==1){let old=root;root=freeCells.pop();if(!root){root={};cells.push(root)}Object.assign(root,{refs:1,cursor:old.cursor});releaseCell(old)}version++}
 function retire(id,commit){const b=active.get(id);check(!!b,"unknown invocation");if(commit)b.cell.cursor=(b.cell.cursor+1)%8;active.delete(id);releaseBlock(b)}
 function validate(){let br=new Map(),cr=new Map([[root,1]]);if(cache)br.set(cache,1);for(let b of active.values())br.set(b,(br.get(b)||0)+1);for(let b of blocks){check(b.refs===(br.get(b)||0),"descriptor refs");if(b.refs>0)cr.set(b.cell,(cr.get(b.cell)||0)+1)}for(let c of cells)check(c.refs===(cr.get(c)||0),"generation refs");check(blocks.length<=cap+1&&cells.length<=cap+1,"pool cap");check(new Set(freeBlocks).size===freeBlocks.length&&new Set(freeCells).size===freeCells.length,"free list duplicates");check(active.size<=cap,"admission cap")}
 for(let i=0;i<10000;i++){check(acquire(i),"steady admission");retire(i,true)}check(copies===1,"steady descriptor copied once");validate();
 for(let i=0;i<cap;i++){check(acquire(i),"concurrent admission");mutate()}check(!acquire(cap),"quota");validate();let liveCursor=root.cursor;for(let i=0;i<cap;i++)retire(i,true);check(root.cursor===liveCursor,"old generations changed live cursor");validate();
 for(let i=0;i<cap;i++)check(acquire(i),"shared generation admission");let before=copies;check(!acquire(cap),"quota shared");for(let i=0;i<cap;i++)retire(i,i%2===0);check(copies===before,"retirement does not copy");validate();
 let seed=0x12345678;for(let i=0;i<10000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;let op=(seed>>>16)%4;if(op===0)mutate();else if(op===1||active.size===0)acquire(i);else{let ids=[...active.keys()];retire(ids[(seed>>>8)%ids.length],op===2)}if(i%23===0)validate()}
 for(let id of [...active.keys()])retire(id,false);validate();return {assertions,descriptorBlocks:blocks.length,generationCells:cells.length,active:active.size,steadyCopies:1,totalCopies:copies};
}
console.log(JSON.stringify(verifySharedDescriptors()));
