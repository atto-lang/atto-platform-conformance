#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {buildEvidence,validatePins} from "../src/build-evidence.mjs";
try {
  const [backend,...paths]=process.argv.slice(2);
  if (!["java","llvm"].includes(backend) || paths.length!==(backend==="java"?4:2)) {
    throw Error("usage: record-build.mjs java jar launcher classpath runtime-runner | llvm native-compiler runtime-runner");
  }
  const pins=validatePins(JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/compiler-pins.json",import.meta.url)))));
  const configuration=backend==="java"
    ?{paths:{"compiler-jar":paths[0],launcher:paths[1],"runtime-runner":paths[3]},classpathFile:paths[2]}
    :{paths:{"compiler-native":paths[0],"runtime-runner":paths[1]}};
  const toolchain=process.env.ORES_TOOLCHAIN_INFO;
  const result=await buildEvidence({backend,pins,toolchain,...configuration});
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  console.error("build evidence rejected:",error.message);
  process.exitCode=1;
}
