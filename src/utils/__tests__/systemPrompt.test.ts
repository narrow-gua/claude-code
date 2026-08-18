import { beforeEach, describe, expect, mock, test } from 'bun:test'

let unionEnabled = false

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'UNION_MODE',
}))
mock.module('../../union/prompt.js', () => ({
  appendUnionPlannerPrompt: (
    prompt: readonly string[],
    options?: { agentId?: string },
  ) =>
    unionEnabled && !options?.agentId ? [...prompt, 'union overlay'] : prompt,
}))

import { buildEffectiveSystemPrompt } from '../systemPrompt'

const defaultPrompt = ['You are a helpful assistant.', 'Follow instructions.']

function buildPrompt(overrides: Record<string, unknown> = {}) {
  return buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: undefined,
    toolUseContext: { options: {} as any },
    customSystemPrompt: undefined,
    defaultSystemPrompt: defaultPrompt,
    appendSystemPrompt: undefined,
    ...overrides,
  })
}

describe('buildEffectiveSystemPrompt', () => {
  beforeEach(() => {
    unionEnabled = false
  })

  test('returns default system prompt when no overrides', () => {
    const result = buildPrompt()
    expect(Array.from(result)).toEqual(defaultPrompt)
  })

  test('overrideSystemPrompt replaces everything', () => {
    const result = buildPrompt({ overrideSystemPrompt: 'override' })
    expect(Array.from(result)).toEqual(['override'])
  })

  test('does not append Union overlay unless the main turn opts in', () => {
    unionEnabled = true
    const result = buildPrompt({ overrideSystemPrompt: 'utility prompt' })
    expect(Array.from(result)).toEqual(['utility prompt'])
  })

  test('appends Union overlay after an explicit override only when active', () => {
    unionEnabled = true
    const result = buildPrompt({
      overrideSystemPrompt: 'override',
      includeUnionPlannerPrompt: true,
    })
    expect(Array.from(result)).toEqual(['override', 'union overlay'])
  })

  test('does not append the Planner overlay for subagent contexts', () => {
    unionEnabled = true
    const result = buildPrompt({
      toolUseContext: {
        options: {},
        agentId: 'agent-1',
      },
      overrideSystemPrompt: 'implementer',
      includeUnionPlannerPrompt: true,
    })
    expect(Array.from(result)).toEqual(['implementer'])
  })

  test('customSystemPrompt replaces default', () => {
    const result = buildPrompt({ customSystemPrompt: 'custom' })
    expect(Array.from(result)).toEqual(['custom'])
  })

  test('appendSystemPrompt is appended after main prompt', () => {
    const result = buildPrompt({ appendSystemPrompt: 'appended' })
    expect(Array.from(result)).toEqual([...defaultPrompt, 'appended'])
  })

  test('agent definition replaces default prompt', () => {
    const agentDef = {
      getSystemPrompt: () => 'agent prompt',
      agentType: 'custom',
    } as any
    const result = buildPrompt({ mainThreadAgentDefinition: agentDef })
    expect(Array.from(result)).toEqual(['agent prompt'])
  })

  test('agent definition with append combines both', () => {
    const agentDef = {
      getSystemPrompt: () => 'agent prompt',
      agentType: 'custom',
    } as any
    const result = buildPrompt({
      mainThreadAgentDefinition: agentDef,
      appendSystemPrompt: 'extra',
    })
    expect(Array.from(result)).toEqual(['agent prompt', 'extra'])
  })

  test('override takes precedence over agent and custom', () => {
    const agentDef = {
      getSystemPrompt: () => 'agent prompt',
      agentType: 'custom',
    } as any
    const result = buildPrompt({
      mainThreadAgentDefinition: agentDef,
      customSystemPrompt: 'custom',
      appendSystemPrompt: 'extra',
      overrideSystemPrompt: 'override',
    })
    expect(Array.from(result)).toEqual(['override'])
  })

  test('returns array of strings', () => {
    const result = buildPrompt()
    expect(Array.isArray(result)).toBe(true)
    for (const item of result) {
      expect(typeof item).toBe('string')
    }
  })

  test('custom + append combines both', () => {
    const result = buildPrompt({
      customSystemPrompt: 'custom',
      appendSystemPrompt: 'extra',
    })
    expect(Array.from(result)).toEqual(['custom', 'extra'])
  })
})
