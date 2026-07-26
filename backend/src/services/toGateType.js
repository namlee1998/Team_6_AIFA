// Business helper: map (role, kind) → canonical GateType.
//
// Lives in services/ because it is BUSINESS logic (the role→gate-type
// mapping is a domain rule, not a transport detail). Used by
// gateBridge.requestGate when constructing a gate_pending envelope.
//
// This module MUST NOT be imported by eventBus, the controller, the SSE
// writer, or any transport-layer code.

const ROLE_BY_GATE_TYPE = {
  PO_CLARIFY: 'po-agent',
  UX_CLARIFY: 'ux-agent',
  DEV_CLARIFY: 'dev-agent',
  QA_CLARIFY: 'qa-agent',
  AGENT_CLARIFY: null,
  DEV_FILE_GATE: 'dev-agent',
  PO_OUTPUT_REVIEW: 'po-agent',
  UX_OUTPUT_REVIEW: 'ux-agent',
  DEV_OUTPUT_REVIEW: 'dev-agent',
  QA_OUTPUT_REVIEW: 'qa-agent',
  AGENT_OUTPUT_REVIEW: null,
  FINAL_RELEASE: null,
  HITL_REVIEW: null,
};

const KIND_BY_GATE_TYPE = {
  PO_CLARIFY: 'question',
  UX_CLARIFY: 'question',
  DEV_CLARIFY: 'question',
  QA_CLARIFY: 'question',
  AGENT_CLARIFY: 'question',
  DEV_FILE_GATE: 'tool',
  PO_OUTPUT_REVIEW: 'output_review',
  UX_OUTPUT_REVIEW: 'output_review',
  DEV_OUTPUT_REVIEW: 'output_review',
  QA_OUTPUT_REVIEW: 'output_review',
  AGENT_OUTPUT_REVIEW: 'output_review',
  FINAL_RELEASE: 'release',
  HITL_REVIEW: 'tool',
};

function toGateType(role, kind) {
  if (kind === 'release') return 'FINAL_RELEASE';
  if (kind === 'tool') {
    if (role === 'dev-agent') return 'DEV_FILE_GATE';
    return 'HITL_REVIEW';
  }
  if (kind === 'output_review') {
    if (role === 'po-agent') return 'PO_OUTPUT_REVIEW';
    if (role === 'ux-agent') return 'UX_OUTPUT_REVIEW';
    if (role === 'dev-agent') return 'DEV_OUTPUT_REVIEW';
    if (role === 'qa-agent') return 'QA_OUTPUT_REVIEW';
    return 'AGENT_OUTPUT_REVIEW';
  }
  // question
  if (role === 'po-agent') return 'PO_CLARIFY';
  if (role === 'ux-agent') return 'UX_CLARIFY';
  if (role === 'dev-agent') return 'DEV_CLARIFY';
  if (role === 'qa-agent') return 'QA_CLARIFY';
  return 'AGENT_CLARIFY';
}

module.exports = { toGateType, ROLE_BY_GATE_TYPE, KIND_BY_GATE_TYPE };