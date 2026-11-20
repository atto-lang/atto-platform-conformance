#!/usr/bin/env node
// Consistency-only inspection. This CLI never promotes compiler support.
import { open, constants } from "node:fs/promises";
import { validateRealCompilerReport } from "../src/real-evidence.mjs";

const MAX_REPORT_BYTES = 256 * 1024;

async function readBoundedReport(file) {
  // CI evidence may be externally supplied. Never load unbounded JSON into
  // memory, follow a symlink, or process non-regular files.
  // O_NONBLOCK must be present BEFORE fstat: opening a FIFO with O_RDONLY
  // can otherwise block forever waiting for a writer. O_NOFOLLOW must also
  // be available or symlinks could be followed on some platforms.
  if (typeof constants.O_NONBLOCK !== "number" || typeof constants.O_NOFOLLOW !== "number") {
    throw Error("platform lacks required nonblocking/no-follow file primitives");
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) {
      throw Error("report must be a regular file not larger than 256 KiB");
    }
    const output = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let offset = 0;
    while (offset < output.length) {
      const { bytesRead } = await handle.read(output, offset, output.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_REPORT_BYTES) throw Error("report grew beyond 256 KiB limit");
    return JSON.parse(output.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
}

const [file] = process.argv.slice(2);
if (!file || process.argv.length !== 3) {
  console.error("usage: node bin/inspect-real-evidence.mjs <private-ci-report.json>");
  process.exit(2);
}
try {
  const report = await readBoundedReport(file);
  const result = validateRealCompilerReport(report);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("evidence rejected: " + error.message);
  process.exitCode = 1;
}
