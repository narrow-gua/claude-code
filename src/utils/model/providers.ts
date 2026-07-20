import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getInitialSettings } from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import { isEnvTruthy } from '../envUtils.js'
import {
  resolveModelSlotApiOverride,
  type ResolvedModelSlotApiOverride,
} from './modelSlotRouting.js'
export {
  getModelSlotForModel,
  type ModelSlotApiMode,
  type ModelSlotName,
  type ResolvedModelSlotApiOverride,
} from './modelSlotRouting.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'grok'

export function getModelSlotApiOverride(
  model: string,
  settings: Pick<
    SettingsJson,
    'modelType' | 'modelSlotOverrides'
  > = getInitialSettings(),
): ResolvedModelSlotApiOverride | undefined {
  return resolveModelSlotApiOverride(
    model,
    settings.modelSlotOverrides,
    getAPIProvider(settings),
  )
}

export function getAPIProviderForModel(
  model: string,
  settings: Pick<
    SettingsJson,
    'modelType' | 'modelSlotOverrides'
  > = getInitialSettings(),
): APIProvider {
  return (
    getModelSlotApiOverride(model, settings)?.provider ??
    getAPIProvider(settings)
  )
}

export function getAPIProvider(
  settings: Pick<SettingsJson, 'modelType'> = getInitialSettings(),
): APIProvider {
  const modelType = settings.modelType
  if (modelType === 'openai') return 'openai'
  if (modelType === 'gemini') return 'gemini'
  if (modelType === 'grok') return 'grok'

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) return 'bedrock'
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) return 'vertex'
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) return 'foundry'

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) return 'openai'
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) return 'gemini'
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_GROK)) return 'grok'

  return 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  // TODO: 这里会有问题, 只配置了 openai 协议的用户, 按理说会为 true 导致问题
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
