/**
 * QualityGateService
 * ==================
 * Backend service để evaluate QA artifacts dựa trên bộ rule cứng.
 * Tích hợp với SdlcWorkflowService tại QA Gate.
 *
 * Luồng:
 *   1. Nhận QA Agent output (test_cases, ac_coverage_matrix, blocker_count...)
 *   2. Classify task complexity (small/medium/large)
 *   3. Evaluate từng rule → violations[]
 *   4. Nếu gate_type == ASYNC: simulate async checks (security scan, static analysis)
 *   5. Compute score (0-100) và recommendation (PASS/HOLD/REWORK)
 *   6. Trả về QualityGateEvaluationResult
 */

'use strict';

const { getRulesForTask } = require('../config/qualityGateRules');

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GateViolation
 * @property {string} rule
 * @property {string} expected
 * @property {string} actual
 * @property {'BLOCKER'|'WARNING'|'INFO'} severity
 */

/**
 * @typedef {Object} GateCheck
 * @property {string} check
 * @property {boolean} passed
 * @property {string[]} [issues]
 * @property {string[]} [warnings]
 * @property {string} message
 */

/**
 * @typedef {Object} QualityGateEvaluationResult
 * @property {string} complexity - 'small'|'medium'|'large'
 * @property {string} gateType - 'FAST'|'ASYNC'|'STRICT'
 * @property {number} score - 0-100
 * @property {string} recommendation - 'PASS'|'HOLD'|'REWORK'
 * @property {GateViolation[]} violations
 * @property {object} metrics
 * @property {GateCheck[]} gateChecks
 * @property {string} summary
 * @property {boolean} passed
 * @property {number} minApproversRequired
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Scenario taxonomy = WHAT a test exercises (happy/negative/edge/security).
// Execution level = HOW it runs (unit/integration/e2e). These are orthogonal:
// real QA agents (e.g. Claude Code) tag `type` by level, which says nothing
// about the scenario. We therefore (1) read an explicit scenario tag when
// present, (2) recognise level tokens so they are not mistaken for "untyped",
// and (3) fall back to inferring the scenario from the title/evidence.
const SCENARIO_KEYWORDS = {
  security: ['security', 'auth', 'authz', 'permission', 'access control', 'unauthorized',
    'forbidden', 'csrf', 'xss', 'injection', 'tamper', 'forged', 'spoof', 'secret',
    'id token', 'id-token', 'token validation', 'replay', 'nonce'],
  negative: ['negative', 'error', 'invalid', 'failure', 'reject', 'missing', 'malformed',
    'expired', 'denied', 'wrong', 'empty', 'mismatch', '4xx', '5xx'],
  edge: ['edge', 'boundary', 'corner', 'concurrent', 'race', 'timeout', 'limit',
    'overflow', 'duplicate', 'retry', 'idempoten', 'large'],
  happy: ['happy', 'positive', 'functional', 'success', 'valid', 'serves', 'renders',
    'redirect', 'sign in', 'sign-in', 'login succeeds', 'returns 200', '200 ok', 'works'],
  ui: ['ui', 'visual', 'layout', 'render'],
};
const SCENARIO_ORDER = ['security', 'negative', 'edge', 'happy', 'ui'];
const LEVEL_KEYWORDS = ['unit', 'integration', 'e2e', 'end-to-end', 'end to end', 'system',
  'component', 'smoke', 'regression', 'contract', 'harness', 'api', 'acceptance',
  'snapshot', 'perf', 'performance', 'load'];

/**
 * Classify one test case.
 * @returns {{ scenario: string, explicit: boolean }} scenario bucket and whether
 *   it came from an explicit scenario tag (vs inferred from free text / unknown).
 */
function classifyTestCase(tc = {}) {
  const matches = (hay, kws) => kws.some((kw) => hay.includes(kw));
  const typeRaw = String(tc.type || '').toLowerCase();
  const explicitText = `${tc.scenario || ''} ${tc.category || ''}`.toLowerCase();

  // 1. Explicit scenario tag: a dedicated field, or a `type` that names a scenario.
  for (const scenario of SCENARIO_ORDER) {
    if (matches(explicitText, SCENARIO_KEYWORDS[scenario]) || matches(typeRaw, SCENARIO_KEYWORDS[scenario])) {
      return { scenario, explicit: true };
    }
  }

  // 2. Best-effort inference from title/evidence (NOT treated as an explicit tag).
  const freeText = `${tc.title || tc.name || ''} ${tc.evidence || tc.description || ''}`.toLowerCase();
  for (const scenario of SCENARIO_ORDER) {
    if (matches(freeText, SCENARIO_KEYWORDS[scenario])) {
      return { scenario, explicit: false };
    }
  }

  return { scenario: 'other', explicit: false };
}

