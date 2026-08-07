import { join } from 'path'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { isInBundledMode } from '../bundledMode.js'
import { distRoot } from '../distRoot.js'
import {
  READONLY_DATABASE_MCP_SERVER_NAME,
  READONLY_DATABASE_QUERY_TOOL_NAME,
} from './common.js'

export function setupReadonlyDatabaseMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
} {
  const args = isInBundledMode()
    ? ['--readonly-database-mcp']
    : [join(distRoot, 'cli.js'), '--readonly-database-mcp']

  return {
    mcpConfig: {
      [READONLY_DATABASE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args,
        scope: 'dynamic',
      },
    },
    allowedTools: [
      buildMcpToolName(
        READONLY_DATABASE_MCP_SERVER_NAME,
        READONLY_DATABASE_QUERY_TOOL_NAME,
      ),
    ],
  }
}
