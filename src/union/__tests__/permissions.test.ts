import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { Tool } from '../../Tool.js'

let enabled = false
let level: 'L0' | 'L1' | 'L2' | 'L3' = 'L1'

mock.module('../state.js', () => ({
  isUnionModeActive: () => enabled,
  getUnionLevel: () => level,
}))

const { getUnionPlannerDenial } = await import('../permissions.js')

const readTool = {
  name: 'Read',
  isMcp: false,
  isReadOnly: () => true,
} as Pick<Tool, 'name' | 'isMcp' | 'isReadOnly'>

afterEach(() => {
  enabled = false
  level = 'L1'
})

describe('getUnionPlannerDenial', () => {
  test('delegates exactly when Union is disabled', () => {
    expect(getUnionPlannerDenial(readTool, {})).toBeNull()
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'Write', isReadOnly: () => false },
        {},
      ),
    ).toBeNull()
  })

  test('allows read-only tools but blocks direct and indirect writes in L0/L1', () => {
    enabled = true
    expect(getUnionPlannerDenial(readTool, {})).toBeNull()
    for (const name of [
      'Write',
      'Edit',
      'NotebookEdit',
      'Bash',
      'PowerShell',
      'REPL',
      'Agent',
      'SendMessage',
      'Skill',
      'EnterPlanMode',
      'ExitPlanMode',
      'ExecuteExtraTool',
    ]) {
      expect(
        getUnionPlannerDenial(
          { ...readTool, name, isReadOnly: () => false },
          {},
        )?.behavior,
      ).toBe('deny')
    }
  })

  test('does not alter L2/L3 permission behavior', () => {
    enabled = true
    level = 'L2'
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'Write', isReadOnly: () => false },
        {},
      ),
    ).toBeNull()
    level = 'L3'
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'Bash', isReadOnly: () => false },
        {},
      ),
    ).toBeNull()
  })

  test('only exempts the dedicated implementer, not arbitrary subagents', () => {
    enabled = true
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'Write', isReadOnly: () => false },
        {},
        'union-implementer',
      ),
    ).toBeNull()
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'Write', isReadOnly: () => false },
        {},
        'general-purpose',
      )?.behavior,
    ).toBe('deny')
  })

  test('blocks MCP tools even when they claim to be read-only', () => {
    enabled = true
    expect(
      getUnionPlannerDenial(
        { ...readTool, name: 'mcp__server__tool', isMcp: true },
        {},
      )?.behavior,
    ).toBe('deny')
  })
})
