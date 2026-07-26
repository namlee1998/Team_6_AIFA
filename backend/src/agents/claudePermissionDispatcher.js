// Policy adapter from Claude Agent SDK callbacks to AIFA's persisted gate system.
//
// Beginner reading guide: dispatch() first handles non-interactive mode, then
// separates AskUserQuestion from tool calls. Read-only tools are checked here;
// write/shell risk classification is delegated to riskClassifier. gateBridge
// owns wait/resume persistence, so this file contains no workflow ordering.

const path = require('path');
const gateBridge = require('../services/gateBridge');
const riskClassifier = require('../services/riskClassifier');
const taskWorker = require('../services/taskWorkerService');

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'List', 'View']);
const SECRET_PATH = /(^|\/)\.env(\..*)?$|\.pem$|\.key$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$|(^|\/)credentials(\.json)?$|(^|\/)secrets?(\.|\/|$)|(^|\/)\.git-credentials$/i;

function norm(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function inputPath(input = {}) {
  return input.file_path || input.filePath || input.path || input.pattern || input.glob || input.target || '';
}

function isPathEscape(candidate) {
  const raw = String(candidate || '');
  if (!raw) return false;
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) return true;
  let depth = 0;
  for (const seg of norm(raw).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

function classifyReadOnly(toolName, input = {}) {
  if (!READ_ONLY_TOOLS.has(toolName)) return null;
  const rel = norm(inputPath(input));
  if (rel && isPathEscape(rel)) {
    return { tier: 'block', reason: 'Reading outside the repo is not allowed', category: 'outside_repo' };
  }
  if (rel && SECRET_PATH.test(rel)) {
    return { tier: 'block', reason: 'Reading secret/.env/key files is not allowed', category: 'secret' };
  }
  return { tier: 'auto', reason: 'Read-only repo inspection is safe', category: 'read_only' };
}

function questionPayload({ taskId, role, input = {}, options = {} }) {
  const questions = Array.isArray(input.questions)
    ? input.questions
    : (input.question || input.prompt ? [{ question: input.question || input.prompt, options: input.options || [] }] : []);
  return {
    type: 'clarifying_question',
    taskId,
    stage: role,
    toolUseID: input.tool_use_id || options.toolUseID || null,
    questions,
    rawInput: input,
    prompt: options.title || options.displayName || null,
    actions: ['submit_answer', 'cancel'],
  };
}

function toolPayload({ taskId, role, toolName, input = {}, options = {}, decision = {} }) {
  return {
    type: 'tool_permission',
    taskId,
    stage: role,
    toolUseID: input.tool_use_id || options.toolUseID || null,
    toolName,
    toolInput: input,
    // Compatibility fields used by the existing AIFA board.
    tool: toolName,
    file_path: inputPath(input) || null,
    diff: input.diff || input.content || null,
    riskLevel: decision.category === 'shell' || decision.category === 'security' ? 'high' : 'medium',
    display: {
      command: input.command || null,
      filePath: inputPath(input) || null,
      diffPreview: input.diff || input.content || null,
      prompt: options.title || options.displayName || null,
    },
    reason: decision.reason || 'Tool action requires approval',
    category: decision.category || 'unknown',
    actions: ['approve', 'deny'],
  };
}

function normalizeQuestionAnswers(input, answers) {
  if (answers && !Array.isArray(answers) && typeof answers === 'object') return answers;
  const values = Array.isArray(answers) ? answers : (answers == null ? [] : [answers]);
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return Object.fromEntries(questions.map((question, index) => [
    question.question,
    String(values[index] ?? values[0] ?? ''),
  ]));
}

function defaultQuestionAnswers(input = {}) {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return Object.fromEntries(questions.map((question) => {
    const options = Array.isArray(question.options) ? question.options : [];
    const preferred = options.find((option) => /\brecommended\b/i.test(option.label || option.description || ''))
      || options[0];
    return [question.question, preferred?.label || 'Use your best judgment and continue.'];
  }));
}

function interactiveGatesEnabled() {
  return process.env.CLAUDE_CODE_INTERACTIVE_GATES === 'true';
}

async function handleNonInteractive(ctx) {
  const { toolName, input, options, role, scope, audit } = ctx;
  if (toolName === 'AskUserQuestion') {
    const answers = defaultQuestionAnswers(input);
    audit({ kind: 'GATE_AUTO', role, toolName, detail: 'question auto-answered in non-interactive mode', answers });
    return {
      behavior: 'allow',
      updatedInput: { ...input, answers },
      toolUseID: input.tool_use_id || options.toolUseID || undefined,
    };
  }

  const readOnly = classifyReadOnly(toolName, input);
  const decision = readOnly || riskClassifier.classifyAction(toolName, input, scope);
  if (decision.tier === 'block') {
    audit({ kind: 'GATE_BLOCK', role, toolName, detail: decision.reason, file: inputPath(input) || null, category: decision.category });
    return { behavior: 'deny', message: decision.reason, toolUseID: input.tool_use_id || options.toolUseID || undefined };
  }

  audit({
    kind: 'GATE_AUTO',
    role,
    toolName,
    detail: `${decision.reason} (auto-allowed; interactive UI gates disabled)`,
    file: inputPath(input) || null,
    category: decision.category,
  });
  return { behavior: 'allow', updatedInput: input, toolUseID: input.tool_use_id || options.toolUseID || undefined };
}

async function waitForGate(taskId, gateRequest) {
  taskWorker.pauseBudget(taskId);
  try {
    await gateRequest.ready;
    return await gateRequest.promise;
  } finally {
    taskWorker.resumeBudget(taskId);
  }
}

async function handleQuestion(ctx) {
  const { taskId, projectId, sessionId, role, input, options, audit } = ctx;
  audit({ kind: 'GATE_QUESTION', role, detail: 'asked clarifying questions', toolName: 'AskUserQuestion' });
  const gate = gateBridge.requestGate({
    taskId,
    sessionId,
    projectId,
    role,
    kind: 'question',
    payload: questionPayload(ctx),
    timeoutMs: Number(process.env.CLARIFYING_QUESTION_TIMEOUT_MS) || undefined,
  });
  const result = await waitForGate(taskId, gate);
  const answers = normalizeQuestionAnswers(input, result.answers || result.updatedInput?.answers || []);
  audit({
    kind: 'GATE_ANSWER',
    role,
    approvalId: gate.approvalId,
    detail: result.timedOut ? 'defaults used (timeout)' : 'human answered',
    answers,
  });
  return {
    behavior: 'allow',
    updatedInput: {
      questions: Array.isArray(input.questions) ? input.questions : questionPayload(ctx).questions,
      answers,
      timedOut: !!result.timedOut,
    },
    toolUseID: input.tool_use_id || options.toolUseID || undefined,
  };
}

async function handleTool(ctx, decision) {
  const { taskId, projectId, sessionId, role, toolName, input, options, audit } = ctx;
  if (decision.tier === 'auto') {
    audit({
      kind: 'GATE_AUTO',
      role,
      toolName,
      detail: decision.reason,
      file: inputPath(input) || null,
      category: decision.category,
    });
    return { behavior: 'allow', auto: true, toolUseID: input.tool_use_id || options.toolUseID || undefined };
  }

  if (decision.tier === 'block') {
    audit({
      kind: 'GATE_BLOCK',
      role,
      toolName,
      detail: decision.reason,
      file: inputPath(input) || null,
      category: decision.category,
    });
    return { behavior: 'deny', message: decision.reason, toolUseID: input.tool_use_id || options.toolUseID || undefined };
  }

  audit({
    kind: 'GATE_REQUEST',
    role,
    toolName,
    detail: decision.reason,
    file: inputPath(input) || null,
    category: decision.category,
  });
  const gate = gateBridge.requestGate({
    taskId,
    sessionId,
    projectId,
    role,
    kind: 'tool',
    payload: toolPayload({ ...ctx, decision }),
    timeoutMs: Number(process.env.TOOL_PERMISSION_TIMEOUT_MS) || undefined,
  });
  const result = await waitForGate(taskId, gate);
  const approved = result.action === 'approve' && !result.timedOut;
  audit({
    kind: 'GATE_DECISION',
    role,
    approvalId: gate.approvalId,
    toolName,
    detail: approved ? 'approved' : `denied${result.timedOut ? ' (timeout)' : ''}`,
    comment: result.comment || null,
    file: inputPath(input) || null,
  });
  return approved
    ? { behavior: 'allow', toolUseID: input.tool_use_id || options.toolUseID || undefined }
    : { behavior: 'deny', message: result.comment || 'Rejected by reviewer', toolUseID: input.tool_use_id || options.toolUseID || undefined };
}

async function dispatch({
  toolName,
  input = {},
  options = {},
  taskId,
  sessionId = null,
  projectId = null,
  role,
  scope = {},
  audit = () => {},
}) {
  if (!interactiveGatesEnabled()) {
    return handleNonInteractive({ toolName, input, options, taskId, projectId, role, scope, audit });
  }

  if (toolName === 'AskUserQuestion') {
    return handleQuestion({ toolName, input, options, taskId, sessionId, projectId, role, scope, audit });
  }

  const readOnly = classifyReadOnly(toolName, input);
  const decision = readOnly || riskClassifier.classifyAction(toolName, input, scope);
  return handleTool({ toolName, input, options, taskId, sessionId, projectId, role, scope, audit }, decision);
}

module.exports = {
  dispatch,
  _internal: {
    classifyReadOnly,
    inputPath,
    isPathEscape,
    questionPayload,
    toolPayload,
    normalizeQuestionAnswers,
    defaultQuestionAnswers,
    interactiveGatesEnabled,
    handleNonInteractive,
  },
};
