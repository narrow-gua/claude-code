import { createHash } from 'node:crypto'

const VALID_TOOL_USE_ID = /^[A-Za-z0-9_-]+$/
const TOOL_USE_BLOCK_TYPES = new Set([
  'tool_use',
  'server_tool_use',
  'mcp_tool_use',
])

/**
 * Anthropic and Bedrock only accept tool-use IDs containing ASCII letters,
 * digits, underscores, and hyphens. Some compatible providers emit IDs such
 * as `Edit:18`; use a deterministic digest instead of character replacement
 * so distinct upstream IDs cannot collapse to the same normalized ID.
 */
export function normalizeToolUseId(id: string): string {
  if (VALID_TOOL_USE_ID.test(id)) return id
  const digest = createHash('sha256').update(id).digest('hex').slice(0, 24)
  return `toolu_prism_${digest}`
}

type MessageWithContent = {
  message?: {
    content?: unknown
    [key: string]: unknown
  }
}

/**
 * Repair both sides of tool-use relationships before an API request. This is
 * intentionally applied to cloned request messages rather than transcripts so
 * old sessions remain readable while becoming portable across providers.
 */
export function normalizeToolUseIdsForAPI<T>(messages: T[]): T[] {
  return messages.map(message => {
    const envelope = message as MessageWithContent
    const content = envelope.message?.content
    if (!Array.isArray(content)) return message

    let changed = false
    const normalizedContent = content.map(block => {
      if (typeof block !== 'object' || block === null || Array.isArray(block)) {
        return block
      }

      const record = block as Record<string, unknown>
      let normalized = record
      if (
        TOOL_USE_BLOCK_TYPES.has(String(record.type)) &&
        typeof record.id === 'string'
      ) {
        const id = normalizeToolUseId(record.id)
        if (id !== record.id) {
          normalized = { ...normalized, id }
          changed = true
        }
      }

      if (typeof record.tool_use_id === 'string') {
        const toolUseId = normalizeToolUseId(record.tool_use_id)
        if (toolUseId !== record.tool_use_id) {
          normalized = { ...normalized, tool_use_id: toolUseId }
          changed = true
        }
      }

      return normalized
    })

    if (!changed) return message
    return {
      ...(message as object),
      message: {
        ...envelope.message,
        content: normalizedContent,
      },
    } as T
  })
}
