import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { Tool, ToolPermissionContext, Tools } from '../../Tool.js'

let enabled = false

mock.module('../SubmitUnionPlanTool.js', () => ({
  SUBMIT_UNION_PLAN_TOOL_NAME: 'SubmitUnionPlan',
  SubmitUnionPlanTool: {
    name: 'SubmitUnionPlan',
    isEnabled: () => enabled,
  } as unknown as Tool,
}))
mock.module('../state.js', () => ({
  setUnionToolDeniedByRulesForSession: () => {},
}))

const {
  applyUnionToolVisibility,
  getUnionPermissionToolNames,
  isUnionToolAllowedByBaseTools,
} = await import('../toolVisibility.js')

const readTool = { name: 'Read' } as Tool
const submitTool = { name: 'SubmitUnionPlan' } as Tool

function permissionContext(denied: string[] = []): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: denied.length ? { cliArg: denied } : {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
  }
}

afterEach(() => {
  enabled = false
})

describe('applyUnionToolVisibility', () => {
  test('does not add a Union-only permission name while disabled', () => {
    expect(getUnionPermissionToolNames()).toEqual([])
    enabled = true
    expect(getUnionPermissionToolNames()).toEqual(['SubmitUnionPlan'])
  })

  test('respects explicit base-tool restrictions', () => {
    expect(isUnionToolAllowedByBaseTools([])).toBe(true)
    expect(isUnionToolAllowedByBaseTools(['default'])).toBe(true)
    expect(isUnionToolAllowedByBaseTools([' DEFAULT '])).toBe(true)
    expect(isUnionToolAllowedByBaseTools(['Read', 'SubmitUnionPlan'])).toBe(
      true,
    )
    expect(isUnionToolAllowedByBaseTools(['Read,SubmitUnionPlan'])).toBe(true)
    expect(isUnionToolAllowedByBaseTools(['Read', 'Edit'])).toBe(false)
  })

  test('preserves the exact tool array while Union is disabled', () => {
    const tools: Tools = [readTool]
    expect(applyUnionToolVisibility(tools, permissionContext())).toBe(tools)
  })

  test('does not remove an unrelated same-name tool while Union is disabled', () => {
    const tools: Tools = [readTool, submitTool]
    expect(applyUnionToolVisibility(tools, permissionContext())).toBe(tools)
  })

  test('replaces a same-name conflict only while Union is active', () => {
    enabled = true
    const tools: Tools = [readTool, submitTool]
    const active = applyUnionToolVisibility(tools, permissionContext())

    expect(active.map(tool => tool.name)).toEqual(['Read', 'SubmitUnionPlan'])
    expect(active[1]).not.toBe(submitTool)
  })

  test('adds and removes the handoff tool as Union state changes', () => {
    const tools: Tools = [readTool]
    enabled = true
    const active = applyUnionToolVisibility(tools, permissionContext())
    expect(active.map(tool => tool.name)).toEqual(['Read', 'SubmitUnionPlan'])

    enabled = false
    expect(
      applyUnionToolVisibility(active, permissionContext()).map(
        tool => tool.name,
      ),
    ).toEqual(['Read'])
  })

  test('does not bypass an explicit tool deny rule', () => {
    enabled = true
    const tools: Tools = [readTool, submitTool]
    expect(
      applyUnionToolVisibility(
        tools,
        permissionContext(['SubmitUnionPlan']),
      ).map(tool => tool.name),
    ).toEqual(['Read'])
  })

  test('filters a same-name custom tool when denied even after Union fails open', () => {
    enabled = false
    const tools: Tools = [readTool, submitTool]

    expect(
      applyUnionToolVisibility(
        tools,
        permissionContext(['SubmitUnionPlan']),
      ).map(tool => tool.name),
    ).toEqual(['Read'])
  })
})
