export type ModelSlotName = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'glm'
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
  return undefined
}

export function resolveModelSlotApiOverride(
  model: string,
  overrides: ModelSlotOverrides | undefined,
  inheritedProvider: ModelSlotRoutingProvider,
  env: Record<string, string | undefined> = process.env,
): ResolvedModelSlotApiOverride | undefined {
  const slot = getModelSlotForModel(model, env)
  if (!slot) return undefined
  const override = overrides?.[slot]
  if (!override) return undefined

  const baseUrl = override.baseUrl?.trim() || undefined
  const authKey = override.authKey?.trim() || undefined
  if (override.apiMode === 'inherit' && !baseUrl && !authKey) return undefined

  const provider: ModelSlotRoutingProvider =
    override.apiMode === 'inherit'
      ? inheritedProvider
      : override.apiMode === 'anthropic'
        ? 'firstParty'
        : override.apiMode

  return {
    slot,
    provider,
    apiMode: override.apiMode,
    ...(baseUrl && { baseUrl }),
    ...(authKey && { authKey }),
  }
}
