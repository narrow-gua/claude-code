import { describe, expect, test } from 'bun:test'
import { parseUnionPlanArtifact } from '../planArtifact.js'

function validArtifact() {
  return {
    union_level: 'L1' as const,
    title: 'Implement setting',
    goal: 'Add an isolated setting',
    non_goals: [],
    files_to_touch: ['src/example.ts'],
    core_files: [],
    core_hunks: [],
    steps: ['Add the setting'],
    invariants: ['Normal mode remains unchanged'],
    acceptance: [{ type: 'command' as const, run: 'bun run typecheck' }],
    risks: [],
    glue_tasks: [],
    context_files: [],
  }
}

describe('parseUnionPlanArtifact', () => {
  test('accepts a concrete artifact and fills context files', () => {
    const result = parseUnionPlanArtifact({
      ...validArtifact(),
      glue_tasks: [
        { description: 'Wire the setting', files: ['src/register.ts'] },
      ],
    })
    expect(result.context_files).toEqual([
      {
        path: 'src/example.ts',
        reason: 'Required implementation context',
      },
      {
        path: 'src/register.ts',
        reason: 'Required implementation context',
      },
    ])
  })

  test('rejects artifacts without acceptance criteria', () => {
    expect(() =>
      parseUnionPlanArtifact({ ...validArtifact(), acceptance: [] }),
    ).toThrow()
  })

  test('rejects whitespace-only semantic fields', () => {
    expect(() =>
      parseUnionPlanArtifact({ ...validArtifact(), title: '   ' }),
    ).toThrow()
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        acceptance: [{ type: 'command', run: '   ' }],
      }),
    ).toThrow()
  })

  test('rejects free-text patch fields', () => {
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        hint_diffs: [
          {
            file: 'src/example.ts',
            authority: 'hint',
            unified_diff: '@@ -1 +1 @@',
          },
        ],
      }),
    ).toThrow()
  })

  test('rejects absolute and parent-traversing paths', () => {
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        files_to_touch: ['/tmp/example.ts'],
      }),
    ).toThrow()
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        files_to_touch: ['../example.ts'],
      }),
    ).toThrow()
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        files_to_touch: ['src/../example.ts'],
      }),
    ).toThrow()
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        files_to_touch: ['src//example.ts'],
      }),
    ).toThrow()
    expect(() =>
      parseUnionPlanArtifact({
        ...validArtifact(),
        files_to_touch: ['src/example.ts/'],
      }),
    ).toThrow()
  })

  test('rejects non-portable or control-character paths', () => {
    for (const file of [
      'src\\example.ts',
      'C:example.ts',
      ' src/example.ts',
      'src/example.ts\nother',
    ]) {
      expect(() =>
        parseUnionPlanArtifact({
          ...validArtifact(),
          files_to_touch: [file],
        }),
      ).toThrow()
    }
  })
})
