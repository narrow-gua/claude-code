import { describe, expect, test } from 'bun:test'
import {
  normalizeToolUseId,
  normalizeToolUseIdsForAPI,
} from '../toolUseIdCompatibility.js'

describe('tool-use ID compatibility', () => {
  test('keeps IDs already accepted by Anthropic', () => {
    expect(normalizeToolUseId('call-safe_ID-123')).toBe('call-safe_ID-123')
  })

  test('normalizes incompatible IDs deterministically without collisions', () => {
    const first = normalizeToolUseId('Edit:18')
    const repeated = normalizeToolUseId('Edit:18')
    const second = normalizeToolUseId('Edit/18')

    expect(first).toBe(repeated)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('rewrites matching tool_use and tool_result IDs together', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'TaskCreate:6',
              name: 'TaskCreate',
              input: {},
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'TaskCreate:6',
              content: 'created',
            },
          ],
        },
      },
    ]

    const normalized = normalizeToolUseIdsForAPI(messages)
    const toolUse = normalized[0]?.message.content[0] as { id: string }
    const toolResult = normalized[1]?.message.content[0] as {
      tool_use_id: string
    }

    expect(toolUse.id).toBe(toolResult.tool_use_id)
    expect(toolUse.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(messages[0]?.message.content[0]).toMatchObject({
      id: 'TaskCreate:6',
    })
  })

  test('returns the original message when no IDs need repair', () => {
    const message = {
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_safe', name: 'Read', input: {} },
        ],
      },
    }

    expect(normalizeToolUseIdsForAPI([message])[0]).toBe(message)
  })
})
