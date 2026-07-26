// Phase 3.4 — UX prompt migrated to `project_definition` as the canonical
// A2A contract (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 3.4).
// These tests pin the prompt content so a future refactor cannot silently
// regress UX back to the v1 behavior of treating architecture_brief as
// authoritative, asking the user about tech-stack fields, or restating PD
// fields inside UX artifacts.

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(
  __dirname, '..', '..', 'src', 'agents', 'prompts', 'ux.prompt.md'
);

function readPrompt() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

describe('UX prompt — Phase 3.4 migration', () => {
  const prompt = readPrompt();

  // ---------------------------------------------------------------------------
  // 1. Canonical input
  // ---------------------------------------------------------------------------
  describe('canonical input', () => {
    test('names project_definition as the canonical A2A contract', () => {
      expect(prompt).toMatch(/project_definition/);
      // The phrase may render with bold markdown between
      // "canonical" and "A2A" — match across the gap.
      expect(prompt).toMatch(/canonical[\s\S]{0,5}A2A contract/i);
    });

    test('explicitly marks architecture_brief as legacy / derived documentation', () => {
      expect(prompt).toMatch(/architecture_brief[\s\S]*legacy[\s\S]*derived documentation/i);
    });

    test('declares project_definition wins on conflict with architecture_brief', () => {
      expect(prompt).toMatch(/always prefer `project_definition`/i);
      expect(prompt).toMatch(/prefer `project_definition`/);
    });

    test('treats tech stack fields in project_definition as already chosen', () => {
      // The prompt must explicitly say these are already chosen and
      // not to be reinterpreted.
      expect(prompt).toMatch(/already chosen/i);
      expect(prompt).toMatch(/do not reinterpret/i);
    });

    test('lists the canonical input precedence in order', () => {
      // Must list: project_definition, prd, acceptance_criteria,
      // feedbackPrompt, architecture_brief (legacy).
      expect(prompt).toMatch(/project_definition[\s\S]{0,300}\*\*canonical\*\*/);
      expect(prompt).toMatch(/`prd`/);
      expect(prompt).toMatch(/`acceptance_criteria`/);
      expect(prompt).toMatch(/`feedbackPrompt`/);
      expect(prompt).toMatch(/`architecture_brief`[\s\S]*legacy/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Anti AskUserQuestion rule for tech fields already in PD.
  // ---------------------------------------------------------------------------
  test('instructs UX not to ask the user about tech fields already in project_definition', () => {
    expect(prompt).toMatch(/MUST NOT call `AskUserQuestion`/);
    expect(prompt).toMatch(/tech stack/);
    expect(prompt).toMatch(/already in/);
  });

  // ---------------------------------------------------------------------------
  // 3. Ownership — UX owns UX only.
  // ---------------------------------------------------------------------------
  describe('ownership boundaries', () => {
    test('declares a dedicated UX ownership section', () => {
      expect(prompt).toMatch(/UX ownership[\s\S]*explicit boundaries/i);
    });

    test('lists what UX owns', () => {
      const idx = prompt.indexOf('UX ownership');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'UX ownership'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      for (const owned of [
        'User experience',
        'User flows',
        'Screen hierarchy',
        'Interaction model',
        'Navigation',
        'Wireframes',
        'Component layout',
        'Visual behaviour',
        'Usability decisions',
      ]) {
        expect(text).toMatch(new RegExp(owned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    });

    test('explicitly lists what UX MUST NOT own', () => {
      // Locked decision: UX does not own architecture, routing,
      // framework/language/runtime/pm/build/deployment, implementation,
      // testing, security, release.
      const forbidden = [
        'Architecture',
        'repository routing',
        'framework',
        'language',
        'runtime',
        'package manager',
        'build system',
        'deployment target',
        'Source code',
        'Test cases',
        'release',
      ];
      const ownershipBlock = prompt.match(/UX ownership[\s\S]*?(?=\n## |\Z)/);
      expect(ownershipBlock).not.toBeNull();
      const block = ownershipBlock[0].toLowerCase();
      for (const term of forbidden) {
        expect(block).toContain(term.toLowerCase());
      }
      expect(ownershipBlock[0]).toMatch(/do \*\*NOT\*\* own/i);
      expect(ownershipBlock[0]).toMatch(/MUST NOT/i);
    });

    test('states UX artifacts describe experience / layout / navigation / interaction / visual behaviour only', () => {
      expect(prompt).toMatch(/UX artifacts should only describe/i);
      expect(prompt).toMatch(/experience/);
      expect(prompt).toMatch(/layout/);
      expect(prompt).toMatch(/navigation/);
      expect(prompt).toMatch(/interaction/);
      expect(prompt).toMatch(/visual behaviour/);
    });

    test('forbids UX from publishing code, architecture, or tech choices', () => {
      // Phrase may wrap onto two lines.
      expect(prompt).toMatch(/Never implementation/);
      expect(prompt).toMatch(/Never architecture/);
      expect(prompt).toMatch(/Never technology[\s\S]{0,5}choices/);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Anti-duplication: PD fields must not be republished into UX artifacts.
  // ---------------------------------------------------------------------------
  describe('anti-duplication of project_definition fields', () => {
    test('declares project_definition is INPUT, not part of UX artifacts', () => {
      expect(prompt).toMatch(/`project_definition` is an INPUT[\s\S]*not part of UX artifacts/i);
      expect(prompt).toMatch(/Do \*\*NOT\*\* duplicate/);
    });

    test('enumerates the forbidden-to-duplicate fields', () => {
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

    test('Anti-pattern / Correct pattern block present', () => {
      expect(prompt).toMatch(/Anti-pattern/i);
      expect(prompt).toMatch(/Correct pattern/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Backward compatibility.
  // ---------------------------------------------------------------------------
  describe('backward compatibility', () => {
    test('preserves the existing required output keys (no schema drift)', () => {
      for (const key of [
        'ux_spec',
        'user_flow',
        'wireframe_spec',
        'screens',
        'component_inventory',
        'html_mockup',
      ]) {
        expect(prompt).toMatch(new RegExp(`\`${key}\``));
      }
    });

    test('preserves the html_mockup constraints', () => {
      // Backward-compat smoke checks: the validator contract is
      // unchanged, so the prompt must still demand these.
      expect(prompt).toMatch(/<!DOCTYPE html>/);
      expect(prompt).toMatch(/Inline `<style>`/);
      expect(prompt).toMatch(/Responsive/);
    });

    test('preserves Output discipline rules', () => {
      expect(prompt).toMatch(/Output discipline/i);
      expect(prompt).toMatch(/clarification_questions/);
      expect(prompt).toMatch(/Return ONLY the required artifact keys/);
    });

    test('does not instruct UX to derive tech stack from free-form prose', () => {
      // Mirrors Phase 3.1 / 3.2 / 3.3 corrections.
      expect(prompt).toMatch(/Do not extract technology decisions|do not extract/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Phase 3.4 review refinement #1 — UX source-of-truth.
  // ---------------------------------------------------------------------------
  describe('UX source of truth — UX is not the system architect', () => {
    test('declares UX designs user experience, not system architecture', () => {
      expect(prompt).toMatch(/UX designs the user experience[\s\S]*not the system architecture/i);
    });

    test('treats project_definition, PRD, AC as immutable inputs', () => {
      const idx = prompt.indexOf('UX designs the user experience');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'UX designs the user experience'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      expect(text).toMatch(/immutable inputs/i);
      for (const key of [
        'project_definition',
        'prd',
        'acceptance_criteria',
      ]) {
        expect(text).toMatch(new RegExp(`\`${key}\``));
      }
    });

    test('forbids UX from reinterpreting or redefining upstream inputs', () => {
      expect(prompt).toMatch(/MUST NOT reinterpret or redefine/i);
    });

    test('instructs UX to describe UX impact on inconsistency, not invent a new requirement', () => {
      expect(prompt).toMatch(/describe the UX impact/i);
      expect(prompt).toMatch(/MUST NOT silently invent/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Phase 3.4 review refinement #2 — behaviour, not implementation.
  // ---------------------------------------------------------------------------
  describe('UX specifies behaviour, not implementation', () => {
    test('declares the dedicated section', () => {
      expect(prompt).toMatch(/UX specifies behaviour[\s\S]*not implementation/i);
    });

    test('enumerates what UX specifies', () => {
      const idx = prompt.indexOf('UX specifies behaviour');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'UX specifies behaviour'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      for (const item of [
        'What users see',
        'What users can do',
        'Interaction behaviour',
        'Navigation',
        'Visual hierarchy',
      ]) {
        expect(text).toMatch(new RegExp(`\\*\\*${item}\\*\\*`));
      }
    });

    test('enumerates what UX does NOT specify', () => {
      const idx = prompt.indexOf('UX specifies behaviour');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'UX specifies behaviour'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      // Items appear as list entries. Some are bolded, some are
      // plain list items with a parenthetical description. Match
      // each item as a list entry — bullet, optional bold,
      // cross-line tolerant.
      for (const forbidden of [
        'APIs',
        'Database design',
        'Repository structure',
        'Folder layout',
        'Framework implementation',
        'Routing implementation',
        'Component architecture',
        'Backend logic',
      ]) {
        const safe = forbidden.replace(/ /g, '[\\s\\S]{0,5}');
        // Allow either `- **Foo** (...)` or `- Foo (...)` form.
        expect(text).toMatch(new RegExp(`-\\s+(?:\\*\\*)?${safe}(?:\\*\\*)?\\s*\\(`));
      }
    });

    test('requires rewriting implementation details into user-facing behaviour', () => {
      const idx = prompt.indexOf('UX specifies behaviour');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', 'UX specifies behaviour'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      expect(text).toMatch(/rewrite them[\s\S]*user-facing behaviour/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Phase 3.4 review refinement #3 — traceability chain.
  // ---------------------------------------------------------------------------
  describe('traceability — every UX artifact traces to the PRD', () => {
    test('declares the traceability chain heading', () => {
      expect(prompt).toMatch(/Traceability[\s\S]*every UX artifact traces to the PRD/i);
    });

    test('states the canonical traceability chain', () => {
      expect(prompt).toMatch(/User Story[\s\S]*UX Flow[\s\S]*Screen[\s\S]*Interaction[\s\S]*Acceptance Criterion/i);
    });

    test('requires screens to trace to a User Story or PRD requirement', () => {
      expect(prompt).toMatch(/traces to at least one User Story/i);
    });

    test('forbids introducing screens / components / journeys with no PRD trace', () => {
      expect(prompt).toMatch(/MUST NOT introduce screens[\s\S]*cannot be traced/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Phase 3.4 review refinement #4 — no feature expansion.
  // ---------------------------------------------------------------------------
  describe('no feature expansion', () => {
    test('declares the dedicated section', () => {
      expect(prompt).toMatch(/No feature expansion[\s\S]*may improve usability, not scope/i);
    });

    test('UX may improve usability', () => {
      expect(prompt).toMatch(/UX may improve[\s\S]*how[\s\S]*an interaction is experienced/i);
    });

    test('UX must not expand product scope', () => {
      // "UX MUST NOT expand **what** the product does." The phrase
      // wraps between "MUST NOT" and "expand" — match cross-line.
      expect(prompt).toMatch(/MUST NOT[\s\S]{0,10}expand[\s\S]{0,30}\*\*what\*\*[\s\S]{0,30}the product does/i);
    });

    test('enumerates permitted usability improvements', () => {
      expect(prompt).toMatch(/refining a flow/i);
      expect(prompt).toMatch(/improving hierarchy/i);
      expect(prompt).toMatch(/surfacing an error/i);
    });

    test('enumerates forbidden scope expansions', () => {
      expect(prompt).toMatch(/introducing a new feature/i);
      expect(prompt).toMatch(/adding a new screen/i);
      expect(prompt).toMatch(/adding a new setting/i);
      expect(prompt).toMatch(/adding a new field/i);
    });

    test('requires out-of-PRD items to be marked SUGGESTION, not silently added', () => {
      expect(prompt).toMatch(/marked as a[\s\S]*suggestion/i);
      expect(prompt).toMatch(/SUGGESTION \(out of PRD scope\)/);
    });

    test('forbids suggestions appearing inside screens / user_flow / wireframe_spec / html_mockup', () => {
      expect(prompt).toMatch(/MUST NOT appear inside[\s\S]*`screens`/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Phase 3.4 review refinement #5 — html_mockup ownership.
  // ---------------------------------------------------------------------------
  describe('html_mockup ownership — communication prototype, not production', () => {
    test('declares the dedicated ownership sub-section', () => {
      expect(prompt).toMatch(/`html_mockup` ownership[\s\S]*what the mockup is, and is not/i);
    });

    test('declares html_mockup as a communication prototype + visual reference', () => {
      expect(prompt).toMatch(/communication prototype/i);
      // "visual\nreference" wraps — match cross-line.
      expect(prompt).toMatch(/visual[\s\S]{0,5}reference/i);
    });

    test('explicitly lists what html_mockup is NOT', () => {
      const idx = prompt.indexOf('`html_mockup` ownership');
      expect(idx).toBeGreaterThan(-1);
      const tail = prompt.slice(idx);
      const nextHeading = tail.indexOf('\n## ', '`html_mockup` ownership'.length);
      const text = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
      // Items appear as bullet list lines (`- Production code.` etc.).
      // They may wrap across lines. Match each as a bullet line that
      // ends with a period.
      for (const not of [
        'Production code',
        'Frontend implementation',
        'A deliverable for DEV to copy verbatim',
      ]) {
        const safe = not.replace(/ /g, '[\\s\\S]{0,5}');
        expect(text).toMatch(new RegExp(`-\\s+${safe}\\.`));
      }
    });

    test('states DEV re-implements against project_definition + prd, not lifts the mockup', () => {
      expect(prompt).toMatch(/re-implement against the canonical[\s\S]*`project_definition`/i);
      expect(prompt).toMatch(/NOT expected to lift the mockup/i);
    });
  });
});
