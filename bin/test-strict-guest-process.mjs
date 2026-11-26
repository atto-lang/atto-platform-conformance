import assert from "node:assert/strict";
import {runStrictGuest} from "./strict-guest-process.mjs";
// Synthetic oracle tests only: never count as compiler guest coverage.
runStrictGuest("export function main(){return 42n;}","js","42","valid");
assert.throws(()=>runStrictGuest("export function main(){return 41n;}","js","42","wrong"),/wrong/);
assert.throws(()=>runStrictGuest("export function main(){while(true){}}","js","42","hung",500),/hung: guest process ETIMEDOUT/);
assert.throws(()=>runStrictGuest("export function main(){console.log('noise');return 42n;}","js","42","noise"),/unexpected guest stdout/);
assert.throws(()=>runStrictGuest("export function main(){process.exit(0);}","js","42","premature-exit"),/unexpected guest stdout/);
console.log("STRICT_GUEST_PROCESS_SELFTEST_PASS 5");
