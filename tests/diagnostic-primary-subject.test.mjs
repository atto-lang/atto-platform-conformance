import test from 'node:test';
import assert from 'node:assert/strict';
import {isExpectedCompilerDiagnostic,runSuite} from '../src/harness.mjs';
const symbol='nonexistent_symbol';
test('secondary hints and error-context quotes cannot verify another rejected identifier',()=>{
 for(const line of [
  'error: unresolved identifier other_symbol; hint: nonexistent_symbol undefined',
  'error: unknown symbol other_symbol (secondary: nonexistent_symbol is not defined)',
  'error: compiler failed on other_symbol, unresolved identifier nonexistent_symbol in a source quote',
  'source.ores:20: error: unknown symbol other_symbol; missing nonexistent_symbol',
  'return "error: unresolved identifier nonexistent_symbol";',
  '// error: unresolved identifier nonexistent_symbol',
  'warning: error: unresolved identifier nonexistent_symbol'
 ])assert.equal(isExpectedCompilerDiagnostic(line,symbol),false,line);
});
test('diagnostic retains primary subject handling for conventional severity/location formats',()=>{
 for(const line of [
  'error: unresolved identifier nonexistent_symbol',
  'src/main.ores:2: error: use of undeclared identifier nonexistent_symbol',
  'src/main.ores:2:17: error: cannot find name nonexistent_symbol',
  'error[E0425]: cannot find name nonexistent_symbol',
  'ERROR: unknown symbol "nonexistent_symbol"',
  'error: nonexistent_symbol not found',
 ])assert.equal(isExpectedCompilerDiagnostic(line,symbol),true,line);
});
test('unrelated exit with misleading same-line hints is not verified',async()=>{
 const r=await runSuite({backend:'llvm',argv:[process.execPath,'{file}'],sourceSha:'0'.repeat(40),spawn:(exe,args)=>args.at(-1).endsWith('unresolved-identifier.ores')?{status:1,stdout:'',stderr:'error: unresolved identifier wrong_name; hint: nonexistent_symbol undefined'}:{status:0,stdout:'',stderr:''}});
 assert.equal(r.results[1].status,'MISMATCH');
 assert.equal(r.ok,false);
});
