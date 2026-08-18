import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'

let level: 'L0' | 'L1' | 'L2' | 'L3' = 'L1'
let implementerCalls = 0
let observedTools: string[] = []

mock.module('../state.js', () => ({
  isUnionModeActive: () => true,
  isUnionToolAvailableForSession: () => true,
  getUnionLevel: () => level,
}))
mock.module('../implementer.js', () => ({
  runUnionImplementer: async ({
    toolUseContext,
  }: {
    toolUseContext: ToolUseContext
  }) => {
    implementerCalls++
    observedTools = toolUseContext.options.tools.map(tool => tool.name)
    return { model: 'implementer-model', report: 'implementation complete' }
  },
}))

const { SubmitUnionPlanTool } = await import('../SubmitUnionPlanTool.js')

function artifact(unionLevel: 'L0' | 'L1' | 'L2') {
  return {
    union_level: unionLevel,
    title: 'Implement Union handoff',
    goal: 'Exercise the structured handoff',
    non_goals: [],
    files_to_touch: ['src/example.ts'],
    core_files: [],
    core_hunks: [],
    steps: ['Implement the requested change'],
    invariants: ['Normal mode remains unchanged'],
    acceptance: [{ type: 'command' as const, run: 'bun run typecheck' }],
    risks: [],
    glue_tasks: [],
    context_files: [],
  }
}

function context(): ToolUseContext {
  const originalTool = { name: 'Original' }
  const refreshedTool = { name: 'Refreshed' }
  return {
    options: {
      tools: [originalTool],
      refreshTools: () => [refreshedTool],
    },
  } as unknown as ToolUseContext
}

afterEach(() => {
  level = 'L1'
  implementerCalls = 0
  observedTools = []
})

describe('SubmitUnionPlanTool', () => {
  test('runs the implementer for L0/L1 with the latest session tools', async () => {
    const result = await SubmitUnionPlanTool.call(
      artifact('L1'),
      context(),
      async () => ({ behavior: 'allow' }),
    )

    expect(result.data).toEqual({
      status: 'completed',
      report: 'implementation complete',
      model: 'implementer-model',
    })
    expect(implementerCalls).toBe(1)
    expect(observedTools).toEqual(['Refreshed'])
  })

  test('keeps L2 implementation authority with the planner', async () => {
    level = 'L2'
    const result = await SubmitUnionPlanTool.call(
      artifact('L2'),
      context(),
      async () => ({ behavior: 'allow' }),
    )

    expect(result.data.status).toBe('not_run')
    expect(implementerCalls).toBe(0)
  })

  test('rejects a stale handoff call after switching to L3', async () => {
    level = 'L3'
    await expect(
      SubmitUnionPlanTool.call(artifact('L1'), context(), async () => ({
        behavior: 'allow',
      })),
    ).rejects.toThrow('not available at the active Union level')
    expect(implementerCalls).toBe(0)
  })

  test('rejects an artifact that disagrees with the active level', async () => {
    await expect(
      SubmitUnionPlanTool.call(artifact('L0'), context(), async () => ({
        behavior: 'allow',
      })),
    ).rejects.toThrow('does not match active Union level')
  })

  test('cannot recurse from a subagent context', async () => {
    const subagentContext = {
      ...context(),
      agentId: 'agent-1',
    } as ToolUseContext

    await expect(
      SubmitUnionPlanTool.call(artifact('L1'), subagentContext, async () => ({
        behavior: 'allow',
      })),
    ).rejects.toThrow('main Union thread')
    expect(implementerCalls).toBe(0)
  })
})
