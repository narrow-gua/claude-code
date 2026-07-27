export type ModelSlotName =
  | 'haiku'
  | 'sonnet'
  | 'opus'
  | 'fable'
  | 'glm'
  | 'grok'
  | 'kimi'
export type ModelSlotApiMode = 'inherit' | 'anthropic' | 'openai' | 'gemini'
export type ModelSlotRoutingProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'grok'

export type ModelSlotApiOverrideValue = {
  profileId?: string
  apiMode?: ModelSlotApiMode
  baseUrl?: string
  authKey?: string
}

export type ApiProfileValue = {
  name: string
  apiMode: ModelSlotApiMode
  baseUrl?: string
  authKey?: string
}

export type ResolvedModelSlotApiOverride = {
  slot: ModelSlotName
  provider: ModelSlotRoutingProvider
  apiMode: ModelSlotApiMode
  baseUrl?: string
  authKey?: string
}

type ModelSlotOverrides = Partial<
  Record<ModelSlotName, ModelSlotApiOverrideValue>
>
type ApiProfiles = Record<string, ApiProfileValue>

const SLOT_MODEL_ENV_VARS: Record<ModelSlotName, string[]> = {
  haiku: [
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'OPENAI_DEFAULT_HAIKU_MODEL',
    'GEMINI_DEFAULT_HAIKU_MODEL',
  ],
  sonnet: [
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'OPENAI_DEFAULT_SONNET_MODEL',
    'GEMINI_DEFAULT_SONNET_MODEL',
  ],
  opus: [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'OPENAI_DEFAULT_OPUS_MODEL',
    'GEMINI_DEFAULT_OPUS_MODEL',
  ],
  fable: [
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'OPENAI_DEFAULT_FABLE_MODEL',
    'GEMINI_DEFAULT_FABLE_MODEL',
  ],
  glm: [
    'ANTHROPIC_DEFAULT_GLM_MODEL',
    'OPENAI_DEFAULT_GLM_MODEL',
    'GEMINI_DEFAULT_GLM_MODEL',
  ],
  grok: [
    'ANTHROPIC_DEFAULT_GROK_MODEL',
    'OPENAI_DEFAULT_GROK_MODEL',
    'GEMINI_DEFAULT_GROK_MODEL',
  ],
  kimi: [
    'ANTHROPIC_DEFAULT_KIMI_MODEL',
    'OPENAI_DEFAULT_KIMI_MODEL',
    'GEMINI_DEFAULT_KIMI_MODEL',
  ],
}

function normalizeSlotModel(model: string): string {
  return model
    .replace(/\[1m\]$/i, '')
    .trim()
    .toLowerCase()
}

export function getModelSlotForModel(
  model: string,
  env: Record<string, string | undefined> = process.env,
): ModelSlotName | undefined {
  const normalized = normalizeSlotModel(model)

  for (const [slot, envVars] of Object.entries(SLOT_MODEL_ENV_VARS) as [
    ModelSlotName,
    string[],
  ][]) {
    if (
      envVars.some(envVar => {
        const configured = env[envVar]
        return configured && normalizeSlotModel(configured) === normalized
      })
    ) {
      return slot
    }
  }

  if (normalized.includes('haiku')) return 'haiku'
  if (normalized.includes('sonnet')) return 'sonnet'
  if (normalized.includes('opus')) return 'opus'
  if (normalized.includes('fable')) return 'fable'
  if (normalized.includes('glm')) return 'glm'
  if (normalized.includes('grok')) return 'grok'
  if (normalized.includes('kimi')) return 'kimi'
  return undefined
}

export function resolveModelSlotApiOverride(
  model: string,
  overrides: ModelSlotOverrides | undefined,
  inheritedProvider: ModelSlotRoutingProvider,
  env: Record<string, string | undefined> = process.env,
  profiles?: ApiProfiles,
): ResolvedModelSlotApiOverride | undefined {
  const slot = getModelSlotForModel(model, env)
  if (!slot) return undefined
  const override = overrides?.[slot]
  if (!override) return undefined

  const selected = override.profileId
    ? profiles?.[override.profileId]
    : override.apiMode
      ? {
          name: '',
          apiMode: override.apiMode,
          baseUrl: override.baseUrl,
          authKey: override.authKey,
        }
      : undefined
  if (!selected) return undefined

  const baseUrl = selected.baseUrl?.trim() || undefined
  const authKey = selected.authKey?.trim() || undefined
  if (selected.apiMode === 'inherit' && !baseUrl && !authKey) return undefined

  const provider: ModelSlotRoutingProvider =
    selected.apiMode === 'inherit'
      ? inheritedProvider
      : selected.apiMode === 'anthropic'
        ? 'firstParty'
        : selected.apiMode

  return {
    slot,
    provider,
    apiMode: selected.apiMode,
    ...(baseUrl && { baseUrl }),
    ...(authKey && { authKey }),
  }
}
