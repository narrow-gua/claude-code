import { afterEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { getFileModificationTime } from '../../utils/file.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { createAssistantMessage } from '../../utils/messages.js'
import type { UnionPlanArtifact } from '../planArtifact.js'
import { runUnionImplementer, setRunUnionAgentForTest } from '../implementer.js'

const FILE = 'src/union/types.ts'
const originalSubagentModel = process.env.CLAUDE_CODE_SUBAGENT_MODEL

function artifact(): UnionPlanArtifact {
  return {
    union_level: 'L1',
    title: 'Exercise implementer execution',
    goal: 'Use the standard agent runner',
    non_goals: [],
    files_to_touch: [FILE],
    core_files: [],
    core_hunks: [],
    steps: ['Implement the change'],
    invariants: ['Preserve normal behavior'],
    acceptance: [{ type: 'command', run: 'bun run typecheck' }],
    risks: [],
    glue_tasks: [],
    context_files: [{ path: FILE, reason: 'Implementation context' }],
  }
}

function context(): ToolUseContext {
  const absolutePath = resolve(getCwd(), FILE)
  const readFileState = createFileStateCacheWithSizeLimit(10)
  readFileState.set(absolutePath, {
    content: 'export type Marker = true\n',
    timestamp: getFileModificationTime(absolutePath),
    offset: 1,
    limit: undefined,
  })
  const primitive = (name: string) =>
    ({
      name,
      isEnabled: () => true,
      isMcp: false,
    }) as Tool
  return {
    options: {
      tools: [primitive('Read'), primitive('Write')],
      mainLoopModel: 'parent-model',
    },
    readFileState,
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: true,
      },
    }),
  } as unknown as ToolUseContext
}

afterEach(() => {
  setRunUnionAgentForTest(undefined)
  if (originalSubagentModel === undefined) {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  } else {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = originalSubagentModel
  }
})

describe('runUnionImplementer', () => {
  test('uses the built-in agent prompt path without a Planner override', async () => {
    let observed:
      | {
          agentType: string
          prompt: string
          overridePresent: boolean
          ignoresGlobalSubagentModel: boolean | undefined
          tools: string[]
        }
      | undefined

    setRunUnionAgentForTest(async function* (params) {
      observed = {
        agentType: params.agentDefinition.agentType,
        prompt: params.agentDefinition.getSystemPrompt({
          toolUseContext: params.toolUseContext,
        }),
        overridePresent: params.override !== undefined,
        ignoresGlobalSubagentModel: params.ignoreGlobalSubagentModel,
        tools: params.availableTools.map(tool => tool.name),
      }
      yield createAssistantMessage({ content: 'implementation report' })
    } as Parameters<typeof setRunUnionAgentForTest>[0])

    const result = await runUnionImplementer({
      artifact: artifact(),
      toolUseContext: context(),
      canUseTool: async () => ({ behavior: 'allow' }),
    })

    expect(result).toEqual({
      model: 'parent-model',
      report: 'implementation report',
    })
    expect(observed?.agentType).toBe('union-implementer')
    expect(observed?.prompt).toContain('Union Mode — Implementer')
    expect(observed?.prompt).not.toContain('Planner')
    expect(observed?.overridePresent).toBe(false)
    expect(observed?.ignoresGlobalSubagentModel).toBe(true)
    expect(observed?.tools).toContain('Read')
    expect(observed?.tools).toContain('Write')
  })

  test('preserves the parent bypassPermissions mode', async () => {
    let observedMode: string | undefined
    const toolUseContext = context()
    toolUseContext.getAppState = () =>
      ({
        toolPermissionContext: {
          mode: 'bypassPermissions',
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: true,
        },
      }) as ReturnType<ToolUseContext['getAppState']>

    setRunUnionAgentForTest(async function* (params) {
      observedMode =
        params.toolUseContext.getAppState().toolPermissionContext.mode
      yield createAssistantMessage({ content: 'implementation report' })
    } as Parameters<typeof setRunUnionAgentForTest>[0])

    await runUnionImplementer({
      artifact: artifact(),
      toolUseContext,
      canUseTool: async () => ({ behavior: 'allow' }),
    })

    expect(observedMode).toBe('bypassPermissions')
  })

  test('does not let the global subagent model override Union inheritance', async () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    setRunUnionAgentForTest(async function* () {
      yield createAssistantMessage({ content: 'implementation report' })
    } as Parameters<typeof setRunUnionAgentForTest>[0])

    const result = await runUnionImplementer({
      artifact: artifact(),
      toolUseContext: context(),
      canUseTool: async () => ({ behavior: 'allow' }),
    })

    expect(result.model).toBe('parent-model')
  })

  test('fails closed instead of opening permission UI in non-interactive sessions', async () => {
    let observed:
      | {
          requireCanUseTool: boolean | undefined
          forwardedRequirement: boolean | undefined
          canShowPermissionPrompts: boolean | undefined
          avoidsPrompts: boolean
        }
      | undefined
    const toolUseContext = context()
    toolUseContext.options.isNonInteractiveSession = true

    setRunUnionAgentForTest(async function* (params) {
      observed = {
        requireCanUseTool: params.toolUseContext.requireCanUseTool,
        forwardedRequirement: params.requireCanUseTool,
        canShowPermissionPrompts: params.canShowPermissionPrompts,
        avoidsPrompts:
          params.toolUseContext.getAppState().toolPermissionContext
            .shouldAvoidPermissionPrompts === true,
      }
      yield createAssistantMessage({ content: 'implementation report' })
    } as Parameters<typeof setRunUnionAgentForTest>[0])

    await runUnionImplementer({
      artifact: artifact(),
      toolUseContext,
      canUseTool: async () => ({ behavior: 'allow' }),
    })

    expect(observed).toEqual({
      requireCanUseTool: true,
      forwardedRequirement: true,
      canShowPermissionPrompts: false,
      avoidsPrompts: true,
    })
  })
})
