import { AGENT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/AgentTool/constants.js'
import { EXECUTE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/ExecuteTool/constants.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/EnterPlanModeTool/constants.js'
import { ENTER_WORKTREE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/EnterWorktreeTool/constants.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/ExitPlanModeTool/constants.js'
import { EXIT_WORKTREE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/ExitWorktreeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/PowerShellTool/toolName.js'
import { REPL_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/REPLTool/constants.js'
import { SKILL_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SkillTool/constants.js'
import { BASH_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/BashTool/toolName.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SendMessageTool/constants.js'
import type { Tool } from '../Tool.js'
import type { PermissionDenyDecision } from '../types/permissions.js'
import { getUnionLevel, isUnionModeActive } from './state.js'

const INDIRECT_WRITE_TOOLS = new Set([
  AGENT_TOOL_NAME,
  EXECUTE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
  REPL_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SKILL_TOOL_NAME,
])

const DIRECT_WRITE_TOOLS = new Set([
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
])

export function getUnionPlannerDenial(
  tool: Pick<Tool, 'name' | 'isMcp' | 'isReadOnly'>,
  input: Record<string, unknown>,
  agentType?: string,
): PermissionDenyDecision | null {
  if (!isUnionModeActive()) return null
  if (agentType === 'union-implementer') return null
  const level = getUnionLevel()
  if (level !== 'L0' && level !== 'L1') return null

  const blocked =
    DIRECT_WRITE_TOOLS.has(tool.name) ||
    INDIRECT_WRITE_TOOLS.has(tool.name) ||
    tool.name === BASH_TOOL_NAME ||
    tool.name === POWERSHELL_TOOL_NAME ||
    tool.isMcp === true ||
    !tool.isReadOnly(input)

  if (!blocked) return null
  return {
    behavior: 'deny',
    message: `Union ${level} keeps the planner read-only. Finish investigation and submit a Union Plan Artifact for implementation.`,
    decisionReason: {
      type: 'other',
      reason: `union-${level.toLowerCase()}-planner-read-only`,
    },
  }
}
