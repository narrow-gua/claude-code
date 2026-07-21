import { describe, expect, test } from 'bun:test'
import {
  getModelSlotForModel,
  resolveModelSlotApiOverride,
} from '../modelSlotRouting.js'

describe('model slot routing', () => {
  test('matches configured IDs before name heuristics', () => {
    const env = {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2',
      ANTHROPIC_DEFAULT_GLM_MODEL: 'glm-special',
    }

    expect(getModelSlotForModel('glm-5.2', env)).toBe('sonnet')
    expect(getModelSlotForModel('glm-special', env)).toBe('glm')
  })

  test('recognizes all six slot families and strips 1m suffix', () => {
    expect(getModelSlotForModel('claude-haiku-4-5')).toBe('haiku')
    expect(getModelSlotForModel('claude-sonnet-5')).toBe('sonnet')
    expect(getModelSlotForModel('claude-opus-4-8[1m]')).toBe('opus')
    expect(getModelSlotForModel('claude-fable-5')).toBe('fable')
    expect(getModelSlotForModel('glm-5.2')).toBe('glm')
    expect(getModelSlotForModel('grok-4.5')).toBe('grok')
  })

  test('resolves explicit protocol, URL, and key for a slot', () => {
    expect(
      resolveModelSlotApiOverride(
        'glm-5.2',
        {
          glm: {
            apiMode: 'openai',
            baseUrl: ' https://glm.example.com/v1 ',
            authKey: ' glm-key ',
          },
        },
        'firstParty',
      ),
    ).toEqual({
      slot: 'glm',
      provider: 'openai',
      apiMode: 'openai',
      baseUrl: 'https://glm.example.com/v1',
      authKey: 'glm-key',
    })
  })

  test('inherits the global provider while overriding only credentials', () => {
    expect(
      resolveModelSlotApiOverride(
        'claude-fable-5',
        { fable: { apiMode: 'inherit', authKey: 'fable-key' } },
        'gemini',
      ),
    ).toEqual({
      slot: 'fable',
      provider: 'gemini',
      apiMode: 'inherit',
      authKey: 'fable-key',
    })
  })

  test('treats an empty inherit override as disabled', () => {
    expect(
      resolveModelSlotApiOverride(
        'claude-opus-4-8',
        { opus: { apiMode: 'inherit' } },
        'firstParty',
      ),
    ).toBeUndefined()
  })
})
