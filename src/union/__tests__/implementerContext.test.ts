import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Tool, ToolPermissionContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { getFileModificationTime } from '../../utils/file.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import type { UnionPlanArtifact } from '../planArtifact.js'
import {
  buildUnionImplementerPrompt,
  collectPlannerReadFileContext,
  isUnionImplementerToolAllowed,
} from '../implementer.js'

const EXISTING_FILE = 'src/union/types.ts'

function artifact(): UnionPlanArtifact {
  return {
    union_level: 'L1',
    title: 'Implement Union context',
    goal: 'Pass concrete context to the implementer',
    non_goals: [],
    files_to_touch: [EXISTING_FILE],
    core_files: [],
    core_hunks: [],
    steps: ['Make the requested change'],
    invariants: ['Normal mode remains unchanged'],
    acceptance: [{ type: 'command', run: 'bun run typecheck' }],
    risks: [],
    glue_tasks: [],
    context_files: [
      { path: EXISTING_FILE, reason: 'Required implementation context' },
    ],
  }
}

describe('Union implementer context', () => {
  test('keeps primitive recovery inside the existing deny boundary', () => {
    const context: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: { cliArg: ['Write'] },
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    }
    const tool = {
      name: 'Write',
      isEnabled: () => true,
      isMcp: false,
    } as Pick<Tool, 'name' | 'isEnabled' | 'isMcp'>

    expect(isUnionImplementerToolAllowed(tool, context)).toBe(false)
    expect(
      isUnionImplementerToolAllowed({ ...tool, name: 'Read' }, context),
    ).toBe(true)
    expect(
      isUnionImplementerToolAllowed(
        { ...tool, name: 'Read', isMcp: true },
        context,
      ),
    ).toBe(false)
  })

  test('rejects disabled tools before they enter the implementer pool', () => {
    const context: ToolPermissionContext = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: true,
    }

    expect(
      isUnionImplementerToolAllowed(
        { name: 'Read', isEnabled: () => false, isMcp: false },
        context,
      ),
    ).toBe(false)
  })

  test('includes Planner-read current file content in the handoff prompt', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    const absolutePath = resolve(getCwd(), EXISTING_FILE)
    const content = 'export const marker = true\n'
    cache.set(absolutePath, {
      content,
      timestamp: getFileModificationTime(absolutePath),
      offset: 1,
      limit: undefined,
    })

    const context = await collectPlannerReadFileContext(artifact(), cache)
    const prompt = buildUnionImplementerPrompt(artifact(), context)
    expect(prompt).toContain(`## ${EXISTING_FILE}`)
    expect(prompt).toContain(content)
    expect(prompt).toContain('Re-read each existing file before editing')
  })

  test('rejects missing, partial, or stale Planner context', async () => {
    const cache = createFileStateCacheWithSizeLimit(10)
    await expect(
      collectPlannerReadFileContext(artifact(), cache),
    ).rejects.toThrow(EXISTING_FILE)

    cache.set(resolve(getCwd(), EXISTING_FILE), {
      content: 'partial',
      timestamp: getFileModificationTime(resolve(getCwd(), EXISTING_FILE)),
      offset: 1,
      limit: 10,
    })
    await expect(
      collectPlannerReadFileContext(artifact(), cache),
    ).rejects.toThrow('Missing or stale')
  })

  test('requires reads for every core and glue file reference', async () => {
    const extraFile = 'src/union/prompt.ts'
    const referencedArtifact = {
      ...artifact(),
      core_files: [extraFile],
      core_hunks: [{ file: extraFile, symbol: 'getUnionPlannerPrompt' }],
      glue_tasks: [{ description: 'Wire the prompt', files: [extraFile] }],
    }

    await expect(
      collectPlannerReadFileContext(
        referencedArtifact,
        createFileStateCacheWithSizeLimit(10),
      ),
    ).rejects.toThrow(extraFile)
  })

  test('marks a planned new file without requiring a prior Read cache entry', async () => {
    const newFile = `src/union/__tests__/${randomUUID()}.ts`
    const newFileArtifact = {
      ...artifact(),
      files_to_touch: [newFile],
      context_files: [{ path: newFile, reason: 'New implementation file' }],
    }
    const context = await collectPlannerReadFileContext(
      newFileArtifact,
      createFileStateCacheWithSizeLimit(10),
    )

    expect(context).toContain(`## ${newFile}`)
    expect(context).toContain('[File does not exist yet]')
  })
})
