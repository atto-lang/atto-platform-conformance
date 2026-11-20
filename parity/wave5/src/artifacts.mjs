import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bad=msg=>{throw Error('wave5-artifact: '+msg)};
const need=(v,msg)=>{if(!v)bad(msg)};
const bytebuf=x=>Buffer.isBuffer(x)?x:Buffer.from(x);
const u32=(b,o)=>{need(o>=0&&o+4<=b.length,'truncated u32');return b.readUInt32LE(o)};
export function sha256(bytes){return createHash('sha256').update(bytebuf(bytes)).digest('hex')}
const targets=Object.freeze({
 'elf-x86_64':{format:'elf',machine:62},
 'elf-aarch64':{format:'elf',machine:183},
 'pe-x64':{format:'pe',machine:0x8664},
 'pe-arm64':{format:'pe',machine:0xaa64},
 'macho-x86_64':{format:'macho',machine:0x01000007},
 'macho-arm64':{format:'macho',machine:0x0100000c},
 'wasm32':{format:'wasm'}
});
export function inspectNative(bytes,target){
 const b=bytebuf(bytes),p=targets[target];need(p&&p.format!=='wasm','unsupported native architecture/profile');
 need(b.length>=64&&b.length<=128*1024*1024,'native artifact size');
 if(p.format==='elf'){
  need(b.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])),'not ELF (script, IR or stub)');
  need(b[4]===2&&b[5]===1&&b[6]===1,'requires little-endian ELF64');
  const kind=b.readUInt16LE(16),machine=b.readUInt16LE(18);
  need([2,3].includes(kind)&&machine===p.machine,'wrong ELF type/machine');
  const entry=b.readBigUInt64LE(24),offset=b.readBigUInt64LE(32),entsize=b.readUInt16LE(54),count=b.readUInt16LE(56);
  need(entry!==0n&&count>0&&entsize>=56&&offset>=64n&&offset+BigInt(entsize)*BigInt(count)<=BigInt(b.length),'ELF has no bounded executable entry/segments');
  return Object.freeze({format:'elf',target,entry:String(entry),sha256:sha256(b),binaryShapeOnly:true});
 }
 if(p.format==='pe'){
  need(b[0]===0x4d&&b[1]===0x5a,'not MZ/PE');
  const off=u32(b,0x3c);need(off>=64&&off+4+20+240<=b.length&&b.toString('ascii',off,off+4)==='PE\0\0','truncated PE');
  const coff=off+4, machine=b.readUInt16LE(coff),sections=b.readUInt16LE(coff+2), optBytes=b.readUInt16LE(coff+16),flags=b.readUInt16LE(coff+18),opt=coff+20;
  need(machine===p.machine&&sections>0&&optBytes>=240&&opt+optBytes<=b.length,'wrong PE machine/sections');
  need((flags&0x0002)!==0&&b.readUInt16LE(opt)===0x20b,'not PE32+ executable');
  const directories=b.readUInt32LE(opt+108),clr=opt+112+14*8;
  need(directories>=15&&clr+8<=opt+optBytes,'CLI directory not inspectable');
  need(u32(b,clr)===0&&u32(b,clr+4)===0,'managed CIL/CLR module is not Native AOT');
  need(u32(b,opt+16)!==0,'missing PE entrypoint');
  return Object.freeze({format:'pe',target,sha256:sha256(b),cliDirectory:'absent',binaryShapeOnly:true});
 }
 need(b.readUInt32LE(0)===0xfeedfacf,'not little-endian Mach-O 64');
 const machine=b.readUInt32LE(4),filetype=b.readUInt32LE(12),cmds=b.readUInt32LE(16),sz=b.readUInt32LE(20);
 need(machine===p.machine&&filetype===2&&cmds>0&&sz>0&&sz<=b.length-32,'not executable Mach-O with valid commands');
 return Object.freeze({format:'macho',target,sha256:sha256(b),binaryShapeOnly:true});
}
function leb(b,offset){
 let val=0,shift=0,at=offset;
 for(let i=0;i<5;i++){need(at<b.length,'truncated LEB');const octet=b[at++];if(i===4)need(octet<=0x0f,'overlong u32');val+=(octet&0x7f)*2**shift;if(!(octet&0x80)){need(i===0||octet!==0,'nonminimal LEB');need(val<=0xffffffff,'LEB overflow');return{value:val,at}}shift+=7}
 bad('oversized LEB');
}
function name(b,pos,end){
 const len=leb(b,pos);need(len.value<=128&&len.at+len.value<=end,'name length out of bounds');
 const bytes=b.subarray(len.at,len.at+len.value),decoder=new TextDecoder('utf-8',{fatal:true});
 let value;try{value=decoder.decode(bytes)}catch{bad('invalid UTF-8 name')}
 need(!value.includes('\0'),'NUL import/export');return{value,at:len.at+len.value};
}
function bounds(b,pos,end){
 const flag=leb(b,pos);need(flag.value===1,'unbounded memory/table or unsupported flag');
 const min=leb(b,flag.at),max=leb(b,min.at);
 need(max.at<=end&&min.value<=max.value&&max.value<=512,'invalid memory bounds');return max.at;
}
export function inspectWasm(bytes,{profile='scalar',allowedImports=[]}={}){
 const b=bytebuf(bytes);
 need(b.length>=8&&b.length<=16*1024*1024,'Wasm artifact size');
 need(b.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])),'not canonical wasm32 module');
 need(['scalar','capability'].includes(profile),'unknown wasm profile');
 need(Array.isArray(allowedImports)&&allowedImports.every(x=>typeof x==='string'&&x.startsWith('ores_host.'))&&new Set(allowedImports).size===allowedImports.length,'invalid import allowlist');
 need(profile!=='scalar'||allowedImports.length===0,'scalar profile must have zero imports');
 let pos=8,previous=0,seen=new Set(),imports=[],exports=[],memoryMaximum=null,hasCode=false;
 while(pos<b.length){
  const id=b[pos++],length=leb(b,pos);pos=length.at;const end=pos+length.value;
  need(id<=12&&end<=b.length,'invalid/truncated wasm section');
  if(id!==0){need(id>previous&&!seen.has(id),'duplicate/out-of-order wasm sections');previous=id;seen.add(id)}
  if(id===2){
   let cur=pos;const count=leb(b,cur);cur=count.at;need(count.value<=32,'too many imports');
   for(let i=0;i<count.value;i++){
    const module=name(b,cur,end);const member=name(b,module.at,end);cur=member.at;
    need(cur<end,'truncated import kind');const kind=b[cur++];
    need(kind===0,'only imported functions admitted');
    const type=leb(b,cur);cur=type.at;need(type.value<=65535,'invalid function type');
    const label=module.value+'.'+member.value;
    need(profile==='capability'&&allowedImports.includes(label),'unauthorized host capability import');
    need(!imports.includes(label),'duplicate imported capability');
    imports.push(label);
   }
   need(cur===end,'trailing import payload');
  }
  if(id===5){
   let cur=pos;const count=leb(b,cur);cur=count.at;need(count.value<=1,'multiple linear memories');
   if(count.value){const flag=leb(b,cur);need(flag.value===1,'memory must have explicit maximum');const min=leb(b,flag.at),max=leb(b,min.at);need(min.value<=max.value&&max.value<=512,'unsafe wasm memory limits');cur=max.at;memoryMaximum=max.value}
   need(cur===end,'trailing memory payload');
  }
  if(id===7){
   let cur=pos;const count=leb(b,cur);cur=count.at;need(count.value<=64,'too many exports');
   for(let i=0;i<count.value;i++){const entry=name(b,cur,end);cur=entry.at;need(cur<end,'truncated export kind');const kind=b[cur++],idx=leb(b,cur);cur=idx.at;need(!exports.some(x=>x.name===entry.value),'duplicate export');exports.push({name:entry.value,kind,index:idx.value})}
   need(cur===end,'trailing exports');
  }
  if(id===10)hasCode=length.value>0;
  if(id===8)bad('Wasm start section not permitted in controlled guest profile');
  pos=end;
 }
 need(hasCode,'no compiled code section');
 need(exports.some(x=>x.name==='ores_main'&&x.kind===0),'no ores_main exported guest function');
 need(WebAssembly.validate(b),'Wasm engine validation failed');
 const compiled=new WebAssembly.Module(b);
 const runtimeImports=WebAssembly.Module.imports(compiled).map(x=>({name:x.module+'.'+x.name,kind:x.kind}));
 need(runtimeImports.length===imports.length&&runtimeImports.every((x,i)=>x.name===imports[i]&&x.kind==='function'),'Wasm engine import identity mismatch');
 need(WebAssembly.Module.exports(compiled).some(x=>x.name==='ores_main'&&x.kind==='function'),'Wasm engine export mismatch');
 return Object.freeze({format:'wasm',target:'wasm32',profile,imports:Object.freeze(imports),exports:Object.freeze(exports),memoryMaximum,engineModuleValidated:true,sha256:sha256(b),binaryShapeOnly:true});
}
export async function inspectFile(path,target,wasmOptions={}){
 const b=await readFile(path);
 return target==='wasm32'?inspectWasm(b,wasmOptions):inspectNative(b,target);
}
