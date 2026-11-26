import assert from "node:assert/strict";
import {runStrictGuest} from "./strict-guest-process.mjs";
// Synthetic oracle tests only: never count as compiler guest coverage.
runStrictGuest("export function main(){return 42n;}","js","42","valid");
assert.throws(()=>runStrictGuest("export function main(){return 41n;}","js","42","wrong"),/wrong/);
assert.throws(()=>runStrictGuest("export function main(){while(true){}}","js","42","hung",500),/hung: guest process ETIMEDOUT/);
assert.throws(()=>runStrictGuest("export function main(){console.log('noise');return 42n;}","js","42","noise"),/unexpected guest stdout/);
assert.throws(()=>runStrictGuest("export function main(){process.exit(0);}","js","42","premature-exit"),/premature-exit/);
assert.throws(()=>runStrictGuest("export function main(){process.stdout.write('STRICT_GUEST_OK 42\\n');process.exit(0);}", "js","42","forged-receipt"),/forged-receipt/);
assert.throws(()=>runStrictGuest("import fs from 'node:fs'; export function main(){return 42n;}", "js","42","static-import"),/static import denied/);
assert.throws(()=>runStrictGuest("export async function main(){return 42n;}", "js","42","async-result"),/async-result/);
assert.throws(()=>runStrictGuest("export function main(){return 42;}", "js","42","number-not-i64"),/number-not-i64/);
assert.throws(()=>runStrictGuest("export function main(){return 42n;}", "js","9223372036854775808","range"),/i64 result range/);
console.log("STRICT_GUEST_PROCESS_SELFTEST_PASS 10");
