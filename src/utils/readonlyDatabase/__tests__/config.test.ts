import { describe, expect, test } from 'bun:test'
import {
  hasReadonlyDatabaseProfiles,
  resolveReadonlyDatabaseProfile,
  resolveReadonlyDatabaseTarget,
} from '../config.js'

const settings = {
  readonlyDatabaseProfiles: {
    cgh: {
      driver: 'mysql' as const,
      host: '192.168.3.160',
      port: 3306,
      userEnv: 'CGH_DB_USER',
      passwordEnv: 'CGH_DB_PASSWORD',
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 10_000,
      maxRows: 500,
      maxResultBytes: 256_000,
      ssl: false,
    },
  },
}

describe('read-only database config', () => {
  test('enables the bundled MCP when a profile exists', () => {
    expect(hasReadonlyDatabaseProfiles(settings)).toBe(true)
    expect(hasReadonlyDatabaseProfiles({})).toBe(false)
  })

  test('resolves credentials only from named environment variables', () => {
    const profile = resolveReadonlyDatabaseProfile('cgh', settings, {
      CGH_DB_USER: 'readonly_user',
      CGH_DB_PASSWORD: 'secret',
    })
    expect(profile.user).toBe('readonly_user')
    expect(profile.password).toBe('secret')
  })

  test('fails closed when the password environment variable is missing', () => {
    expect(() =>
      resolveReadonlyDatabaseProfile('cgh', settings, {
        CGH_DB_USER: 'readonly_user',
      }),
    ).toThrow('CGH_DB_PASSWORD')
  })

  test('accepts a complete inline connection without settings or environment variables', () => {
    const target = resolveReadonlyDatabaseTarget(
      {
        connection: {
          host: '192.168.3.160',
          database: 'vncgh',
          user: 'root',
          password: 'request-supplied-secret',
        },
      },
      {},
      {},
    )

    expect(target).toMatchObject({
      name: 'inline',
      host: '192.168.3.160',
      port: 3306,
      database: 'vncgh',
      user: 'root',
      password: 'request-supplied-secret',
    })
  })

  test('requires exactly one connection source', () => {
    expect(() => resolveReadonlyDatabaseTarget({}, {}, {})).toThrow(
      'exactly one',
    )
    expect(() =>
      resolveReadonlyDatabaseTarget(
        {
          profile: 'cgh',
          connection: {
            host: 'localhost',
            user: 'root',
            password: 'secret',
          },
        },
        settings,
        {},
      ),
    ).toThrow('exactly one')
  })
})
