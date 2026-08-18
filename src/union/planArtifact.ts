import { isAbsolute, posix, win32 } from 'node:path'
import { z } from 'zod/v4'
import { UNION_LEVELS } from './types.js'

const relativeRepositoryPath = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const normalized = value.replaceAll('\\', '/')
    const hasControlCharacter = Array.from(value).some(character => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
    })
    if (
      value !== normalized ||
      value.trim() !== value ||
      hasControlCharacter ||
      /^[A-Za-z]:/.test(value) ||
      isAbsolute(value) ||
      win32.isAbsolute(value) ||
      normalized.startsWith('/') ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.split('/').includes('..') ||
      posix.normalize(normalized).startsWith('../') ||
      normalized === '.' ||
      normalized.endsWith('/') ||
      normalized.includes('//') ||
      posix.normalize(normalized) !== normalized
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'must be a normalized repository-relative file path without traversal',
      })
    }
  })

const acceptanceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('command'),
    run: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal('manual'),
    check: z.string().trim().min(1),
  }),
])

export const UnionPlanArtifactSchema = z.strictObject({
  union_level: z.enum(UNION_LEVELS),
  title: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  non_goals: z.array(z.string().trim().min(1)).default([]),
  files_to_touch: z.array(relativeRepositoryPath).min(1),
  core_files: z.array(relativeRepositoryPath).default([]),
  core_hunks: z
    .array(
      z.strictObject({
        file: relativeRepositoryPath,
        symbol: z.string().trim().min(1).optional(),
        note: z.string().trim().min(1).optional(),
      }),
    )
    .default([]),
  steps: z.array(z.string().trim().min(1)).min(1),
  invariants: z.array(z.string().trim().min(1)).default([]),
  acceptance: z.array(acceptanceSchema).min(1),
  risks: z.array(z.string().trim().min(1)).default([]),
  glue_tasks: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1),
        files: z.array(relativeRepositoryPath).min(1),
      }),
    )
    .default([]),
  context_files: z
    .array(
      z.strictObject({
        path: relativeRepositoryPath,
        reason: z.string().trim().min(1),
      }),
    )
    .default([]),
})

export type UnionPlanArtifact = z.infer<typeof UnionPlanArtifactSchema>

export function parseUnionPlanArtifact(input: unknown): UnionPlanArtifact {
  const artifact = UnionPlanArtifactSchema.parse(input)
  if (artifact.context_files.length > 0) return artifact
  return {
    ...artifact,
    context_files: Array.from(
      new Set([
        ...artifact.files_to_touch,
        ...artifact.core_files,
        ...artifact.core_hunks.map(hunk => hunk.file),
        ...artifact.glue_tasks.flatMap(task => task.files),
      ]),
      path => ({
        path,
        reason: 'Required implementation context',
      }),
    ),
  }
}
