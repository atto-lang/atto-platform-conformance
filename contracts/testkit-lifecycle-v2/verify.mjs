// Host-only reference for ORES_TEST_V2. Does not authenticate guest execution.
const kinds = new Set(["callback", "task", "actor", "await"]);
const outcomes = new Set(["ok", "error", "cancel"]);
const statuses = new Set(["PASS", "FAIL", "SKIP"]);
const idPattern = /^[A-Za-z0-9_./-]{1,256}$/;
const fail = message => { throw new Error("INVALID_LIFECYCLE: " + message); };
export const REQUIRED_BACKENDS = Object.freeze(["java","llvm","wasm","cranelift","net"]);

export function verifyLifecycleV2(output) {
  if (typeof output !== "string" || !output.endsWith("\n") ||
      Buffer.byteLength(output, "utf8") > 4_000_000 || /[\r\0]/.test(output))
    fail("noncanonical or unbounded output");
  const cases = new Map();
  let started = false, ended = false, recordCount = 0, summary = null;
  for (const line of output.slice(0,-1).split("\n")) {
    if (line.startsWith("ORES_TEST") && !line.startsWith("ORES_TEST_V2|"))
      fail("mixed or truncated machine record");
    if (!line.startsWith("ORES_TEST_V2|")) continue;
    if (++recordCount > 100_000 || ended || !/^[\x20-\x7e]+$/.test(line))
      fail("out-of-order or malformed record");
    const [event,...args] = line.slice("ORES_TEST_V2|".length).split("|");
    if (event === "RUN_BEGIN" && !started && args.length === 1 && args[0] === "2") {
      started = true;
    } else if (event === "CASE_BEGIN" && started && args.length === 1) {
      const id = args[0];
      if (!idPattern.test(id) || cases.has(id) || cases.size >= 10_000)
        fail("invalid or duplicate case");
      cases.set(id,{seen:new Set(),pending:new Map(),bad:false,status:null});
    } else if (event === "OPEN" && started && args.length === 3) {
      const [id,kind,handle] = args, c = cases.get(id);
      if (!c || c.status || !kinds.has(kind) || !idPattern.test(handle) || c.seen.has(handle))
        fail("cross-case or duplicated resource handle");
      c.seen.add(handle);
      c.pending.set(handle,kind);
    } else if (event === "CLOSE" && started && args.length === 4) {
      const [id,kind,handle,outcome] = args, c = cases.get(id);
      if (!c || c.status || !kinds.has(kind) || !outcomes.has(outcome) ||
          c.pending.get(handle) !== kind)
        fail("unmatched or duplicate completion");
      c.pending.delete(handle);
      c.bad ||= outcome !== "ok";
    } else if (event === "CASE_END" && started && args.length === 2) {
      const [id,status] = args, c = cases.get(id);
      if (!c || c.status || !statuses.has(status) || c.pending.size ||
          (status === "PASS" && c.bad) || (status === "SKIP" && c.seen.size))
        fail("early or contradictory case termination");
      c.status = status;
    } else if (event === "RUN_END" && started && args.length === 5) {
      const values = new Map();
      for (const part of args) {
        const match = /^(total|passed|failed|skipped|filtered)=([0-9]+)$/.exec(part);
        if (!match || values.has(match[1])) fail("invalid or duplicate summary field");
        const value = Number(match[2]);
        if (!Number.isSafeInteger(value)) fail("summary count overflow");
        values.set(match[1],value);
      }
      if (values.size !== 5 || values.get("total") > 10_000 ||
          values.get("filtered") > 10_000 ||
          values.get("total") + values.get("filtered") > 10_000)
        fail("summary budget");
      summary = Object.fromEntries(values);
      ended = true;
    } else {
      fail("unknown lifecycle record");
    }
  }
  if (!started || !ended || !cases.size) fail("missing run or cases");
  const counts = {PASS:0,FAIL:0,SKIP:0};
  for (const c of cases.values()) {
    if (!c.status) fail("unterminated case");
    counts[c.status]++;
  }
  if (counts.PASS + counts.FAIL === 0 ||
      summary.total !== cases.size || summary.passed !== counts.PASS ||
      summary.failed !== counts.FAIL || summary.skipped !== counts.SKIP)
    fail("vacuous or inconsistent summary");
  return {...summary,evidence:"UNAUTHENTICATED_STRUCTURAL_ONLY"};
}

// Reporting a stepful workflow is necessary but not sufficient. This is
// metadata consistency, not a GitHub signature or runtime attestation.
export function verifyFiveBackendObservations(matrix) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix) ||
      Object.keys(matrix).sort().join() !== [...REQUIRED_BACKENDS].sort().join())
    fail("exact five-backend coverage required");
  return REQUIRED_BACKENDS.map(backend => {
    const row = matrix[backend];
    if (!row || !["NOT_EXECUTED","UNSUPPORTED","HOST_MODEL","GUEST_EXECUTED"].includes(row.state))
      fail("missing evidence state: " + backend);
    if (row.state === "GUEST_EXECUTED") {
      if (!Number.isSafeInteger(row.steps) || row.steps < 1 ||
          !/^[0-9a-f]{40}$/.test(row.source_sha ?? "") ||
          !/^[0-9a-f]{64}$/.test(row.compiler_sha256 ?? "") ||
          typeof row.receipt !== "string") fail("missing compiler/run evidence pins: " + backend);
      verifyLifecycleV2(row.receipt);
    } else if (row.receipt !== undefined || row.steps !== undefined) {
      fail("host-only or unsupported state cannot claim guest receipt: " + backend);
    }
    return {backend,state:row.state,claim:"UNAUTHENTICATED_METADATA_ONLY"};
  });
}