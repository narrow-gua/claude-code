import { CLAUDE_OPUS_5_CONFIG } from '../model/configs.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// Used only when a teammate must inherit but the leader model is unavailable.
// Must be provider-aware so Bedrock/Vertex/Foundry customers get the correct
// model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_5_CONFIG[getAPIProvider()]
}
