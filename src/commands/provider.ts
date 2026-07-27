import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getSettings_DEPRECATED,
  migrateInlineSlotOverridesToProfiles,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js'

function getEnvVarForProvider(provider: string): string {
  switch (provider) {
    case 'bedrock':
      return 'CLAUDE_CODE_USE_BEDROCK'
    case 'vertex':
      return 'CLAUDE_CODE_USE_VERTEX'
    case 'foundry':
      return 'CLAUDE_CODE_USE_FOUNDRY'
    case 'gemini':
      return 'CLAUDE_CODE_USE_GEMINI'
    case 'grok':
      return 'CLAUDE_CODE_USE_GROK'
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// Get merged env: process.env + settings.env (from userSettings)
function getMergedEnv(): Record<string, string> {
  const settings = getSettings_DEPRECATED()
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  )
  if (settings?.env) {
    Object.assign(merged, settings.env)
  }
  return merged
}

const call: LocalCommandCall = async (args, _context) => {
  const rawArg = args.trim()
  const arg = rawArg.toLowerCase()

  if (arg === 'profiles' || arg.startsWith('use ')) {
    const { error } = migrateInlineSlotOverridesToProfiles()
    if (error) {
      return {
        type: 'text',
        value: `Failed to migrate existing API override: ${error.message}`,
      }
    }
  }

  if (arg === 'profiles') {
    const profiles = getSettings_DEPRECATED()?.apiProfiles ?? {}
    const overrides = getSettings_DEPRECATED()?.modelSlotOverrides ?? {}
    const assignedSlots = new Map<string, string[]>()
    for (const [slot, override] of Object.entries(overrides)) {
      if (!override || !('profileId' in override)) continue
      const slots = assignedSlots.get(override.profileId) ?? []
      slots.push(slot)
      assignedSlots.set(override.profileId, slots)
    }
    const lines = Object.entries(profiles)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([profileId, profile]) => {
        const slots = assignedSlots.get(profileId)
        return `- ${profile.name} [${profileId}] · ${profile.apiMode}${slots?.length ? ` · slots: ${slots.join(', ')}` : ''}`
      })
    return {
      type: 'text',
      value: lines.length
        ? `Saved API profiles:\n${lines.join('\n')}\n\nSwitch: /api use <slot> <name-or-id>`
        : 'No API profiles saved. Create one via /login → API profiles & model slots.',
    }
  }

  if (arg.startsWith('use ')) {
    const match = rawArg.match(
      /^use\s+(all|haiku|sonnet|opus|fable|glm|grok|kimi)\s+(.+)$/i,
    )
    if (!match) {
      return {
        type: 'text',
        value:
          'Usage: /api use <all|haiku|sonnet|opus|fable|glm|grok|kimi> <profile-name-or-id|inherit>',
      }
    }
    const slot = match[1]!.toLowerCase()
    const targetSlots =
      slot === 'all'
        ? ['haiku', 'sonnet', 'opus', 'fable', 'glm', 'grok', 'kimi']
        : [slot]
    const targetLabel = slot === 'all' ? 'all model slots' : slot
    const inheritVerb = slot === 'all' ? 'inherit' : 'inherits'
    const useVerb = slot === 'all' ? 'use' : 'uses'
    const target = match[2]!.trim()
    if (target.toLowerCase() === 'inherit') {
      const { error } = updateSettingsForSource('userSettings', {
        modelSlotOverrides: Object.fromEntries(
          targetSlots.map(targetSlot => [targetSlot, undefined]),
        ),
      })
      return {
        type: 'text',
        value: error
          ? `Failed to clear ${targetLabel} API profile: ${error.message}`
          : `${targetLabel} now ${inheritVerb} the global API settings.`,
      }
    }

    const profiles = getSettings_DEPRECATED()?.apiProfiles ?? {}
    const matches = Object.entries(profiles).filter(
      ([profileId, profile]) =>
        profileId === target ||
        profile.name.toLowerCase() === target.toLowerCase(),
    )
    if (matches.length === 0) {
      return {
        type: 'text',
        value: `API profile not found: ${target}\nRun /api profiles to list saved profiles.`,
      }
    }
    if (matches.length > 1) {
      return {
        type: 'text',
        value: `Multiple profiles are named “${target}”. Use the profile ID from /api profiles.`,
      }
    }
    const [profileId, profile] = matches[0]!
    const { error } = updateSettingsForSource('userSettings', {
      modelSlotOverrides: Object.fromEntries(
        targetSlots.map(targetSlot => [targetSlot, { profileId }]),
      ),
    })
    return {
      type: 'text',
      value: error
        ? `Failed to switch ${targetLabel} API profile: ${error.message}`
        : `${targetLabel} now ${useVerb} API profile “${profile.name}”.`,
    }
  }

  // No argument: show current provider
  if (!arg) {
    const current = getAPIProvider()
    return { type: 'text', value: `Current API provider: ${current}` }
  }

  // unset - clear settings, fallback to env vars
  if (arg === 'unset') {
    updateSettingsForSource('userSettings', { modelType: undefined })
    // Also clear all provider-specific env vars to prevent conflicts
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    return {
      type: 'text',
      value: 'API provider cleared (will use environment variables).',
    }
  }

  // Validate provider
  const validProviders = [
    'anthropic',
    'openai',
    'gemini',
    'grok',
    'bedrock',
    'vertex',
    'foundry',
  ]
  if (!validProviders.includes(arg)) {
    return {
      type: 'text',
      value: `Invalid provider: ${arg}\nValid: ${validProviders.join(', ')}`,
    }
  }

  // Check env vars when switching to openai (including settings.env)
  if (arg === 'openai') {
    const mergedEnv = getMergedEnv()
    const hasChatGPTAuth = mergedEnv.OPENAI_AUTH_MODE === 'chatgpt'
    const hasKey = !!mergedEnv.OPENAI_API_KEY
    const hasUrl = !!mergedEnv.OPENAI_BASE_URL
    if (!hasChatGPTAuth && (!hasKey || !hasUrl)) {
      updateSettingsForSource('userSettings', { modelType: 'openai' })
      const missing = []
      if (!hasKey) missing.push('OPENAI_API_KEY')
      if (!hasUrl) missing.push('OPENAI_BASE_URL')
      return {
        type: 'text',
        value: `Switched to OpenAI provider.\nWarning: Missing env vars: ${missing.join(', ')}\nConfigure them via /login or set manually.`,
      }
    }
  }

  // Check env vars when switching to grok (including settings.env)
  if (arg === 'grok') {
    const mergedEnv = getMergedEnv()
    const hasKey = !!(mergedEnv.GROK_API_KEY || mergedEnv.XAI_API_KEY)
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'grok' })
      return {
        type: 'text',
        value: `Switched to Grok provider.\nWarning: Missing env var: GROK_API_KEY (or XAI_API_KEY)\nConfigure it via settings.json env or set manually.`,
      }
    }
  }

  // Check env vars when switching to gemini (including settings.env)
  if (arg === 'gemini') {
    const mergedEnv = getMergedEnv()
    const hasKey = !!mergedEnv.GEMINI_API_KEY
    // GEMINI_BASE_URL is optional (has default)
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'gemini' })
      return {
        type: 'text',
        value: `Switched to Gemini provider.\nWarning: Missing env var: GEMINI_API_KEY\nConfigure it via /login or set manually.`,
      }
    }
  }

  // Handle different provider types
  // - 'anthropic', 'openai', 'gemini' are stored in settings.json (persistent)
  // - 'bedrock', 'vertex', 'foundry' are env-only (do NOT touch settings.json)
  if (
    arg === 'anthropic' ||
    arg === 'openai' ||
    arg === 'gemini' ||
    arg === 'grok'
  ) {
    // Clear any cloud provider env vars to avoid conflicts
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    // Update settings.json
    updateSettingsForSource('userSettings', { modelType: arg })
    // Ensure settings.env gets applied to process.env
    applyConfigEnvironmentVariables()
    return { type: 'text', value: `API provider set to ${arg}.` }
  } else {
    // Cloud providers: set env vars only, do NOT touch settings.json
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    process.env[getEnvVarForProvider(arg)] = '1'
    // Do not modify settings.json - cloud providers controlled solely by env vars
    applyConfigEnvironmentVariables()
    return {
      type: 'text',
      value: `API provider set to ${arg} (via environment variable).`,
    }
  }
}

const provider = {
  type: 'local',
  name: 'provider',
  description:
    'Switch API provider or assign saved API profiles to model slots',
  aliases: ['api'],
  argumentHint:
    '[profiles|use <slot> <profile>|anthropic|openai|gemini|grok|bedrock|vertex|foundry|unset]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default provider
