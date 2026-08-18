import { afterEach, describe, expect, mock, test } from 'bun:test'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

let enabled = false
let level: 'L0' | 'L1' | 'L2' | 'L3' = 'L1'

mock.module('../state.js', () => ({
  isUnionModeActive: () => enabled,
  getUnionLevel: () => level,
}))

const { appendUnionPlannerPrompt, getUnionPlannerPrompt } = await import(
  '../prompt.js'
)

afterEach(() => {
  enabled = false
  level = 'L1'
})

describe('appendUnionPlannerPrompt', () => {
  test('returns the exact original prompt object when disabled', () => {
    const original = asSystemPrompt(['default', 'append'])
    expect(appendUnionPlannerPrompt(original)).toBe(original)
  })

  test('does not append the planner overlay to a subagent', () => {
    enabled = true
    const original = asSystemPrompt(['implementer'])
    expect(appendUnionPlannerPrompt(original, { agentId: 'agent-1' })).toBe(
      original,
    )
  })

  test('appends a concise level-specific overlay when enabled', () => {
    enabled = true
    level = 'L1'
    const result = appendUnionPlannerPrompt(asSystemPrompt(['default']))
    expect(result[0]).toBe('default')
    expect(result[1]).toContain('Union Mode — Planner (L1)')
    expect(result[1]).toContain('Use normal engineering judgment')
    expect(result[1]).toContain('Adapt your approach and depth to the task')
    expect(result[1]!.length).toBeLessThan(600)
  })

  test('keeps L2 core authority with the planner', () => {
    level = 'L2'
    expect(getUnionPlannerPrompt()).toContain('retain implementation authority')
    expect(getUnionPlannerPrompt()).not.toContain('SubmitUnionPlan')
  })

  test('keeps L3 system prompt byte-identical to normal mode', () => {
    enabled = true
    level = 'L3'
    const original = asSystemPrompt(['default'])
    expect(appendUnionPlannerPrompt(original)).toBe(original)
  })
})
