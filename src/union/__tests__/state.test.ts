import { afterEach, describe, expect, mock, test } from 'bun:test'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

let stored: {
  union?: {
    enabled?: boolean
    defaultLevel?: 'L0' | 'L1' | 'L2' | 'L3'
    implementerModel?: string
  }
} = {}
let lastUpdate: Record<string, unknown> | undefined

mock.module('bun:bundle', () => ({
  feature: (name: string) =>
    name === 'UNION_MODE' || name === 'COORDINATOR_MODE',
}))
mock.module('../../utils/settings/settings.js', () => ({
  getInitialSettings: () => stored,
  updateSettingsForSource: (
    _source: string,
    update: Record<string, unknown>,
  ) => {
    lastUpdate = update
    stored = update
    return { error: null }
  },
}))

const {
  getUnionStateVersion,
  getUnionState,
  isCoordinatorModeRequested,
  resetUnionStateForTest,
  setUnionImplementerModel,
  setUnionLevel,
  setUnionMode,
  setUnionToolAvailableForSession,
  setUnionToolDeniedByRulesForSession,
} = await import('../state.js')
const { appendUnionPlannerPrompt } = await import('../prompt.js')

afterEach(() => {
  stored = {}
  lastUpdate = undefined
  delete process.env.CLAUDE_CODE_COORDINATOR_MODE
  resetUnionStateForTest()
})

describe('Union state', () => {
  test('defaults to disabled L1', () => {
    expect(getUnionState()).toEqual({
      enabled: false,
      level: 'L1',
      implementerModel: undefined,
    })
  })

  test('persists enablement and explicit level', () => {
    const initialVersion = getUnionStateVersion()
    setUnionMode(true)
    expect(getUnionStateVersion()).toBe(initialVersion + 1)
    expect(lastUpdate).toEqual({
      union: { enabled: true, defaultLevel: 'L1' },
    })
    setUnionLevel('L2')
    expect(getUnionStateVersion()).toBe(initialVersion + 2)
    expect(getUnionState()).toEqual({
      enabled: true,
      level: 'L2',
      implementerModel: undefined,
    })
    expect(lastUpdate).toEqual({
      union: { enabled: true, defaultLevel: 'L2' },
    })
  })

  test('disables without discarding the level or implementer model', () => {
    stored = {
      union: {
        enabled: true,
        defaultLevel: 'L2',
        implementerModel: 'glm',
      },
    }
    resetUnionStateForTest()
    setUnionMode(false)
    expect(lastUpdate).toEqual({
      union: {
        enabled: false,
        defaultLevel: 'L2',
        implementerModel: 'glm',
      },
    })
    expect(getUnionState().enabled).toBe(false)
  })

  test('detects Coordinator mode for mutual exclusion', () => {
    stored = { union: { enabled: true, defaultLevel: 'L1' } }
    resetUnionStateForTest()
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
    expect(isCoordinatorModeRequested()).toBe(true)
    expect(getUnionState().enabled).toBe(false)
    expect(setUnionMode(true)?.message).toContain('Coordinator mode is active')
    expect(setUnionLevel('L2')?.message).toContain('Coordinator mode is active')
    expect(lastUpdate).toBeUndefined()
  })

  test('does not enter a read-only level when the handoff tool is excluded', () => {
    setUnionToolAvailableForSession(false)
    expect(setUnionMode(true)?.message).toContain('excluded')
    expect(setUnionLevel('L0')?.message).toContain('excluded')
    expect(setUnionLevel('L2')).toBeNull()
  })

  test('fails open to normal behavior for an incompatible stored L0/L1 state', () => {
    stored = { union: { enabled: true, defaultLevel: 'L1' } }
    resetUnionStateForTest()
    setUnionToolAvailableForSession(false)
    expect(getUnionState().enabled).toBe(false)
  })

  test('fails open without a Planner prompt when the handoff tool is denied', () => {
    stored = { union: { enabled: true, defaultLevel: 'L1' } }
    resetUnionStateForTest()
    setUnionToolDeniedByRulesForSession(true)
    const original = asSystemPrompt(['default'])

    expect(getUnionState().enabled).toBe(false)
    expect(appendUnionPlannerPrompt(original)).toBe(original)
  })

  test('reports the configured implementer model without changing it', () => {
    stored = {
      union: {
        enabled: true,
        defaultLevel: 'L1',
        implementerModel: 'glm',
      },
    }
    resetUnionStateForTest()
    expect(getUnionState()).toEqual({
      enabled: true,
      level: 'L1',
      implementerModel: 'glm',
    })
  })

  test('persists and clears the implementer model independently', () => {
    setUnionImplementerModel(' kimi ')
    expect(lastUpdate).toEqual({
      union: {
        enabled: false,
        defaultLevel: 'L1',
        implementerModel: 'kimi',
      },
    })
    setUnionImplementerModel(undefined)
    expect(lastUpdate).toEqual({
      union: {
        enabled: false,
        defaultLevel: 'L1',
        implementerModel: undefined,
      },
    })
  })
})
