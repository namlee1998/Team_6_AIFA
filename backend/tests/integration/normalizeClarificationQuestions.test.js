// Unit tests for the T2 (B1) defensive normalizer.
//
// The frontend ClarificationPanel and spec §6.1 expect object form:
//   [{question, header?, options?}, ...]
//
// Agents may still return string[] or partial objects during migration.
// `normalizeClarificationQuestions` must coerce both safely, never throw,
// and never silently drop content (drops only happen with a warn log when
// the question text is missing entirely).

const { normalizeClarificationQuestions } = require('../../src/services/agentContract');

const noopLogger = { warn: () => {}, info: () => {} };

describe('normalizeClarificationQuestions', () => {
  test('returns empty array for null/undefined/non-array input', () => {
    expect(normalizeClarificationQuestions(null, { logger: noopLogger })).toEqual([]);
    expect(normalizeClarificationQuestions(undefined, { logger: noopLogger })).toEqual([]);
    expect(normalizeClarificationQuestions('not an array', { logger: noopLogger })).toEqual([]);
    expect(normalizeClarificationQuestions([], { logger: noopLogger })).toEqual([]);
  });

  test('coerces string[] to {question} objects', () => {
    const out = normalizeClarificationQuestions(
      ['Should the form be one-step?', 'Any specific brand colors?'],
      { logger: noopLogger },
    );
    expect(out).toEqual([
      { question: 'Should the form be one-step?' },
      { question: 'Any specific brand colors?' },
    ]);
  });

  test('preserves header + options on already-object items', () => {
    const out = normalizeClarificationQuestions(
      [
        {
          question: 'Form layout?',
          header: 'Layout',
          options: [
            { label: 'Single step', description: 'All fields visible' },
            { label: 'Multi-step', description: 'Wizard' },
          ],
        },
      ],
      { logger: noopLogger },
    );
    expect(out).toEqual([
      {
        question: 'Form layout?',
        header: 'Layout',
        options: [
          { label: 'Single step', description: 'All fields visible' },
          { label: 'Multi-step', description: 'Wizard' },
        ],
      },
    ]);
  });

  test('drops items without a question field (and warns)', () => {
    const warn = jest.fn();
    const out = normalizeClarificationQuestions(
      [
        { header: 'no question here' },
        { question: '   ' },
        'real question',
      ],
      { logger: { warn, info: () => {} } },
    );
    expect(out).toEqual([{ question: 'real question' }]);
    expect(warn).toHaveBeenCalled();
  });

  test('filters empty options and missing labels', () => {
    const out = normalizeClarificationQuestions(
      [
        {
          question: 'Priority?',
          options: [
            { label: 'High' },
            { label: '', description: 'empty label — drop me' },
            { description: 'no label — drop me' },
            { label: 'Low', description: 'later' },
          ],
        },
      ],
      { logger: noopLogger },
    );
    expect(out[0].options).toHaveLength(2);
    expect(out[0].options[0]).toEqual({ label: 'High', description: undefined });
    expect(out[0].options[1]).toEqual({ label: 'Low', description: 'later' });
  });

  test('mixed array (strings + objects) handles both', () => {
    const out = normalizeClarificationQuestions(
      [
        'plain string question',
        { question: 'object question', header: 'ctx' },
        null,
        42,
      ],
      { logger: noopLogger },
    );
    expect(out).toEqual([
      { question: 'plain string question' },
      { question: 'object question', header: 'ctx' },
    ]);
  });

  test('omits header key entirely when not provided', () => {
    const out = normalizeClarificationQuestions(
      [{ question: 'q1', options: [{ label: 'A' }] }],
      { logger: noopLogger },
    );
    expect(out[0]).toEqual({ question: 'q1', options: [{ label: 'A', description: undefined }] });
    expect('header' in out[0]).toBe(false);
  });
});