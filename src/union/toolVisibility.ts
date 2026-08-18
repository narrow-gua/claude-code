import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'
import { toolMatchesName } from '../Tool.js'
import {
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from '../services/mcp/mcpStringUtils.js'
import { permissionRuleValueFromString } from '../utils/permissions/permissionRuleParser.js'
import { SETTING_SOURCES } from '../utils/settings/constants.js'
import { setUnionToolDeniedByRulesForSession } from './state.js'
import {
  SUBMIT_UNION_PLAN_TOOL_NAME,
  SubmitUnionPlanTool,
} from './SubmitUnionPlanTool.js'

export function getUnionPermissionToolNames(): string[] {
  return SubmitUnionPlanTool.isEnabled() ? [SUBMIT_UNION_PLAN_TOOL_NAME] : []
}

const UNION_PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
] as const

function isToolDenied(
  permissionContext: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): boolean {
  const toolName = getToolNameForPermissionCheck(tool)
  return UNION_PERMISSION_RULE_SOURCES.some(source =>
    (permissionContext.alwaysDenyRules[source] ?? []).some(ruleString => {
      const ruleValue = permissionRuleValueFromString(ruleString)
      if (ruleValue.ruleContent !== undefined) return false
      if (ruleValue.toolName === toolName) return true
      const ruleInfo = mcpInfoFromString(ruleValue.toolName)
      const toolInfo = mcpInfoFromString(toolName)
      return (
        ruleInfo !== null &&
        toolInfo !== null &&
        (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') &&
        ruleInfo.serverName === toolInfo.serverName
      )
    }),
  )
}

export function isUnionToolAllowedByBaseTools(
  baseTools: readonly string[],
): boolean {
  if (baseTools.length === 0) return true
  if (
    baseTools.length === 1 &&
    baseTools[0]?.trim().toLowerCase() === 'default'
  ) {
    return true
  }
  return baseTools
    .flatMap(toolNames => toolNames.split(/[\s,]+/))
    .includes(SUBMIT_UNION_PLAN_TOOL_NAME)
}

/**
 * Reconciles the session tool list with the current Union state.
 *
 * The original array is retained when no change is needed. In particular,
 * compiling Union support into the binary does not perturb disabled sessions.
 */
export function applyUnionToolVisibility(
  tools: Tools,
  permissionContext?: ToolPermissionContext,
): Tools {
  const hasInjectedTool = tools.includes(SubmitUnionPlanTool)
  const denied = permissionContext
    ? isToolDenied(permissionContext, SubmitUnionPlanTool)
    : false
  if (permissionContext) setUnionToolDeniedByRulesForSession(denied)

  if (denied) {
    const filtered = tools.filter(
      tool => !toolMatchesName(tool, SUBMIT_UNION_PLAN_TOOL_NAME),
    )
    return filtered.length === tools.length ? tools : filtered
  }

  const enabled = SubmitUnionPlanTool.isEnabled()
  if (!enabled) {
    if (!hasInjectedTool) return tools
    return tools.filter(tool => tool !== SubmitUnionPlanTool)
  }

  const hasNameConflict = tools.some(
    tool =>
      tool !== SubmitUnionPlanTool &&
      toolMatchesName(tool, SUBMIT_UNION_PLAN_TOOL_NAME),
  )
  if (hasInjectedTool && !hasNameConflict) return tools

  // An initial/custom tool can win the earlier name-based pool deduplication.
  // Union owns this name only while active, so replace conflicts here without
  // touching them in normal mode.
  const withoutConflicts = tools.filter(
    tool => !toolMatchesName(tool, SUBMIT_UNION_PLAN_TOOL_NAME),
  )
  return [...withoutConflicts, SubmitUnionPlanTool]
}
