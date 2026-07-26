// Phase 3.3 — QA prompt migrated to canonical validation owner
// (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 3.3). QA becomes
// the authoritative owner of build_result, self_test_report,
// risk_classification, risk_assessment, security_notes, security_gate,
// and linked_ac_ids. The output schema is unchanged in this phase
// (Phase 3.6 will update REQUIRED_OUTPUT_KEYS). QA is instructed to
// generate its own validation plan from PRD + AC and ground release
// recommendations in executed evidence.

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(
  __dirname, '..', '..', 'src', 'agents', 'prompts', 'qa.prompt.md'
);

function readPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

describe('QA prompt — Phase 3.3 migration', () => {
  const prompt = readPrompt();

  // ---------------------------------------------------------------------------
  // 1. Canonical input
  // ---------------------------------------------------------------------------
  describe('canonical input', () => {
    test('names project_definition as the canonical A2A contract', () => {
      expect(prompt).toMatch(/project_definition/);
      expect(prompt).toMatch(/canonical A2A contract/i);
    });

    test('treats PRD and AC as authoritative validation sources', () => {
      expect(prompt).toMatch(/prd[\s\S]*authoritative source for\s*what to validate/i);
      expect(prompt).toMatch(/acceptance_criteria[\s\S]*authoritative pass\/fail target/i);
    });

    test('treats DEV diff as implementation evidence, NOT validation truth', () => {
      // The review explicitly called this out: QA must not conclude
      // "the change works" from reading the diff.
      expect(prompt).toMatch(/implementation evidence only/i);
      expect(prompt).toMatch(/NOT[\s\S]*validation truth/i);
      // Phrase may wrap onto two lines — match cross-line.
      expect(prompt).toMatch(/Do not[\s\S]{0,10}conclude[\s\S]{0,80}run[\s\S]{0,5}it/i);
    });

    test('explicitly marks architecture_brief as legacy / derived documentation', () => {
      expect(prompt).toMatch(/architecture_brief[\s\S]*legacy[\s\S]*derived documentation/i);
      expect(prompt).toMatch(/prefer `project_definition`/);
    });

    test('instructs QA not to ask the user about tech fields already in project_definition', () => {
      expect(prompt).toMatch(/MUST NOT call `AskUserQuestion`/);
      expect(prompt).toMatch(/tech stack/);
      expect(prompt).toMatch(/already in/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. QA is the canonical owner of the 7 artifacts previously emitted
  //    by DEV / PO.
  // ---------------------------------------------------------------------------
  describe('canonical ownership of validation artifacts', () => {
    const QA_OWNED = [
      'build_result',
      'self_test_report',
      'risk_classification',
      'risk_assessment',
      'security_notes',
      'security_gate',
      'linked_ac_ids',
    ];

    test.each(QA_OWNED)('declares %s as QA canonical owner', (key) => {
      // Each artifact must appear in the ownership-transfer section
      // (or an ownership block) with explicit QA attribution.
      const idx = prompt.indexOf('## Canonical ownership transfer');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', '## Canonical ownership transfer'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      // The key must appear in the ownership-transfer block, and QA
      // must be marked as the canonical owner for that row. We accept
      // either an explicit "(canonical)" label or the bold-italic
      // "**QA**" cell, or the prose "QA (canonical)" pattern.
      const keyPresent = new RegExp(`\`${key}\``).test(text);
      expect(keyPresent).toBe(true);
      // QA attribution somewhere near the key row.
      const qaAttribution = new RegExp(`\`${key}\`[\\s\\S]{0,300}\\bQA\\b`, 'i');
      expect(text).toMatch(qaAttribution);
    });

    test('build_result is the published authoritative build (DEV local sanity is not)', () => {
      expect(prompt).toMatch(/Developer Build[\s\S]*local sanity check/i);
      expect(prompt).toMatch(/QA Build Result[\s\S]*official published/i);
      expect(prompt).toMatch(/QA is the only[\s\S]*owner of the published build result/i);
    });

    test('risk_classification is owned by QA, with PO and DEV labelled advisory / legacy', () => {
      // Locked §11.1.
      expect(prompt).toMatch(/risk_classification[\s\S]*PO[\s\S]*advisory/i);
      expect(prompt).toMatch(/risk_classification[\s\S]*DEV[\s\S]*legacy/i);
      expect(prompt).toMatch(/risk_classification[\s\S]*QA[\s\S]*canonical/i);
    });

    test('linked_ac_ids is derived from PRD/AC traceability, not maintained by DEV', () => {
      expect(prompt).toMatch(/linked_ac_ids[\s\S]*PRD[\s\S]*AC[\s\S]*traceability/i);
      expect(prompt).toMatch(/not maintained by DEV/i);
    });

    test('explicitly attributes release risk and security verification to QA', () => {
      const ownershipBlock = prompt.match(/## QA ownership[\s\S]*?(?=\n## |\Z)/);
      expect(ownershipBlock).not.toBeNull();
      const text = ownershipBlock[0];
      expect(text).toMatch(/Implementation risk[\s\S]*risk_classification[\s\S]*risk_assessment/i);
      expect(text).toMatch(/Security verification[\s\S]*security_notes[\s\S]*security_gate/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. QA generates its own test cases — does not merely re-run DEV output.
  // ---------------------------------------------------------------------------
  describe('test generation', () => {
    test('QA derives test cases from PRD + AC, not from DEV diff', () => {
      expect(prompt).toMatch(/generate (your )?own (test cases|validation plan)/i);
      expect(prompt).toMatch(/derive[\s\S]*test cases[\s\S]*PRD[\s\S]*Acceptance Criteria/i);
    });

    test('each test case must trace to an AC or a PRD requirement', () => {
      expect(prompt).toMatch(/traces? to (an|the) AC/i);
      expect(prompt).toMatch(/traces? to[\s\S]*AC[\s\S]*PRD/i);
      expect(prompt).toMatch(/never just to[\s\S]*DEV diff/i);
    });

    test('prompt explicitly forbids silently promoting skipped tests to pass', () => {
      // Phrase may wrap onto two lines.
      expect(prompt).toMatch(/do not[\s\S]{0,5}silently[\s\S]{0,5}promote/i);
      expect(prompt).toMatch(/result:\s*"skip"/);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Release recommendation based on executed evidence.
  // ---------------------------------------------------------------------------
  describe('release recommendation = executed evidence', () => {
    test('release_reason must reference executed evidence', () => {
      expect(prompt).toMatch(/release_reason[\s\S]*executed evidence/i);
      expect(prompt).toMatch(/NOT[\s\S]*static inspection/i);
    });

    test('blocker_count derived from executed failures', () => {
      expect(prompt).toMatch(/blocker_count[\s\S]*executed/i);
    });

    test('QA does not approve the final release — Release Manager owns the decision', () => {
      expect(prompt).toMatch(/do not approve the final release/i);
      expect(prompt).toMatch(/Release Manager owns/i);
      expect(prompt).toMatch(/release_decision/);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Schema is unchanged in Phase 3.3.
  // ---------------------------------------------------------------------------
  test('preserves every required QA output key (no schema drift)', () => {
    // Phase 3.6 expanded QA's contract to 13 keys: the original 6 plus
    // the 7 validation artifacts promoted from DEV.
    for (const key of [
      'test_cases',
      'ac_coverage_matrix',
      'test_run_report',
      'qa_report',
      'blocker_count',
      'release_reason',
      // Phase 3.6 additions:
      'build_result',
      'self_test_report',
      'linked_ac_ids',
      'risk_classification',
      'risk_assessment',
      'security_notes',
      'security_gate',
    ]) {
      expect(prompt).toMatch(new RegExp(`\`${key}\``));
    }
  });

  test('Phase 3.6 — newly QA-owned keys ARE present in the required output', () => {
    // Phase 3.6 promoted 7 validation artifacts from DEV to QA. The QA
    // prompt must document them as QA's required output.
    const idx = prompt.indexOf('## Required output');
    expect(idx).toBeGreaterThan(-1);
    const tail = prompt.slice(idx);
    const nextHeading = tail.indexOf('\n## ', '## Required output'.length);
    const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
    for (const key of [
      'build_result',
      'self_test_report',
      'linked_ac_ids',
      'risk_classification',
      'risk_assessment',
      'security_notes',
      'security_gate',
    ]) {
      expect(text).toMatch(new RegExp(`\`${key}\``, 'm'));
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Anti-duplication rule consistent with Phase 3.1 / 3.2.
  // ---------------------------------------------------------------------------
  test('forbids duplicating project_definition fields inside QA prose', () => {
    expect(prompt).toMatch(/project_definition.*INPUT.*not part of the QA output|input.*not part of the QA output/i);
    expect(prompt).toMatch(/Do \*\*NOT\*\* duplicate/);
    for (const term of [
      'language',
      'framework',
      'runtime',
      'package_manager',
      'build_system',
      'deployment_target',
      'repository',
    ]) {
      expect(prompt).toMatch(new RegExp(`\`?${term}\`?`));
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Phase 3.3 review correction #1 — Repository state is the source of truth.
  // ---------------------------------------------------------------------------
  describe('repository source of truth', () => {
    test('declares repository state as the source of truth', () => {
      expect(prompt).toMatch(/Repository state is the source of truth/i);
    });

    test('forbids assuming implementation from implementation_plan', () => {
      expect(prompt).toMatch(/Never assume implementation from `implementation_plan`/i);
    });

    test('forbids assuming behaviour from PRD alone', () => {
      expect(prompt).toMatch(/Never assume behaviour from PRD alone/i);
    });

    test('forbids trusting developer self-report as evidence', () => {
      expect(prompt).toMatch(/Never trust developer self-report as evidence/i);
    });

    test('states evidence must come from repository state plus executed verification', () => {
      expect(prompt).toMatch(/repository state[\s\S]*executed verification/i);
    });

    test('declares workspace wins over patch_diff / changed_files / implementation_plan', () => {
      // If they disagree, the workspace is what you verify against,
      // and the disagreement becomes a finding.
      expect(prompt).toMatch(/workspace[\s\S]*is what you verify against/i);
      expect(prompt).toMatch(/disagreement[\s\S]*finding/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Phase 3.3 review correction #2 — primary inputs vs migration inputs.
  // ---------------------------------------------------------------------------
  describe('primary vs migration-only inputs', () => {
    test('declares primary inputs section explicitly', () => {
      expect(prompt).toMatch(/Primary inputs/i);
    });

    test('declares migration-only compatibility inputs section explicitly', () => {
      expect(prompt).toMatch(/Migration-only compatibility inputs/i);
    });

    test('enumerates the primary input set', () => {
      const idx = prompt.indexOf('Primary inputs');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'Primary inputs'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      for (const key of [
        'project_definition',
        'prd',
        'acceptance_criteria',
        'ux_spec',
        'patch_diff',
        'changed_files',
      ]) {
        expect(text).toMatch(new RegExp(`\`${key}\``));
      }
    });

    test('enumerates the migration-only input set', () => {
      const idx = prompt.indexOf('Migration-only compatibility inputs');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'Migration-only compatibility inputs'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      for (const key of [
        'implementation_plan',
        'self_test_report',
        'sandbox_result',
        'risk_assessment',
        'security_notes',
      ]) {
        expect(text).toMatch(new RegExp(`\`${key}\``));
      }
    });

    test('states migration inputs are never authoritative', () => {
      expect(prompt).toMatch(/never authoritative/i);
    });

    test('declares repository evidence wins on disagreement', () => {
      // Both: disagreement-with-migration-input, and disagreement-with-primary-input
      // collapse to repository evidence winning.
      expect(prompt).toMatch(/repository evidence always wins/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Phase 3.3 review correction #3 — release boundary (QA=PASS/FAIL, RM=SHIP).
  // ---------------------------------------------------------------------------
  describe('release boundary — QA vs Release Manager', () => {
    test('declares a dedicated release boundary section', () => {
      expect(prompt).toMatch(/Release boundary[\s\S]*QA vs Release Manager/i);
    });

    test('QA decides PASS or FAIL', () => {
      const idx = prompt.indexOf('Release boundary');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'Release boundary'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      expect(text).toMatch(/\bPASS\b[\s\S]*\bFAIL\b/);
      expect(text).toMatch(/`blocker_count`[\s\S]*`release_reason`/);
    });

    test('Release Manager decides SHIP or DO NOT SHIP', () => {
      expect(prompt).toMatch(/\bSHIP\b[\s\S]*\bDO NOT SHIP\b/);
      expect(prompt).toMatch(/Release Manager owns[\s\S]*`release_decision`/i);
    });

    test('QA never publishes, never creates release commits, never packages', () => {
      // The negative boundary. Phrasing may use "QA never X" with
      // sentence breaks — match each clause cross-line.
      expect(prompt).toMatch(/QA never publishes/i);
      expect(prompt).toMatch(/QA never creates release commits/i);
      expect(prompt).toMatch(/QA never[\s\S]{0,5}packages artifacts/i);
    });

    test('QA only produces evidence', () => {
      expect(prompt).toMatch(/QA only produces evidence/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Phase 3.3 review correction #4 — qa_report as evidence package.
  // ---------------------------------------------------------------------------
  describe('qa_report as evidence package', () => {
    test('declares a dedicated evidence package section', () => {
      expect(prompt).toMatch(/`qa_report` as an evidence package/i);
    });

    test('enumerates the canonical evidence package sections', () => {
      const idx = prompt.indexOf('`qa_report` as an evidence package');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', '`qa_report` as an evidence package'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      for (const section of [
        'Executive Summary',
        'Executed Environment',
        'Executed Test Cases',
        'Coverage Summary',
        'Failures',
        'Security Findings',
        'Blockers',
        'Release Recommendation',
      ]) {
        expect(text).toMatch(new RegExp(`\\*\\*${section}\\*\\*`));
      }
    });

    test('does NOT redefine the schema — qa_report remains a Markdown string', () => {
      const idx = prompt.indexOf('`qa_report` as an evidence package');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', '`qa_report` as an evidence package'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      expect(text).toMatch(/Markdown string/i);
      expect(text).toMatch(/not a JSON contract/i);
    });
  });
});