import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import {
  getUnionState,
  setUnionImplementerModel,
  setUnionLevel,
  setUnionMode,
} from '../../union/state.js'
import type { UnionLevel } from '../../union/types.js'

function finish(onDone: LocalJSXCommandOnDone, message: string): null {
  onDone(message, { display: 'system', shouldQuery: false })
  return null
}

function formatStatus(): string {
  const state = getUnionState()
  return state.enabled
    ? `Union mode ON — planner level ${state.level} — implementer ${state.implementerModel ?? 'inherits the main model'}`
    : `Union mode OFF — normal behavior is unchanged`
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const rawAction = args.trim()
  const action = rawAction.toLowerCase()

  if (!action || action === 'status') {
    return finish(onDone, formatStatus())
  }

  if (action === 'off') {
    const error = setUnionMode(false)
    if (error) {
      return finish(
        onDone,
        `Union mode could not be disabled: ${error.message}`,
      )
    }
    return finish(onDone, formatStatus())
  }

  if (action === 'on') {
    const error = setUnionMode(true)
    if (error) {
      return finish(onDone, `Union mode could not be enabled: ${error.message}`)
    }
    return finish(onDone, formatStatus())
  }

  if (action.startsWith('model ')) {
    const requestedModel = rawAction.slice('model '.length).trim()
    if (!requestedModel) {
      return finish(onDone, 'Usage: /union model <model-name|inherit>')
    }
    if (requestedModel.includes(' ')) {
      return finish(
        onDone,
        'Union implementer model must be one model name without spaces.',
      )
    }
    const error = setUnionImplementerModel(
      requestedModel.toLowerCase() === 'inherit' ? undefined : requestedModel,
    )
    if (error) {
      return finish(
        onDone,
        `Union implementer model could not be changed: ${error.message}`,
      )
    }
    return finish(onDone, formatStatus())
  }

  if (action === 'model') {
    return finish(onDone, 'Usage: /union model <model-name|inherit>')
  }

  const level = action.toUpperCase()
  if (level === 'L0' || level === 'L1' || level === 'L2' || level === 'L3') {
    const error = setUnionLevel(level as UnionLevel)
    if (error) {
      return finish(
        onDone,
        `Union level could not be changed: ${error.message}`,
      )
    }
    return finish(onDone, formatStatus())
  }

  return finish(
    onDone,
    'Usage: /union [on|off|status|l0|l1|l2|l3|model <name|inherit>]',
  )
}
