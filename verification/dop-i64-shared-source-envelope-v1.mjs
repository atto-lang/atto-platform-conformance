// Source-free common-envelope oracle for the Java opt-in and LLVM native
// two-i64 inverted SOURCE subset. Not a compiler or guest execution receipt.
export const DOP_I64_SHARED_V1 = Object.freeze({
  version:1, minCapacity:1, maxCapacity:256, maxOperations:1024,
  scalarType:'int', fieldCount:2
});

function own(object,key) {
  if (!object || typeof object !== 'object') {
    throw new TypeError('DOP_INVERTED_V1_REJECTED: object expected');
  }
  const data = Object.getOwnPropertyDescriptor(object,key);
  if (!data || !Object.hasOwn(data,'value')) {
    throw new TypeError('DOP_INVERTED_V1_REJECTED: own data required: '+key);
  }
  return data.value;
}
function boundedList(input,label,low,high) {
  if (!Array.isArray(input) || input.length<low || input.length>high) {
    throw new RangeError('DOP_INVERTED_V1_REJECTED: invalid '+label+' count');
  }
  return Array.from({length:input.length},(_,i)=>own(input,String(i)));
}
function reject(reason) {
  throw new TypeError('DOP_INVERTED_V1_REJECTED: '+reason);
}

// Verify a bounded compiler-neutral *operation summary*, never a source-text
// string, executable user callback, JVM method or LLVM module. The real
// compilers must independently reject all unsupported source forms.
export function verifySharedI64Summary(summary) {
  const capacity=own(summary,'capacity');
  const columns=boundedList(own(summary,'columns'),'column',2,2);
  const ops=boundedList(own(summary,'operations'),'operation',1,1024);
  if (!Number.isSafeInteger(capacity) || capacity<1 || capacity>256) {
    throw new RangeError('DOP_INVERTED_V1_REJECTED: capacity outside [1,256]');
  }
  const fields = columns.map(column=>{
    const name=own(column,'name'), type=own(column,'type'),
      mutable=own(column,'mutable');
    if (typeof name!=='string' || !/^[$A-Z_a-z][$A-Z_a-z0-9]*$/.test(name) ||
        type!=='int' || typeof mutable!=='boolean') reject('invalid scalar column');
    return Object.freeze({name,type,mutable});
  });
  if(fields[0].name===fields[1].name) reject('duplicate column');
  const fieldByName = Object.fromEntries(fields.map(x=>[x.name,x]));
  let size=0, returned=false;
  for(let i=0;i<ops.length;i++) {
    const op=ops[i],kind=own(op,'kind');
    if(returned) reject('operation after terminal read');
    if(kind==='push') {
      const first=own(op,'first'), second=own(op,'second');
      const min=-(1n<<63n), max=(1n<<63n)-1n;
      if(typeof first!=='bigint'||typeof second!=='bigint'||
         first<min||first>max||second<min||second>max) reject('out-of-range i64');
      if(size>=capacity) reject('capacity overflow');
      size++;
    } else if(kind==='write') {
      const field=own(op,'field'), index=own(op,'index'),
        value=own(op,'value');
      if(!Number.isSafeInteger(index)||index<0 || typeof value!=='bigint' ||
         value<-(1n<<63n)||value>(1n<<63n)-1n) reject('invalid write operand');
      if(!Object.hasOwn(fieldByName,field) || !fieldByName[field].mutable) {
        reject('immutable or unknown field write');
      }
      // The source compilers use runtime-checked dense indices for write.
    } else if(kind==='erase_swap') {
      const index=own(op,'index');
      if(!Number.isSafeInteger(index) || index<0 || index>=size)
        reject('erase outside current length');
      size--;
    } else if(kind==='return_read') {
      if(i!==ops.length-1) reject('return must be terminal');
      const index=own(op,'index'),field=own(op,'field');
      if(!Number.isSafeInteger(index)||index<0 ||
         !Object.hasOwn(fieldByName,field)) reject('invalid return read');
      // Invalid positive dense index traps at runtime; not compile denial.
      returned=true;
    } else reject('unsupported operation');
  }
  if(!returned) reject('missing terminal return');
  return Object.freeze({
    version:1,capacity,operationCount:ops.length,fieldCount:fields.length,
    remainingRows:size,runtimeIndexChecksRequired:true
  });
}
