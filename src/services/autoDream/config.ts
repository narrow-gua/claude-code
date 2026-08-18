// Leaf config module — intentionally minimal imports so UI components
// can read the auto-dream enabled state without dragging in the forked
// agent / task registry / message builder chain that autoDream.ts pulls in.

import { getInitialSettings } from '../../utils/settings/settings.js'
import type { APIProvider } from '../../utils/model/providers.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * Whether background memory consolidation should run. User setting
 * (autoDreamEnabled in settings.json) overrides the GrowthBook default
 * when explicitly set; otherwise falls through to tengu_onyx_plover.
 */
export function isAutoDreamEnabled(provider?: APIProvider): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting

  // The remote flag is an Anthropic product default, not permission to spend
  // tokens through a user-configured third-party model slot. Such providers
  // may not support prompt caching and a 20-turn dream can be unexpectedly
  // expensive. Users can still opt in explicitly from the memory UI or
  // settings.json, and manual /dream remains unaffected.
  if (provider !== undefined && provider !== 'firstParty') return false

  const gb = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: unknown } | null>(
    'tengu_onyx_plover',
    null,
  )
  return gb?.enabled === true
}
