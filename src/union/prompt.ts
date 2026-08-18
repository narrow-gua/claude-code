import type { SystemPrompt } from '../utils/systemPromptType.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { getUnionLevel, isUnionModeActive } from './state.js'

export function getUnionPlannerPrompt(): string {
  const level = getUnionLevel()
  if (level === 'L3') return ''
  const role =
    level === 'L0' || level === 'L1'
      ? 'Your tools keep this turn read-only; use SubmitUnionPlan when a concrete implementation handoff is ready.'
      : 'You retain implementation authority and may work directly; a structured handoff is optional.'

  return `# Union Mode — Planner (${level})
Use normal engineering judgment and preserve solution quality. Adapt your approach and depth to the task. ${role}`
}

export function appendUnionPlannerPrompt(
  systemPrompt: SystemPrompt,
  options?: { agentId?: string },
): SystemPrompt {
  if (!isUnionModeActive() || options?.agentId) return systemPrompt
  const plannerPrompt = getUnionPlannerPrompt()
  if (!plannerPrompt) return systemPrompt
  return asSystemPrompt([...systemPrompt, plannerPrompt])
}
