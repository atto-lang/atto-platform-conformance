#!/usr/bin/env node
import {verifyStoredHeadSnapshot} from "../src/head-snapshot.mjs";
try {
 if(process.argv.length!==2)throw Error("Usage: node bin/check-head-snapshot.mjs");
 console.log(JSON.stringify(verifyStoredHeadSnapshot(),null,2));
} catch(error){
 console.error(error.message);
 process.exitCode=1;
}
