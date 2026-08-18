import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../Tool.js'
import { lazySchema } from '../utils/lazySchema.js'
import {
  parseUnionPlanArtifact,
  UnionPlanArtifactSchema,
} from './planArtifact.js'
import {
  getUnionLevel,
  isUnionModeActive,
  isUnionToolAvailableForSession,
} from './state.js'
import { SUBMIT_UNION_PLAN_TOOL_NAME } from './types.js'

export { SUBMIT_UNION_PLAN_TOOL_NAME } from './types.js'

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum(['completed', 'not_run']),
    report: z.string(),
    model: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function getRunUnionImplementer(): typeof import('./implementer.js').runUnionImplementer {
  // The handoff agent pulls in the standard Agent runner and primitive tools.
  // Keep that graph off the normal startup path until L0/L1 actually submits.
  return (
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./implementer.js') as typeof import('./implementer.js'))
      .runUnionImplementer
  )
}

export const SubmitUnionPlanTool = buildTool({
  name: SUBMIT_UNION_PLAN_TOOL_NAME,
  searchHint: 'submit structured Union implementation handoff',
  maxResultSizeChars: 100_000,
  strict: true,
  alwaysLoad: true,
  isEnabled() {
    if (!isUnionModeActive()) return false
    if (!isUnionToolAvailableForSession()) return false
    const level = getUnionLevel()
    return level === 'L0' || level === 'L1' || level === 'L2'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  async description() {
    return 'Submit a validated Union Plan Artifact as the concrete handoff to implementation.'
  },
  async prompt() {
    return 'Use this once when your Union planning or glue handoff is ready. Keep it concrete and sized to the task.'
  },
  get inputSchema() {
    return UnionPlanArtifactSchema
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async call(input, context, canUseTool) {
    if (context.agentId) {
      throw new Error(
        'SubmitUnionPlan can only run from the main Union thread.',
      )
    }
    if (!isUnionModeActive()) {
      throw new Error(
        'SubmitUnionPlan is only available while Union mode is active.',
      )
    }
    if (!SubmitUnionPlanTool.isEnabled()) {
      throw new Error(
        'SubmitUnionPlan is not available at the active Union level.',
      )
    }
    const artifact = parseUnionPlanArtifact(input)
    if (artifact.union_level !== getUnionLevel()) {
      throw new Error(
        `Plan Artifact level ${artifact.union_level} does not match active Union level ${getUnionLevel()}.`,
      )
    }
    if (artifact.union_level !== 'L0' && artifact.union_level !== 'L1') {
      return {
        data: {
          status: 'not_run' as const,
          report:
            'Union L2 keeps core implementation with the planner; automatic glue delegation is not enabled yet.',
        },
      }
    }

    const refreshedTools = context.options.refreshTools?.()
    const implementationContext = refreshedTools
      ? {
          ...context,
          options: { ...context.options, tools: refreshedTools },
        }
      : context

    const result = await getRunUnionImplementer()({
      artifact,
      toolUseContext: implementationContext,
      canUseTool,
    })
    return {
      data: {
        status: 'completed' as const,
        report: result.report,
        model: result.model,
      },
    }
  },
  userFacingName() {
    return 'Submit Union Plan'
  },
  renderToolUseMessage(input) {
    return input.title
      ? `Submit Union plan: ${input.title}`
      : 'Submit Union plan'
  },
  renderToolResultMessage(output) {
    return output.status === 'completed'
      ? 'Union implementation completed'
      : output.report
  },
  mapToolResultToToolResultBlockParam(output: Output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content:
        output.status === 'completed'
          ? `Union implementer completed${output.model ? ` with ${output.model}` : ''}. Review its work and summarize the outcome for the user.\n\n${output.report}`
          : output.report,
    }
  },
} satisfies ToolDef<typeof UnionPlanArtifactSchema, Output>)
