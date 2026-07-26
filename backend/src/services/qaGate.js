// qaGate — shared helper for "did QA actually pass?" used by both
// `SdlcWorkflowService.resolveOutputReviewGate` (which decides whether to
// create a FINAL_RELEASE gate after QA approval) and
// `releaseManager.submitReleaseDecision` (which validates the same QA run
// before accepting APPROVE/REJECT).
//
// Lives in its own module so neither service has to import the other —
// `releaseManager` already imports from `SdlcWorkflowService`'s sibling
// graph, and inverting that would create a cycle.

function qaGatePassed(task) {
  if (!task) return false;
  if (task.result?.gateRecommendation === 'PASS') return true;

  const tr = task.agentOutput?.test_run_report || {};
  return (
    tr.executed === true
    && typeof tr.failed === 'number'
    && tr.failed === 0
    && (tr.total || 0) > 0
  );
}

module.exports = { qaGatePassed };