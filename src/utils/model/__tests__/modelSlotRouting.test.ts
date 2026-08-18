import { describe, expect, test } from 'bun:test'
import {
  getModelSlotForModel,
  resolveModelSlotApiOverride,
} from '../modelSlotRouting.js'

describe('model slot routing', () => {
  test('can restrict matching to explicitly configured slot IDs', () => {
    expect(getModelSlotForModel('claude-opus-4-5', {}, false)).toBeUndefined()
    expect(
      getModelSlotForModel(
        'vendor/custom-model',
        { ANTHROPIC_DEFAULT_KIMI_MODEL: 'vendor/custom-model' },
        false,
      ),
    ).toBe('kimi')
  })

  test('matches configured IDs before name heuristics', () => {
    const env = {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2',
      ANTHROPIC_DEFAULT_GLM_MODEL: 'glm-special',
    }

    expect(getModelSlotForModel('glm-5.2', env)).toBe('sonnet')
    expect(getModelSlotForModel('glm-special', env)).toBe('glm')
  })

  test('recognizes all eight slot families and strips 1m suffix', () => {
    expect(getModelSlotForModel('claude-haiku-4-5')).toBe('haiku')
    expect(getModelSlotForModel('claude-sonnet-5')).toBe('sonnet')
    expect(getModelSlotForModel('claude-opus-4-8[1m]')).toBe('opus')
    expect(getModelSlotForModel('claude-fable-5')).toBe('fable')
    expect(getModelSlotForModel('glm-5.2')).toBe('glm')
    expect(getModelSlotForModel('grok-4.6')).toBe('grok')
    expect(getModelSlotForModel('kimi-k3')).toBe('kimi')
    expect(getModelSlotForModel('gpt-5.6-sol')).toBe('codex')
    expect(getModelSlotForModel('gpt-5.6-terra[1m]')).toBe('codex')
  })

  test('routes the Codex model group through ChatGPT Responses by default', () => {
    expect(
      resolveModelSlotApiOverride('gpt-5.6-luna', undefined, 'firstParty'),
    ).toEqual({
      slot: 'codex',
      provider: 'openai',
      apiMode: 'chatgpt',
    })
  })

  test('does not add an override to ordinary model slots', () => {
    expect(
      resolveModelSlotApiOverride('claude-opus-5', undefined, 'firstParty'),
    ).toBeUndefined()
    expect(
      resolveModelSlotApiOverride('grok-4.6', undefined, 'grok'),
    ).toBeUndefined()
  })

  test('resolves an explicit ChatGPT profile assigned to Codex', () => {
    expect(
      resolveModelSlotApiOverride(
        'gpt-5.6-sol',
        { codex: { profileId: 'subscription' } },
        'firstParty',
        {},
        {
          subscription: {
            name: 'ChatGPT Subscription',
            apiMode: 'chatgpt',
            baseUrl: 'https://responses.example.com/v1',
            authKey: 'profile-key',
          },
        },
      ),
    ).toEqual({
      slot: 'codex',
      provider: 'openai',
      apiMode: 'chatgpt',
      baseUrl: 'https://responses.example.com/v1',
      authKey: 'profile-key',
    })
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

  test('resolves a named API profile assigned to a slot', () => {
    expect(
      resolveModelSlotApiOverride(
        'claude-opus-5',
        { opus: { profileId: 'work' } },
        'firstParty',
        {},
        {
          work: {
            name: 'Work proxy',
            apiMode: 'anthropic',
            baseUrl: ' https://work.example.com ',
            authKey: ' work-key ',
          },
        },
      ),
    ).toEqual({
      slot: 'opus',
      provider: 'firstParty',
      apiMode: 'anthropic',
      baseUrl: 'https://work.example.com',
      authKey: 'work-key',
    })
  })

  test('falls back to global routing when an assigned profile is missing', () => {
    expect(
      resolveModelSlotApiOverride(
        'claude-opus-5',
        { opus: { profileId: 'deleted' } },
        'firstParty',
        {},
        {},
      ),
    ).toBeUndefined()
  })
})