/**
 * Count test cases by scenario.
 * @returns {{ counts: object, scenarioTagged: boolean }} scenarioTagged is true
 *   only when the suite carries an explicit scenario taxonomy; when false the
 *   distribution requirements are unverifiable and must not block the gate.
 */
function countTestTypes(testCases = []) {
  const counts = { happy: 0, negative: 0, edge: 0, security: 0, ui: 0, other: 0 };
  let explicitScenarioCount = 0;

  for (const tc of testCases) {
    const { scenario, explicit } = classifyTestCase(tc);
    counts[scenario] = (counts[scenario] || 0) + 1;
    if (explicit && ['happy', 'negative', 'edge', 'security'].includes(scenario)) {
      explicitScenarioCount++;
    }
  }

  return { counts, scenarioTagged: explicitScenarioCount > 0 };
}

/**
 * Compute AC coverage percentage.
 */
function computeAcCoverage(acCoverageMatrix = [], acceptanceCriteria = []) {
  if (!acceptanceCriteria || acceptanceCriteria.length === 0) return 100;
  if (!acCoverageMatrix || acCoverageMatrix.length === 0) return 0;

  const coveredCount = acCoverageMatrix.filter((row) => row.covered === true).length;
  const total = Math.max(acceptanceCriteria.length, acCoverageMatrix.length);
  return total > 0 ? Math.round((coveredCount / total) * 1000) / 10 : 0;
}

function computePlanMetrics(testCases = [], typeCounts = {}) {
  const total = testCases.length;
  const badCases = (typeCounts.negative || 0) + (typeCounts.edge || 0);
  const badCaseRatioPct = total > 0 ? Math.round((badCases / total) * 1000) / 10 : 0;
  const titles = testCases.map((testCase) => String(testCase.title || testCase.name || '').trim().toLowerCase()).filter(Boolean);
  const duplicateCount = titles.length - new Set(titles).size;
  const duplicateRatePct = titles.length > 0 ? Math.round((duplicateCount / titles.length) * 1000) / 10 : 0;
  const scopeViolations = testCases.filter((testCase) => testCase.scope_violation === true || testCase.scopeViolation === true).length;
  return { badCaseRatioPct, duplicateRatePct, scopeViolations };
}

/**
 * Simulate security scan — detects anti-patterns in code diff.
 * Returns GateCheck object.
 */
async function simulateSecurityScan(mockCodeDiff = '', riskLevel = 'LOW', delayMs = 0) {
  if (delayMs > 0) {
    // Giới hạn max delay 3s để dev experience tốt (thực tế chỉ mô phỏng)
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 3000)));
  }

  const issues = [];
  const diffLower = mockCodeDiff.toLowerCase();

  const ANTI_PATTERNS = [
    { name: 'Hardcoded password', patterns: ['password =', 'password=', 'passwd =', 'secret ='] },
    { name: 'SQL injection risk', patterns: ['`select', '+ \'where', '+ "where'] },
    { name: 'Dangerous eval()', patterns: ['eval(', 'exec('] },
    { name: 'Debug credentials', patterns: ['admin123', 'password123', 'test1234', 'qwerty'] },
    { name: 'Sensitive data in logs', patterns: ['console.log(token', 'console.log(password', 'console.log(secret'] },
  ];

  for (const { name, patterns } of ANTI_PATTERNS) {
    if (patterns.some((p) => diffLower.includes(p))) {
      issues.push(name);
    }
  }

  const passed = issues.length === 0;
  return {
    check: 'security_scan',
    passed,
    issues,
    message: passed ? '✅ No security issues detected' : `❌ Security issues found: ${issues.join(', ')}`,
    delayMs,
  };
}

/**
 * Simulate static analysis — checks code structure signals.
 */
