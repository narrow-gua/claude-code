import { describe, expect, mock, test } from 'bun:test'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'UNION_MODE',
}))
mock.module('../permissions.js', () => ({
  getUnionPlannerDenial: (_tool: Tool, input: Record<string, unknown>) =>
    input.write === true
      ? {
          behavior: 'deny' as const,
          message: 'Union read-only',
          decisionReason: { type: 'other' as const, reason: 'union-test' },
        }
      : null,
}))

const { resolveHookPermissionDecision } = await import(
  '../../services/tools/toolHooks.js'
)

const tool = {
  name: 'TestTool',
  isReadOnly: () => false,
} as unknown as Tool
const context = {
  requireCanUseTool: false,
} as ToolUseContext
const assistantMessage = {} as AssistantMessage

describe('resolveHookPermissionDecision Union guard', () => {
  test('blocks a hook-approved updated input before it can bypass permissions', async () => {
    let canUseToolCalled = false
    const result = await resolveHookPermissionDecision(
      { behavior: 'allow', updatedInput: { write: true } },
      tool,
      { write: false },
      context,
      async () => {
        canUseToolCalled = true
        return { behavior: 'allow' }
      },
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision.behavior).toBe('deny')
    expect(result.input).toEqual({ write: true })
    expect(canUseToolCalled).toBe(false)
  })

  test('leaves a disabled/no-op Union decision on the existing hook path', async () => {
    const result = await resolveHookPermissionDecision(
      { behavior: 'allow' },
      tool,
      { write: false },
      context,
      async () => ({
        behavior: 'deny',
        message: 'unexpected',
        decisionReason: { type: 'other', reason: 'test' },
      }),
      assistantMessage,
      'tool-use-id',
    )

    expect(result.decision.behavior).toBe('allow')
    expect(result.input).toEqual({ write: false })
  })
})
