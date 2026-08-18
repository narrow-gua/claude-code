import { BASH_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/PowerShellTool/toolName.js'
import type { BuiltInAgentDefinition } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { resolve } from 'node:path'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type {
  Tool,
  ToolPermissionContext,
  Tools,
  ToolUseContext,
} from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { isAbortError, isENOENT } from '../utils/errors.js'
import { getFileModificationTimeAsync } from '../utils/file.js'
import { createUserMessage, extractTextContent } from '../utils/messages.js'
import { getAgentModel } from '../utils/model/agent.js'
import { getDenyRuleForTool } from '../utils/permissions/permissions.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { UnionPlanArtifact } from './planArtifact.js'
import { getUnionImplementerModel } from './state.js'

const IMPLEMENTER_TOOL_NAMES = new Set([
  FILE_READ_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
])

const IMPLEMENTER_SYSTEM_PROMPT = `# Union Mode — Implementer
Implement the validated Plan Artifact in the current repository using the available tools. Re-read existing files before editing, preserve the stated invariants, run feasible acceptance checks, and report the result. Use normal engineering judgment when details are underspecified; make changes through tools rather than returning a patch.`

const UNION_IMPLEMENTER_AGENT: BuiltInAgentDefinition = {
  agentType: 'union-implementer',
  whenToUse: 'Executes a validated Union Plan Artifact.',
  tools: ['*'],
  source: 'built-in',
  baseDir: 'built-in',
  permissionMode: 'bubble',
  getSystemPrompt: () => IMPLEMENTER_SYSTEM_PROMPT,
}

type RunUnionImplementerParams = {
  artifact: UnionPlanArtifact
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
}

type RunUnionAgent =
  typeof import('@claude-code-best/builtin-tools/tools/AgentTool/runAgent.js').runAgent

let runUnionAgentOverride: RunUnionAgent | undefined

export type UnionImplementerResult = {
  model: string
  report: string
}

/** Test seam; production always resolves the standard runAgent lazily. */
export function setRunUnionAgentForTest(
  runner: RunUnionAgent | undefined,
): void {
  runUnionAgentOverride = runner
}

function getRunUnionAgent(): RunUnionAgent {
  if (runUnionAgentOverride) return runUnionAgentOverride
  // Loading runAgent while the main registry is still initializing pulls in
  // commands and can form a registry cycle. SubmitUnionPlan reaches this only
  // after startup, so defer the standard runner until the actual handoff.
  return (
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (
      require('@claude-code-best/builtin-tools/tools/AgentTool/runAgent.js') as typeof import('@claude-code-best/builtin-tools/tools/AgentTool/runAgent.js')
    ).runAgent
  )
}

export function isUnionImplementerToolAllowed(
  tool: Pick<Tool, 'name' | 'isMcp' | 'isEnabled'>,
  permissionContext: ToolPermissionContext,
): boolean {
  return (
    tool.isEnabled() &&
    !tool.isMcp &&
    IMPLEMENTER_TOOL_NAMES.has(tool.name) &&
    getDenyRuleForTool(permissionContext, tool) === null
  )
}

function getImplementerTools(
  tools: Tools,
  toolUseContext: ToolUseContext,
): Tool[] {
  // Deferred to call time: primitiveTools imports AgentTool, which in turn
  // imports the main tool registry. Loading it while the registry initializes
  // would create a cycle on Union-enabled builds.
  const { getReplPrimitiveTools } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code-best/builtin-tools/tools/REPLTool/primitiveTools.js') as typeof import('@claude-code-best/builtin-tools/tools/REPLTool/primitiveTools.js')
  const permissionContext = toolUseContext.getAppState().toolPermissionContext
  return uniqBy(
    [...tools, ...getReplPrimitiveTools()].filter(tool =>
      isUnionImplementerToolAllowed(tool, permissionContext),
    ),
    'name',
  )
}

export function buildUnionImplementerPrompt(
  artifact: UnionPlanArtifact,
  fileContext: string,
): string {
  return `Implement the following validated Union Plan Artifact. Its repository-relative paths identify the intended scope; inspect the current files with Read before editing. Acceptance commands are requirements to run when they are safe and available, while manual checks must be reported for the caller.

${jsonStringify(artifact, null, 2)}

# Planner-read file context
These snapshots were already read through the parent session's Read tool. Re-read each existing file before editing so stale-file protection remains authoritative. Entries explicitly marked as not existing are intended new files; verify their path before creating them.

${fileContext}`
}

export async function collectPlannerReadFileContext(
  artifact: UnionPlanArtifact,
  readFileState: ToolUseContext['readFileState'],
): Promise<string> {
  const paths = Array.from(
    new Set([
      ...artifact.files_to_touch,
      ...artifact.core_files,
      ...artifact.core_hunks.map(hunk => hunk.file),
      ...artifact.glue_tasks.flatMap(task => task.files),
      ...artifact.context_files.map(file => file.path),
    ]),
  )
  let totalBytes = 0
  const sections: string[] = []
  const missing: string[] = []

  for (const filePath of paths) {
    const absolutePath = resolve(getCwd(), filePath)
    const state = readFileState.get(absolutePath)
    let currentTimestamp: number
    try {
      currentTimestamp = await getFileModificationTimeAsync(absolutePath)
    } catch (error) {
      if (isENOENT(error) && !state) {
        sections.push(`## ${filePath}\n\n[File does not exist yet]`)
        continue
      }
      missing.push(filePath)
      continue
    }
    if (
      !state ||
      state.isPartialView ||
      state.offset !== 1 ||
      state.limit !== undefined
    ) {
      missing.push(filePath)
      continue
    }
    if (currentTimestamp !== state.timestamp) {
      missing.push(filePath)
      continue
    }

    const bytes = Buffer.byteLength(state.content, 'utf8')
    totalBytes += bytes
    if (totalBytes > 400_000) {
      throw new Error(
        'Union handoff file context exceeds 400 KB. Narrow context_files or split the task before submitting the plan.',
      )
    }
    sections.push(`## ${filePath}\n\n${state.content}`)
  }

  if (missing.length > 0) {
    throw new Error(
      `Read every file referenced by the Union Plan Artifact in full immediately before submitting it. Missing or stale: ${missing.join(', ')}`,
    )
  }
  return sections.join('\n\n')
}

function getLastAssistantReport(messages: AssistantMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]!.message.content
    const report =
      typeof content === 'string'
        ? content
        : extractTextContent(content ?? [], '\n')
    if (report.trim()) return report.trim()
  }
  throw new Error('Union implementer completed without a final report.')
}

