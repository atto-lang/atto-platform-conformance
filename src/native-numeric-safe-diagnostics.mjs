// Numeric compiler evidence diagnostics are public/loggable labels.
// Never echo external filesystem, process, or exception messages: Node errors
// routinely include absolute paths, and tools may put credentials in them.
const SAFE_CODES=new Map([
  ['unexpected/duplicate argument','INVALID_CLI_ARGUMENT'],
  ['exact 40-character LLVM source SHA required','INVALID_SOURCE_COMMIT_PIN'],
  ['exact pinned manifest SHA-256 required','INVALID_MANIFEST_PIN'],
  ['numeric source fixture manifest SHA-256 mismatch','MANIFEST_BYTES_MISMATCH'],
  ['manifest too large','MANIFEST_SIZE_LIMIT'],
  ['invalid numeric source corpus version/count','CORPUS_INVALID'],
  ['numeric corpus count drift','CORPUS_COUNT_DRIFT'],
  ['missing or oversized LLVM IR','LLVM_IR_INVALID'],
  ['expected one i64 __oreslang_guest_main and one i32 host main wrapper','LLVM_GUEST_ABI_INVALID'],
  ['unrenamed native host wrapper','LLVM_WRAPPER_REWRITE_FAILED'],
  ['reporting shim failed initial immutable admission','REPORTER_SOURCE_INVALID'],
  ['native executable exists before Clang link','NATIVE_EXECUTABLE_PREEXISTS'],
  ['Clang did not produce a safe native executable','NATIVE_EXECUTABLE_UNSAFE'],
  ['LLVM compiler SHA-256 differs','COMPILER_DIGEST_MISMATCH'],
  ['Clang SHA-256 differs','CLANG_DIGEST_MISMATCH']
]);
const REQUIRED=new Set([
  'compiler','compiler-sha256','clang','clang-sha256',
  'clang-resource-dir','source-commit','manifest-sha256'
]);
export function nativeNumericSafeFailureCode(error){
  let message;
  try{message=typeof error?.message==='string'?error.message:null;}
  catch{return 'UNCLASSIFIED_EXECUTION_OR_IO_ERROR';}
  if(typeof message!=='string')return 'UNCLASSIFIED_EXECUTION_OR_IO_ERROR';
  if(message.startsWith('missing --') && REQUIRED.has(message.slice(10)))
    return 'MISSING_REQUIRED_ARGUMENT';
  return SAFE_CODES.get(message)||'UNCLASSIFIED_EXECUTION_OR_IO_ERROR';
}
