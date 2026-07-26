// Phase 3.1 — PO prompt migrated to `project_definition` as the canonical
// A2A contract (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 3.1).
// These tests pin the prompt content so a future refactor cannot silently
// regress PO back to the v1 behavior of treating architecture_brief as
// authoritative or asking the user about tech-stack fields.

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(
  __dirname, '..', '..', 'src', 'agents', 'prompts', 'po.prompt.md'
);

function readPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

describe('PO prompt — Phase 3.1 migration', () => {
  const prompt = readPrompt();

  test('names project_definition as the canonical A2A contract', () => {
    expect(prompt).toMatch(/project_definition/);
    // The prompt must call it canonical — not just mention it once.
    expect(prompt).toMatch(/canonical A2A contract/i);
  });

  test('explicitly forbids treating architecture_brief as authoritative', () => {
    // Must call it legacy / derived documentation.
    expect(prompt).toMatch(/architecture_brief[\s\S]*legacy[\s\S]*derived/i);
    // Must state the precedence rule when the two disagree.
    expect(prompt).toMatch(/prefer `project_definition`/);
  });

  test('instructs PO not to ask the user about tech fields already in project_definition', () => {
    // Phrase varies, but the rule must be present.
    expect(prompt).toMatch(/MUST NOT call `AskUserQuestion`/);
    expect(prompt).toMatch(/tech stack|language.*framework|already in/);
  });

  test('explicitly lists what PO MUST NOT produce', () => {
    // Locked decision §11.1: PO does not own framework / language / runtime
    // / package manager / build_system / deployment_target. The prompt must
    // enumerate them.
    const mustNotOwn = [
      'Framework',
      'language',
      'runtime',
      'package manager',
      'build system',
      'deployment target',
    ];
    for (const term of mustNotOwn) {
      const re = new RegExp(`MUST NOT[\\s\\S]{0,200}${term}`, 'i');
      expect(prompt).toMatch(re);
    }
  });

  // Phase 3.6: risk_classification was removed entirely from PO's contract.
// PO does NOT emit, document, or hint at risk_classification. QA owns it.

test('prompts no longer mention risk_classification as a PO output', () => {
  // The locked principle: PO does not own risk_classification. QA does.
  // The prompt must not document it as PO output.
  expect(prompt).not.toMatch(/^- `risk_classification`/m);
  expect(prompt).not.toMatch(/`risk_classification`[\s\S]*object/i);
  // No advisory wording either — Phase 3.6 removed the field, not just
  // demoted it.
  expect(prompt).not.toMatch(/Migration advisory only/i);
});

test('preserves backward-compat mention of architecture_brief for Phase 3', () => {
    // The plumbing in Phase 2 still injects architecture_brief into PO
    // context. The prompt must acknowledge that it MAY still appear, but
    // only as legacy documentation — not as the canonical source.
    expect(prompt).toMatch(/architecture_brief/);
    expect(prompt).toMatch(/derived documentation/i);
  });

test('preserves the existing required output keys (no schema drift)', () => {
    // Phase 3.1 must NOT change the output schema. The schema is now 5 keys
    // (risk_classification was removed in Phase 3.6).
    for (const key of [
      'prd',
      'user_stories',
      'acceptance_criteria',
      'scope',
      'out_of_scope',
    ]) {
      expect(prompt).toMatch(new RegExp(`\`${key}\``));
    }
  });

  test('does not instruct PO to extract technology decisions from free-form text', () => {
    expect(prompt).toMatch(/Do not extract technology decisions/i);
  });

  // ---------------------------------------------------------------------------
  // Review corrections applied after Phase 3.1 approval.
  // ---------------------------------------------------------------------------

  test('forbids duplicating project_definition fields inside the PRD prose', () => {
    // Correction #1 from the Phase 3.1 review: PD is an INPUT, not part of
    // the PRD. The prompt must explicitly forbid restating the seven
    // normalized fields and `repository` inside the PRD.
    expect(prompt).toMatch(/project_definition.*INPUT.*not part of the PRD|project_definition`.*input.*not part of the PRD/i);
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
      const re = new RegExp(`\`?${term}\`?`);
      // Each term must appear in the no-duplicate block.
      expect(prompt).toMatch(re);
    }
    // Anti-pattern / correct-pattern block must be present so the rule is
    // not just abstract.
    expect(prompt).toMatch(/Anti-pattern/i);
    expect(prompt).toMatch(/Correct pattern/i);
  });
});