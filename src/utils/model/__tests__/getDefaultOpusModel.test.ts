import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('bun:bundle', () => ({ feature: () => false }))
mock.module('bundle', () => ({ feature: () => false }))

const { resetModelStringsForTestingOnly } = await import(
  'src/bootstrap/state.js'
)
const { resetSettingsCache, setSessionSettingsCache } = await import(
  'src/utils/settings/settingsCache.js'
)
const { ALL_MODEL_CONFIGS } = await import('../configs.js')
const { getDefaultOpusModel, getDefaultSonnetModel } = await import(
  '../model.js'
)
const { getModelOptions, getOpus46Option } = await import('../modelOptions.js')
const { getModelStrings } = await import('../modelStrings.js')

/**
 * Verifies the customized Opus/Sonnet slots remain independent from the
 * active provider's primary model.
 */

const envKeys = [
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GROK',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'OPENAI_DEFAULT_OPUS_MODEL',
  'OPENAI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'ANTHROPIC_API_KEY',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

describe('getDefaultOpusModel', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('returns Opus 4.8 for firstParty', () => {
    expect(getDefaultOpusModel()).toBe('claude-opus-4-8')
  })

  test('returns Opus 4.8 for bedrock', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getDefaultOpusModel()).toBe('claude-opus-4-8')
  })

  test('returns Opus 4.8 for vertex', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(getDefaultOpusModel()).toBe('claude-opus-4-8')
  })

  test('returns Opus 4.8 for foundry', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getDefaultOpusModel()).toBe('claude-opus-4-8')
  })

  test('honors ANTHROPIC_DEFAULT_OPUS_MODEL env override (any provider)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-1-custom'
    expect(getDefaultOpusModel()).toBe('claude-opus-4-1-custom')
  })

  test('honors OPENAI_DEFAULT_OPUS_MODEL for openai provider', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_DEFAULT_OPUS_MODEL = 'gpt-5-turbo'
    expect(getDefaultOpusModel()).toBe('gpt-5-turbo')
  })

  test('does not let an OpenAI primary model replace Opus or Sonnet slots', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'glm-5.2'

    expect(getDefaultOpusModel()).toBe('claude-opus-4-8')
    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5')
  })
})

describe('custom model slot picker', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('shows one entry per configured slot and removes old core models', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const options = getModelOptions()

    expect(options.slice(0, 6).map(option => option.value)).toEqual([
      null,
      'opus',
      'sonnet',
      'haiku',
      'fable',
      'glm',
    ])
    expect(options.find(option => option.value === 'opus')?.label).toBe(
      'Claude Opus 4.8',
    )
    expect(options.find(option => option.value === 'sonnet')?.label).toBe(
      'Claude Sonnet 5',
    )
    expect(
      options.some(option =>
        String(option.value).match(/claude-(?:opus-4-[67]|sonnet-4-6)/),
      ),
    ).toBe(false)
  })

  test('does not re-add an obsolete 1M row for a persisted slot alias', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    setSessionSettingsCache({
      settings: { model: 'opus[1m]' },
      errors: [],
    })

    const options = getModelOptions()
    expect(options.map(option => option.value)).toEqual([
      null,
      'opus',
      'sonnet',
      'haiku',
      'fable',
      'glm',
    ])
    expect(options.some(option => option.label.includes('Opus 4.7'))).toBe(
      false,
    )
  })
})

/**
 * Gap #3 addition — "Opus 4.6" must appear as an explicit opt-in option in
 * the /model picker across all non-ANT user tiers. The option's value MUST
 * be the canonical 4.6 model string, NOT the 'opus' alias (which would
 * resolve via getDefaultOpusModel back to 4.7 on firstParty, silently
 * defeating the user's explicit choice).
 */
describe('getOpus46Option', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('firstParty: value is canonical opus46 string, NOT opus alias', () => {
    const opt = getOpus46Option(false)
    expect(opt.value).toBe(getModelStrings().opus46)
    expect(opt.value).not.toBe('opus')
    expect(opt.label).toBe('Opus 4.6')
  })

  test('firstParty: description says "Previous generation", not "Legacy"', () => {
    const opt = getOpus46Option(false)
    expect(opt.description).toContain('Previous generation')
    expect(opt.description).not.toContain('Legacy')
  })

  test('bedrock: value is canonical opus46 string (unchanged behavior)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const opt = getOpus46Option(false)
    expect(opt.value).toBe(getModelStrings().opus46)
    expect(opt.value).toBe(ALL_MODEL_CONFIGS.opus46.bedrock)
  })

  test('option has descriptionForModel that mentions Opus 4.6', () => {
    const opt = getOpus46Option(false)
    expect(opt.descriptionForModel).toBeDefined()
    expect(opt.descriptionForModel).toContain('Opus 4.6')
  })
})
