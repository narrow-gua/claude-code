import { describe, expect, test } from 'bun:test'
import type { ConnectionOptions, FieldPacket } from 'mysql2/promise'
import type { ResolvedReadonlyDatabaseProfile } from '../config.js'
import {
  executeReadonlyQuery,
  validateReadonlySql,
  type ReadonlyQueryDependencies,
} from '../query.js'

const profile: ResolvedReadonlyDatabaseProfile = {
  name: 'cgh',
  driver: 'mysql',
  host: '192.168.3.160',
  port: 3306,
  user: 'readonly_user',
  password: 'secret',
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 10_000,
  maxRows: 2,
  maxResultBytes: 256_000,
  ssl: false,
}

describe('validateReadonlySql', () => {
  test('allows one select with an optional trailing semicolon', () => {
    expect(validateReadonlySql(' SELECT 1; ')).toBe('SELECT 1')
  })

  test.each([
    "UPDATE material SET name = 'x'",
    'SELECT 1; DELETE FROM material',
    'SELECT * FROM material FOR UPDATE',
    "SELECT * FROM material INTO OUTFILE '/tmp/x'",
    'SELECT SLEEP(30)',
    "SELECT LOAD_FILE('/etc/passwd')",
    'SELECT 1 /* hidden */',
  ])('rejects unsafe query: %s', sql => {
    expect(() => validateReadonlySql(sql)).toThrow()
  })
})

describe('executeReadonlyQuery', () => {
  test('uses a read-only transaction, disables multi-statements, and truncates rows', async () => {
    const calls: string[] = []
    let connectionOptions: ConnectionOptions | undefined
    let rolledBack = false
    let ended = false
    const fields = [{ name: 'id' }, { name: 'name' }] as FieldPacket[]

    const dependencies: ReadonlyQueryDependencies = {
      async createConnection(options) {
        connectionOptions = options
        return {
          async query(sql: unknown) {
            calls.push(String(sql))
            return [[], []] as never
          },
          async execute(options: unknown) {
            calls.push((options as { sql: string }).sql)
            return [
              [
                [1, 'a'],
                [2, 'b'],
                [3, 'c'],
              ],
              fields,
            ] as never
          },
          async rollback() {
            rolledBack = true
          },
          async end() {
            ended = true
          },
        } as never
      },
    }

    const result = await executeReadonlyQuery(
      profile,
      { sql: 'SELECT id, name FROM material', max_rows: 10 },
      dependencies,
    )

    expect(connectionOptions?.multipleStatements).toBe(false)
    expect(calls).toEqual([
      'SET SESSION MAX_EXECUTION_TIME = 10000',
      'START TRANSACTION READ ONLY',
      'SELECT id, name FROM material',
    ])
    expect(result.rows).toEqual([
      [1, 'a'],
      [2, 'b'],
    ])
    expect(result.truncated).toBe(true)
    expect(rolledBack).toBe(true)
    expect(ended).toBe(true)
  })
})
