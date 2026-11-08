// Task #29: source-free type-algebra oracle, NOT an AttoLang compiler.
const GENERIC_ARITY=Object.freeze({Option:1,Future:1,Result:2});
const NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;
export function parseNestedType(input){
  if(typeof input!=='string'||input.length>512)throw Error('INVALID_TYPE_INPUT');
  let i=0,nodes=0;
  const space=()=>{while(/\s/.test(input[i]||'')&&i<input.length)i++;};
  function read(depth){
    if(depth>32||++nodes>128)throw Error('TYPE_DEPTH_LIMIT');
    space();const start=i;
    while(i<input.length&&/[A-Za-z0-9_]/.test(input[i]))i++;
    const name=input.slice(start,i);
    if(!NAME.test(name))throw Error('INVALID_TYPE_NAME');
    space();const args=[];
    if(input[i]==='<'){
      i++;
      while(true){
        args.push(read(depth+1));space();
        if(input[i]===','){i++;continue;}
        if(input[i]==='>'){i++;break;}
        throw Error('INVALID_GENERIC_SYNTAX');
      }
    }
    if(Object.hasOwn(GENERIC_ARITY,name)&&args.length!==GENERIC_ARITY[name])
      throw Error('GENERIC_ARITY_MISMATCH');
    if(!Object.hasOwn(GENERIC_ARITY,name)&&args.length)
      throw Error('UNRECOGNIZED_GENERIC_TYPE');
    return Object.freeze({name,args:Object.freeze(args)});
  }
  const result=read(0);space();
  if(i!==input.length)throw Error('TRAILING_TYPE_TOKENS');
  return result;
}
export function formatNestedType(t){
  if(!t||!NAME.test(t.name)||!Array.isArray(t.args))throw Error('INVALID_TYPE_TREE');
  return t.name+(t.args.length?'<'+t.args.map(formatNestedType).join(',')+'>':'');
}
export function equalNestedType(a,b){
  if(!a||!b||a.name!==b.name||a.args?.length!==b.args?.length)return false;
  return a.args.every((v,i)=>equalNestedType(v,b.args[i]));
}
// No implicit lifting/unwrapping/flattening: structural identity only.
export function checkNestedAssignment(expected,actual){
  const e=parseNestedType(expected),a=parseNestedType(actual);
  return Object.freeze({ok:equalNestedType(e,a),expected:formatNestedType(e),
    actual:formatNestedType(a),diagnostic:equalNestedType(e,a)?null:'E_NO_IMPLICIT_NESTED_CONVERSION',
    evidence:'TYPE_ORACLE_ONLY'});
}
export function explicitFlattenOne(type,kind){
  if(kind!=='Future'&&kind!=='Option')throw Error('UNSUPPORTED_FLATTEN_KIND');
  const node=parseNestedType(type);
  if(node.name!==kind||node.args[0]?.name!==kind)throw Error('EXPLICIT_FLATTEN_TYPE_MISMATCH');
  return formatNestedType({name:kind,args:[node.args[0].args[0]]});
}