function createImplementerCanUseTool(canUseTool: CanUseToolFn): CanUseToolFn {
  return async (
    tool,
    input,
    context,
    assistantMessage,
    toolUseID,
    forceDecision,
  ) => {
    const permissionContext = context.getAppState().toolPermissionContext
    if (
      tool.isMcp === true ||
      !IMPLEMENTER_TOOL_NAMES.has(tool.name) ||
      getDenyRuleForTool(permissionContext, tool) !== null
    ) {
      return {
        behavior: 'deny',
        message: `Union implementer cannot use ${tool.name} in the current session. Complete the validated handoff with permitted implementation tools.`,
        decisionReason: {
          type: 'other',
          reason: 'union-implementer-tool-scope',
        },
      }
    }
    return canUseTool(
      tool,
      input,
      context,
      assistantMessage,
      toolUseID,
      forceDecision,
    )
  }
}

function createImplementerToolUseContext(
  toolUseContext: ToolUseContext,
): ToolUseContext {
  if (toolUseContext.options.isNonInteractiveSession !== true) {
    return toolUseContext
  }
  return {
    ...toolUseContext,
    requireCanUseTool: true,
    getAppState: () => {
      const state = toolUseContext.getAppState()
      if (state.toolPermissionContext.shouldAvoidPermissionPrompts) return state
      return {
        ...state,
        toolPermissionContext: {
          ...state.toolPermissionContext,
          shouldAvoidPermissionPrompts: true,
        },
      }
    },
  }
}

export async function runUnionImplementer({
  artifact,
  toolUseContext,
  canUseTool,
}: RunUnionImplementerParams): Promise<UnionImplementerResult> {
  const configuredModel = getUnionImplementerModel()
  const model = getAgentModel(
    configuredModel,
    toolUseContext.options.mainLoopModel,
    undefined,
    toolUseContext.getAppState().toolPermissionContext.mode,
    { ignoreGlobalSubagentModel: true },
  )
  const availableTools = getImplementerTools(
    toolUseContext.options.tools,
    toolUseContext,
  )
  const fileContext = await collectPlannerReadFileContext(
    artifact,
    toolUseContext.readFileState,
  )
  const agentDefinition: BuiltInAgentDefinition = {
    ...UNION_IMPLEMENTER_AGENT,
    ...(configuredModel ? { model: configuredModel } : {}),
  }
  const implementationContext = createImplementerToolUseContext(toolUseContext)
  if (
    !availableTools.some(tool => tool.name === FILE_READ_TOOL_NAME) ||
    !availableTools.some(
      tool =>
        tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME ||
        tool.name === NOTEBOOK_EDIT_TOOL_NAME,
    )
  ) {
    throw new Error(
      'Union implementer requires Read and at least one file editing tool in the current session.',
    )
  }

  const assistantMessages: AssistantMessage[] = []
  try {
    for await (const message of getRunUnionAgent()({
      agentDefinition,
      promptMessages: [
        createUserMessage({
          content: buildUnionImplementerPrompt(artifact, fileContext),
        }),
      ],
      toolUseContext: implementationContext,
      canUseTool: createImplementerCanUseTool(canUseTool),
      isAsync: false,
      canShowPermissionPrompts:
        implementationContext.options.isNonInteractiveSession !== true,
      requireCanUseTool: implementationContext.requireCanUseTool,
      ignoreGlobalSubagentModel: true,
      querySource: 'agent:builtin:union-implementer',
      availableTools,
      maxTurns: 40,
      description: artifact.title,
    })) {
      if (message.type === 'assistant') {
        assistantMessages.push(message as AssistantMessage)
      }
    }
  } catch (error) {
    if (isAbortError(error) || toolUseContext.abortController.signal.aborted) {
      throw error
    }
    const partial = assistantMessages.length
      ? `\n\nLast implementer output:\n${getLastAssistantReport(assistantMessages)}`
      : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Union implementer failed: ${message}${partial}`)
  }

  return {
    model,
    report: getLastAssistantReport(assistantMessages),
  }
}