async function simulateStaticAnalysis(mockCodeDiff = '', implementationPlan = '', delayMs = 0) {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.floor(delayMs / 2), 2000)));
  }

  const warnings = [];
  const diffLower = mockCodeDiff.toLowerCase();

  // No test files in diff
  const hasTestFiles = ['test_', '_test.', '.test.', '.spec.', 'tests/', 'test/'].some((m) => diffLower.includes(m));
  if (!hasTestFiles && mockCodeDiff.length > 200) {
    warnings.push('No test files found in code diff — consider adding unit tests');
  }

  // TODO/FIXME left in code
  if (['todo:', 'fixme:', 'hack:'].some((m) => diffLower.includes(m))) {
    warnings.push('TODO/FIXME/HACK comments found — resolve before merge');
  }

  // Error handling check
  const hasTryCatch = ['try:', 'try {', '.catch(', 'except '].some((m) => diffLower.includes(m));
  const hasExternalCalls = ['fetch(', 'axios', 'request', 'http.get', 'api'].some((m) => diffLower.includes(m));
  if (!hasTryCatch && hasExternalCalls) {
    warnings.push('External API calls without error handling detected');
  }

  // Blocking warnings (not just info)
  const blockingWarnings = warnings.filter((w) => w.includes('resolve before'));
  const passed = blockingWarnings.length === 0;

  return {
    check: 'static_analysis',
    passed,
    warnings,
    message: warnings.length === 0 ? '✅ Static analysis passed' : `⚠️ ${warnings.length} warning(s) found`,
    delayMs,
  };
}

/**
 * Compute weighted score (0-100).
 */
