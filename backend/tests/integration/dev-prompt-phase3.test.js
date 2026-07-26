// Phase 3.2 — DEV prompt migrated to `project_definition` as the canonical
// A2A contract (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 3.2).
// Output schema is unchanged in this phase: legacy fields
// (`sandbox_result`, `self_test_report`, `build_result`, `linked_ac_ids`,
// `risk_assessment`, `risk_classification`, `security_notes`,
// `security_gate`) are still emitted for backward compatibility but
// must be marked as legacy migration artifacts, not DEV responsibilities.

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(
  __dirname, '..', '..', 'src', 'agents', 'prompts', 'dev.prompt.md'
);

function readPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

describe('DEV prompt — Phase 3.2 migration', () => {
  const prompt = readPrompt();

  test('names project_definition as the canonical A2A contract', () => {
    expect(prompt).toMatch(/project_definition/);
    expect(prompt).toMatch(/canonical A2A contract/i);
  });

  test('explicitly marks architecture_brief as legacy / derived documentation', () => {
    expect(prompt).toMatch(/architecture_brief[\s\S]*legacy[\s\S]*derived documentation/i);
    expect(prompt).toMatch(/prefer `project_definition`/);
  });

  test('forbids DEV from claiming ownership of architecture or technology decisions', () => {
    // The ownership block must enumerate the forbidden categories.
    const forbidden = [
      'Architecture',
      'Framework',
      'language',
      'runtime',
      'package manager',
      'build system',
      'deployment target',
      'repository',
    ];
    // Every forbidden term must appear in a "do NOT own / MUST NOT
    // produce" context.
    const ownershipBlock = prompt.match(/DEV ownership[\s\S]*?(?=---|\n## |\Z)/);
    expect(ownershipBlock).not.toBeNull();
    const block = ownershipBlock[0];
    for (const term of forbidden) {
      expect(block.toLowerCase()).toContain(term.toLowerCase());
    }
    // And the block must use explicit "do NOT own" / "MUST NOT"
    // language.
    expect(block).toMatch(/do \*\*NOT\*\* own/i);
    expect(block).toMatch(/MUST NOT/);
  });

  test('explicitly tells DEV not to infer tech stack from free-form text', () => {
    expect(prompt).toMatch(/do not extract technology decisions|do not extract/i);
    expect(prompt).toMatch(/Do not extract technology decisions[\s\S]*free-form/i);
  });

  test('forbids duplicating project_definition fields inside implementation_plan', () => {
    // Same anti-duplication rule PO has — see Phase 3.1 corrections.
    expect(prompt).toMatch(/project_definition.*INPUT.*not part of the diff|input.*not part of the diff/i);
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
    // Anti-pattern + Correct pattern block must be present.
    expect(prompt).toMatch(/Anti-pattern/i);
    expect(prompt).toMatch(/Correct pattern/i);
  });

  test('instructs DEV not to ask the user about tech fields already in project_definition', () => {
    expect(prompt).toMatch(/MUST NOT call `AskUserQuestion`/);
    expect(prompt).toMatch(/tech stack/);
    expect(prompt).toMatch(/already in/);
  });

  // ---------------------------------------------------------------------------
  // Phase 3.6: DEV's required output is exactly three keys.
  // ---------------------------------------------------------------------------
  test('preserves every required DEV output key (no schema drift)', () => {
    for (const key of [
      'implementation_plan',
      'patch_diff',
      'changed_files',
    ]) {
      expect(prompt).toMatch(new RegExp(`\`${key}\``));
    }
  });

  test('does NOT include legacy validation artifacts in DEV schema', () => {
    // Phase 3.6: these moved to QA. They MUST NOT appear as DEV required keys.
    const LEGACY = [
      'sandbox_result',
      'self_test_report',
      'linked_ac_ids',
      'risk_assessment',
      'risk_classification',
      'security_notes',
      'security_gate',
      'build_result',
    ];
    for (const key of LEGACY) {
      // The key must not appear in the Required output / Legacy migration
      // fields documentation. We assert the absence across the whole prompt.
      expect(prompt).not.toMatch(new RegExp(`^- \`${key}\``, 'm'));
    }
  });

  test('does not instruct DEV to derive tech stack from free-form prose', () => {
    // Phase 3.2 spec: "It must no longer infer: language, framework,
    // runtime, package manager, deployment target from free-form text."
    expect(prompt).toMatch(/Do not extract technology decisions/i);
  });
});