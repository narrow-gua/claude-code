import { feature } from 'bun:bundle'
import { isEnvTruthy } from '../utils/envUtils.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import type { UnionLevel, UnionSettings, UnionState } from './types.js'

const DEFAULT_LEVEL: UnionLevel = 'L1'

let sessionLevel: UnionLevel | null = null
let sessionEnabled: boolean | null = null
let sessionToolAllowedByBaseTools = true
let sessionToolDeniedByRules = false
let stateVersion = 0

function notifyUnionStateChanged(): void {
  stateVersion++
}

export function getUnionStateVersion(): number {
  return stateVersion
}

function getStoredUnionSettings(): UnionSettings | undefined {
  return getInitialSettings().union
}

function levelRequiresHandoffTool(level: UnionLevel): boolean {
  return level === 'L0' || level === 'L1'
}

export function isUnionModeActive(): boolean {
  if (!feature('UNION_MODE')) return false
  if (feature('COORDINATOR_MODE')) {
    if (isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)) return false
  }
  if (sessionEnabled === null) {
    sessionEnabled = getStoredUnionSettings()?.enabled === true
  }
  if (
    sessionEnabled &&
    !isUnionToolAvailableForSession() &&
    levelRequiresHandoffTool(getUnionLevel())
  ) {
    return false
  }
  return sessionEnabled
}

export function getUnionLevel(): UnionLevel {
  if (sessionLevel === null) {
    sessionLevel = getStoredUnionSettings()?.defaultLevel ?? DEFAULT_LEVEL
  }
  return sessionLevel
}

export function getUnionImplementerModel(): string | undefined {
  return getStoredUnionSettings()?.implementerModel?.trim() || undefined
}

export function getUnionState(): UnionState {
  const enabled = isUnionModeActive()
  return {
    enabled,
    level: getUnionLevel(),
    implementerModel: enabled ? getUnionImplementerModel() : undefined,
  }
}

export function isUnionToolAvailableForSession(): boolean {
  return sessionToolAllowedByBaseTools && !sessionToolDeniedByRules
}

export function setUnionToolAvailableForSession(available: boolean): void {
  if (sessionToolAllowedByBaseTools === available) return
  sessionToolAllowedByBaseTools = available
  notifyUnionStateChanged()
}

export function setUnionToolDeniedByRulesForSession(denied: boolean): void {
  if (sessionToolDeniedByRules === denied) return
  sessionToolDeniedByRules = denied
  notifyUnionStateChanged()
}

export function setUnionMode(active: boolean): Error | null {
  if (active && isCoordinatorModeRequested()) {
    return new Error(
      'Coordinator mode is active. Disable Coordinator before enabling Union.',
    )
  }
  if (
    active &&
    !isUnionToolAvailableForSession() &&
    levelRequiresHandoffTool(getUnionLevel())
  ) {
    return new Error(
      'SubmitUnionPlan is excluded by the current --tools selection. Include it or use Union L2/L3.',
    )
  }
  const current = getStoredUnionSettings()
  const { error } = updateSettingsForSource('userSettings', {
    union: {
      ...current,
      enabled: active,
      defaultLevel: current?.defaultLevel ?? getUnionLevel(),
    },
  })
  if (error) return error
  sessionEnabled = active
  notifyUnionStateChanged()
  return null
}

export function setUnionImplementerModel(
  model: string | undefined,
): Error | null {
  const current = getStoredUnionSettings()
  const enabled = current?.enabled ?? isUnionModeActive()
  const level = current?.defaultLevel ?? getUnionLevel()
  const { error } = updateSettingsForSource('userSettings', {
    union: {
      ...current,
      enabled,
      defaultLevel: level,
      implementerModel: model?.trim() || undefined,
    },
  })
  if (error) return error
  sessionEnabled = enabled
  sessionLevel = level
  notifyUnionStateChanged()
  return null
}

export function setUnionLevel(level: UnionLevel): Error | null {
  if (isCoordinatorModeRequested()) {
    return new Error(
      'Coordinator mode is active. Disable Coordinator before changing the Union level.',
    )
  }
  if (!isUnionToolAvailableForSession() && levelRequiresHandoffTool(level)) {
    return new Error(
      'SubmitUnionPlan is excluded by the current --tools selection. Include it before using Union L0/L1.',
    )
  }
  const current = getStoredUnionSettings()
  const { error } = updateSettingsForSource('userSettings', {
    union: {
      ...current,
      enabled: true,
      defaultLevel: level,
    },
  })
  if (error) return error
  sessionLevel = level
  sessionEnabled = true
  notifyUnionStateChanged()
  return null
}

export function isCoordinatorModeRequested(): boolean {
  if (!feature('COORDINATOR_MODE')) return false
  return isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
}

/** Test-only reset for the module-level session cache. */
export function resetUnionStateForTest(): void {
  sessionLevel = null
  sessionEnabled = null
  sessionToolAllowedByBaseTools = true
  sessionToolDeniedByRules = false
  stateVersion = 0
}
