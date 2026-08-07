import { describe, expect, test } from 'bun:test'
import { setupReadonlyDatabaseMCP } from '../setup.js'

describe('setupReadonlyDatabaseMCP', () => {
  test('is available without preconfigured profiles', () => {
    expect(setupReadonlyDatabaseMCP()).not.toBeNull()
  })

  test('registers and precisely allows only the bundled query tool', () => {
    const result = setupReadonlyDatabaseMCP()

    expect(result.allowedTools).toEqual(['mcp__readonly-database__query'])
    expect(result.mcpConfig['readonly-database']?.scope).toBe('dynamic')
  })
})
