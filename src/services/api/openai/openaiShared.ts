/**
 * Shared utilities for OpenAI-compatible API paths.
 *
 * Both the OpenAI path (queryModelOpenAI) and Grok path (queryModelGrok) use
 * the same adapters (openaiStreamAdapter, openaiConvertMessages), so the event
 * processing logic should be shared rather than duplicated.
 *
 * Keep this module free of bootstrap/state imports so pure request-body unit
 * tests and isolated mocks do not need a full session runtime.
 */
import { createHash, randomUUID } from 'crypto'

/**
 * Build a stable OpenAI `prompt_cache_key` for a session.
 *
 * OpenAI automatic prefix caching benefits from routing sticky keys so multi-turn
 * requests land on the same cache-bearing compute node. The key must be stable
 * for the whole conversation — never derived from full message bodies (that
 * changes every turn and defeats routing).
 *
 * Format: `prism:<sessionId>`
 */
export function formatOpenAIPromptCacheKey(sessionId: string): string {
  return `prism:${sessionId}`
}

/**
 * Process-scoped fallback for isolated request builders and compatible API
 * callers that do not have a Prism session. Production query paths pass the
 * persisted session ID explicitly so cache routing survives /resume and
 * process restarts. Keeping bootstrap/state out of this pure helper also keeps
 * request-body unit tests and partial mocks isolated.
 */
let processPromptCacheKey: string | null = null

/**
 * Stable OpenAI `prompt_cache_key`.
 * Production callers should pass the active session ID. Without one, this
 * falls back to a process-stable key for compatibility and isolated tests.
 */
export function getOpenAIPromptCacheKey(
  sessionIdOverride?: string,
  querySource?: string,
  agentId?: string,
): string {
  const sessionKey = sessionIdOverride
    ? formatOpenAIPromptCacheKey(sessionIdOverride)
    : getProcessPromptCacheKey()

  // Codex deliberately gives root and spawned-agent requests different thread
  // IDs but the same session-scoped prompt_cache_key. Preserve that lineage
  // for normal conversation turns, full-context forks, and every real agent.
  if (isConversationCacheSource(querySource, agentId)) {
    return sessionKey
  }

  // Background helpers (compaction, title generation, auto-dream, validation,
  // etc.) have unrelated leading instructions. Giving them the conversation's
  // routing key can make concurrent helper traffic compete with the long-lived
  // conversation prefix. Keep each helper kind stable but in its own namespace.
  const sourceHash = createHash('sha256')
    .update(querySource as string)
    .digest('hex')
    .slice(0, 12)
  return `${sessionKey}:aux:${sourceHash}`
}

function getProcessPromptCacheKey(): string {
  if (!processPromptCacheKey) {
    processPromptCacheKey = formatOpenAIPromptCacheKey(randomUUID())
  }
  return processPromptCacheKey
}

function isConversationCacheSource(
  querySource: string | undefined,
  agentId: string | undefined,
): boolean {
  if (agentId || !querySource) return true

  return (
    querySource === 'sdk' ||
    querySource === 'workflow' ||
    querySource === 'main_loop' ||
    querySource === 'side_question' ||
    querySource.startsWith('repl_main_thread') ||
    querySource.startsWith('agent:')
  )
}

/**
 * Merge a delta usage into the accumulated usage, preserving cache-related
 * fields from previous values when the delta carries explicit zeroes or
 * undefined values.
 *
 * Mirrors updateUsage() in claude.ts: a future adapter change that omits
 * cache fields from certain streaming events should not silently zero the
 * accumulated counters.
 */
export function updateOpenAIUsage(
  current: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  },
  delta: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  },
): typeof current {
  return {
    input_tokens: delta.input_tokens ?? current.input_tokens,
    output_tokens: delta.output_tokens ?? current.output_tokens,
    cache_creation_input_tokens:
      delta.cache_creation_input_tokens !== undefined &&
      delta.cache_creation_input_tokens > 0
        ? delta.cache_creation_input_tokens
        : current.cache_creation_input_tokens,
    cache_read_input_tokens:
      delta.cache_read_input_tokens !== undefined &&
      delta.cache_read_input_tokens > 0
        ? delta.cache_read_input_tokens
        : current.cache_read_input_tokens,
  }
}