function computeScore({ rules, typeCounts, scenarioTagged, totalTestCases, acCoveragePct, blockerCount, gateChecksPassed }) {
  let score = 0;

  // 1. Total TC count (25 pts)
  const minTotal = rules.minTotalTestCases;
  if (totalTestCases >= minTotal) {
    score += 25;
  } else if (totalTestCases >= Math.max(1, Math.floor(minTotal * 0.7))) {
    score += 15;
  } else {
    score += Math.max(0, Math.floor(25 * (totalTestCases / Math.max(1, minTotal))));
  }

  // 2. Type distribution (25 pts). When the suite carries no explicit scenario
  // taxonomy the distribution is unmeasurable — award full credit rather than
  // penalising an otherwise passing suite that simply tagged tests by level.
  if (!scenarioTagged) {
    score += 25;
  } else {
    const typeChecks = [
      { key: 'happy', ruleKey: 'minHappyCases', maxPts: 8 },
      { key: 'negative', ruleKey: 'minNegativeCases', maxPts: 9 },
      { key: 'edge', ruleKey: 'minEdgeCases', maxPts: 5 },
      { key: 'security', ruleKey: 'minSecurityCases', maxPts: 3 },
    ];
    let typeScore = 0;
    for (const { key, ruleKey, maxPts } of typeChecks) {
      const required = rules[ruleKey] || 0;
      const actual = typeCounts[key] || 0;
      if (required === 0) {
        typeScore += maxPts;
      } else if (actual >= required) {
        typeScore += maxPts;
      } else {
        typeScore += Math.floor(maxPts * (actual / required));
      }
    }
    score += Math.min(typeScore, 25);
  }

  // 3. AC Coverage (25 pts)
  const minCoverage = rules.minAcCoveragePct;
  if (acCoveragePct >= minCoverage) {
    score += 25;
  } else {
    score += Math.floor(25 * (acCoveragePct / Math.max(1, minCoverage)));
  }

  // 4. No blockers (15 pts)
  const maxBlockers = rules.maxBlockers || 0;
  if (blockerCount <= maxBlockers) {
    score += 15;
  } else {
    score += Math.max(0, 15 - blockerCount * 5);
  }

  // 5. Gate checks (10 pts)
  if (gateChecksPassed) score += 10;

  return Math.min(100, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Main Service Class
// ---------------------------------------------------------------------------

class QualityGateService {
  /**
   * Evaluate QA output against quality gate rules.
   *
   * @param {Object} params
   * @param {string} params.featureTitle
   * @param {string} params.featureDescription
   * @param {string[]} params.acceptanceCriteria
   * @param {Object[]} params.testCases - QA Agent test_cases
   * @param {Object[]} params.acCoverageMatrix - QA Agent ac_coverage_matrix
   * @param {number} params.blockerCount
   * @param {string} params.riskLevel
   * @param {string} params.mockCodeDiff - DEV Agent mock_code_diff
   * @param {string} params.implementationPlan - DEV Agent implementation_plan
   * @param {string} [params.forceComplexity] - Override complexity detection
   * @returns {Promise<QualityGateEvaluationResult>}
   */
  async evaluate({
    featureTitle = '',
    featureDescription = '',
    acceptanceCriteria = [],
    testCases = [],
    acCoverageMatrix = [],
    blockerCount = 0,
    riskLevel = 'LOW',
    mockCodeDiff = '',
    implementationPlan = '',
    testRunReport = null,
    forceComplexity,
  } = {}) {
    // When real tests ran and all passed, scenario-distribution gaps cannot block
    // the gate — the test suite has objectively proven the feature works.
    const testsActuallyPassed = !!(
      testRunReport?.executed === true
      && typeof testRunReport?.failed === 'number'
      && testRunReport.failed === 0
      && testRunReport.total > 0
    );
    // 1. Get rules
    const { complexity, rules } = getRulesForTask({
      featureTitle,
      featureDescription,
      acceptanceCriteria,
      riskLevel,
      forceComplexity,
    });
    const gateType = rules.gateType;

    // 2. Compute metrics
    const { counts: typeCounts, scenarioTagged } = countTestTypes(testCases);
    const totalTestCases = testCases.length;
    const acCoveragePct = computeAcCoverage(acCoverageMatrix, acceptanceCriteria);
    const { badCaseRatioPct, duplicateRatePct, scopeViolations } = computePlanMetrics(testCases, typeCounts);

    // 3. Async gate checks
    let gateChecks = [];
    if (gateType === 'FAST') {
      gateChecks = [{ check: 'fast_gate', passed: true, message: '✅ Fast gate — no async checks required' }];
    } else {
      const checkPromises = [];
      const delay = rules.simulateDelayMs || 0;

      if (rules.requireSecurityScan) {
        checkPromises.push(simulateSecurityScan(mockCodeDiff, riskLevel, delay));
      }
      if (rules.requireStaticAnalysis) {
        checkPromises.push(simulateStaticAnalysis(mockCodeDiff, implementationPlan, delay));
      }

      if (checkPromises.length > 0) {
        gateChecks = await Promise.all(checkPromises);
      } else {
        gateChecks = [{ check: 'gate', passed: true, message: '✅ Gate checks completed' }];
      }
    }

    const gateChecksPassed = gateChecks.every((c) => c.passed !== false);

    // 4. Collect violations
    /** @type {GateViolation[]} */
    const violations = [];

    // Total test case count
    if (totalTestCases < rules.minTotalTestCases) {
      violations.push({
        rule: 'minTotalTestCases',
        expected: `>= ${rules.minTotalTestCases} test cases`,
        actual: `${totalTestCases} test cases`,
        severity: 'BLOCKER',
      });
    }

    // Type distribution
    const typeRules = [
      { key: 'happy', ruleKey: 'minHappyCases', label: 'Happy path test cases' },
      { key: 'negative', ruleKey: 'minNegativeCases', label: 'Negative test cases' },
      { key: 'edge', ruleKey: 'minEdgeCases', label: 'Edge case test cases' },
      { key: 'security', ruleKey: 'minSecurityCases', label: 'Security test cases' },
    ];
    for (const { key, ruleKey, label } of typeRules) {
      const required = rules[ruleKey] || 0;
      const actual = typeCounts[key] || 0;
      if (actual < required) {
        violations.push({
          rule: ruleKey,
          expected: `>= ${required} ${label}`,
          actual: `${actual} ${label}`,
          // Block only when: (a) suite uses explicit scenario taxonomy AND
          // (b) a whole category is missing AND (c) real tests did NOT all pass.
          // When all tests passed, the taxonomy gap is a labelling issue, not
          // a quality issue — downgrade to WARNING so the gate does not stall.
          severity: scenarioTagged && required > 0 && actual === 0 && !testsActuallyPassed
            ? 'BLOCKER'
            : 'WARNING',
        });
      }
    }

    // AC coverage
    if (acCoveragePct < rules.minAcCoveragePct) {
      violations.push({
        rule: 'minAcCoveragePct',
        expected: `>= ${rules.minAcCoveragePct}% AC coverage`,
        actual: `${acCoveragePct}% AC coverage`,
        severity: acCoveragePct < rules.minAcCoveragePct * 0.7 ? 'BLOCKER' : 'WARNING',
      });
    }

    if (badCaseRatioPct < rules.minBadCaseRatioPct) {
      violations.push({
        rule: 'minBadCaseRatioPct',
        expected: `>= ${rules.minBadCaseRatioPct}% negative or edge cases`,
        actual: `${badCaseRatioPct}% negative or edge cases`,
        // Derived from the scenario split — only enforce it when scenarios are tagged.
        severity: scenarioTagged ? 'BLOCKER' : 'WARNING',
      });
    }

    if (duplicateRatePct > rules.maxDuplicateRatePct) {
      violations.push({
        rule: 'maxDuplicateRatePct',
        expected: `<= ${rules.maxDuplicateRatePct}% duplicate cases`,
        actual: `${duplicateRatePct}% duplicate cases`,
        severity: 'BLOCKER',
      });
    }

    if (scopeViolations > rules.maxScopeViolations) {
      violations.push({
        rule: 'maxScopeViolations',
        expected: `<= ${rules.maxScopeViolations} scope violations`,
        actual: `${scopeViolations} scope violations`,
        severity: 'BLOCKER',
      });
    }

    // Blockers
    if (blockerCount > rules.maxBlockers) {
      violations.push({
        rule: 'maxBlockers',
        expected: `<= ${rules.maxBlockers} blocker(s)`,
        actual: `${blockerCount} blocker(s)`,
        severity: 'BLOCKER',
      });
    }

    // Gate check violations
    for (const check of gateChecks) {
      if (!check.passed) {
        const issues = check.issues || check.warnings || [];
        for (const issue of issues) {
          violations.push({
            rule: `gateCheck.${check.check}`,
            expected: 'No issues',
            actual: issue,
            severity: check.check === 'static_analysis' ? 'WARNING' : 'BLOCKER',
          });
        }
      }
    }

    // 5. Compute score
    const score = computeScore({
      rules,
      typeCounts,
      scenarioTagged,
      totalTestCases,
      acCoveragePct,
      blockerCount,
      gateChecksPassed,
    });

    // 6. Recommendation
    const blockerViolations = violations.filter((v) => v.severity === 'BLOCKER');
    let recommendation;
    if (blockerViolations.length > 0) {
      recommendation = 'REWORK';
    } else if (score >= rules.passingScore) {
      recommendation = 'PASS';
    } else if (score >= rules.holdScore) {
      recommendation = 'HOLD';
    } else {
      recommendation = 'REWORK';
    }

    // 7. Build summary
    const summaryLines = [
      `[${complexity.toUpperCase()} / ${gateType}] Score: ${score}/100 → ${recommendation}`,
      `Test Cases: ${totalTestCases} total (happy=${typeCounts.happy}, negative=${typeCounts.negative}, edge=${typeCounts.edge}, security=${typeCounts.security})`,
      `AC Coverage: ${acCoveragePct}% | Blockers: ${blockerCount}`,
    ];
    if (violations.length > 0) {
      summaryLines.push(`Violations (${violations.length}): ${violations.slice(0, 5).map((v) => `${v.rule} [${v.severity}]`).join('; ')}`);
    }
    const failedChecks = gateChecks.filter((c) => !c.passed);
    if (failedChecks.length > 0) {
      summaryLines.push(`Gate failures: ${failedChecks.map((c) => c.check).join(', ')}`);
    }

    return {
      complexity,
      gateType,
      score,
      recommendation,
      violations,
      metrics: {
        totalTestCases,
        typeCounts,
        acCoveragePct,
        badCaseRatioPct,
        duplicateRatePct,
        scopeViolations,
        blockerCount,
        minTotalRequired: rules.minTotalTestCases,
        minHappyRequired: rules.minHappyCases,
        minNegativeRequired: rules.minNegativeCases,
        minEdgeRequired: rules.minEdgeCases,
        minSecurityRequired: rules.minSecurityCases,
        minAcCoverageRequired: rules.minAcCoveragePct,
        minApproversRequired: rules.minApprovers || 1,
      },
      gateChecks,
      summary: summaryLines.join('\n'),
      passed: recommendation === 'PASS',
      minApproversRequired: rules.minApprovers || 1,
    };
  }
}

module.exports = new QualityGateService();
module.exports.QualityGateService = QualityGateService;
