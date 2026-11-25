#!/usr/bin/env node
import {loadWave1} from '../src/wave1-contract.mjs';
try {
  if (process.argv.slice(2).some(x => x !== '--require-parity') ||
      process.argv.slice(2).filter(x => x === '--require-parity').length > 1) {
    throw Error('usage: wave1-status.mjs [--require-parity]');
  }
  const {result} = await loadWave1();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--require-parity')) process.exitCode = 1;
} catch (err) {
  console.error(err.message); process.exitCode = 2;
}
