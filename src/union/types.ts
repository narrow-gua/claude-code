export const UNION_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
export const SUBMIT_UNION_PLAN_TOOL_NAME = 'SubmitUnionPlan'

export type UnionLevel = (typeof UNION_LEVELS)[number]

export type UnionSettings = {
  enabled?: boolean
  defaultLevel?: UnionLevel
  implementerModel?: string
}

export type UnionState = {
  enabled: boolean
  level: UnionLevel
  implementerModel?: string
}
