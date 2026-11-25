// Source-free, read-only GitHub workflow identity gate for actual DOP guest CI.
// A matching workflow identity is necessary, never sufficient, for guest proof.
// Source-org workflow content/permissions MUST be reviewed independently.
const workflows = Object.freeze({
  java: Object.freeze({
    repository: 'ores-truffle-oreslang/oreslang-source.java',
    workflowId: 409763119,
    path: '.github/workflows/dop-scalar-java-guest.yml',
    name: 'AttoLang DOP Java scalar JIT guest exact-head',
    job: 'scalar-dop-java-jit'
  }),
  llvm: Object.freeze({
    repository: 'ores-truffle-oreslang/oreslang-source.llvm',
    workflowId: 404132837,
    path: '.github/workflows/dop-atto-soa-native.yml',
    name: 'Native AttoLang DOP SoA guest AOT smoke',
    job: 'native-guest'
  })
});

export function validateDopWorkflowIdentity(receipt, run, job, expectedRepo) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    return ['workflow-receipt-object'];
  const policy = Object.hasOwn(workflows, receipt.backend) ? workflows[receipt.backend] : null;
  if (!policy) return ['backend-workflow-not-registered'];
  const need = (yes, error) => { if (!yes) errors.push(error); };
  need(expectedRepo === policy.repository, 'workflow-source-repository');
  need(run !== null && typeof run === 'object' && !Array.isArray(run), 'workflow-run-object');
  need(job !== null && typeof job === 'object' && !Array.isArray(job), 'workflow-job-object');
  if (!run || typeof run !== 'object' || Array.isArray(run) ||
      !job || typeof job !== 'object' || Array.isArray(job)) return errors;
  need(run.path === policy.path, 'workflow-path');
  need(run.name === policy.name, 'workflow-name');
  need(run.workflow_id === policy.workflowId, 'workflow-id');
  need(run.event === 'pull_request' || run.event === 'workflow_dispatch', 'workflow-event');
  need(job.workflow_name === policy.name, 'job-workflow-name');
  need(job.name === policy.job, 'workflow-job-name');
  return errors;
}
