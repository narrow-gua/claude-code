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

const { hasPermissionsToUseTool } = await import(
  '../../utils/permissions/permissions.js'
)

describe('hasPermissionsToUseTool Union guard', () => {
  test('runs before bypassPermissions and tool permission logic', async () => {
    const tool = {
      name: 'WriteLikeTool',
      isReadOnly: () => false,
    } as unknown as Tool
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'bypassPermissions' },
      }),
    } as unknown as ToolUseContext

    const result = await hasPermissionsToUseTool(
      tool,
      { write: true },
      context,
      {} as AssistantMessage,
      'tool-use-id',
    )

    expect(result.behavior).toBe('deny')
  })
})
