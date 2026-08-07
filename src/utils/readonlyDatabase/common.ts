import { normalizeNameForMCP } from '../../services/mcp/normalization.js'

export const READONLY_DATABASE_MCP_SERVER_NAME = 'readonly-database'
export const READONLY_DATABASE_QUERY_TOOL_NAME = 'query'

export function isReadonlyDatabaseMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === READONLY_DATABASE_MCP_SERVER_NAME
}
