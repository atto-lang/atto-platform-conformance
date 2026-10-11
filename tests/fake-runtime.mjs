// Fake runtime is used ONLY to exercise failure handling in unit tests.
import {basename} from "node:path";
const id=basename(process.argv[2]||"");
const values={"int-arithmetic.ores":"42","forward-call.ores":"42","arithmetic-precedence.ores":"28"};
if(!Object.hasOwn(values,id)){console.error("fake runtime missing fixture");process.exitCode=1}
else console.log(values[id]);
