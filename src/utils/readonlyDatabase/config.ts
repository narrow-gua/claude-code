import type { SettingsJson } from '../settings/types.js'
import { getInitialSettings } from '../settings/settings.js'

export type ReadonlyDatabaseProfile = NonNullable<
  SettingsJson['readonlyDatabaseProfiles']
>[string]

export type ResolvedReadonlyDatabaseProfile = {
  name: string
  driver: 'mysql'
  host: string
  port: number
  database?: string
  user: string
  password: string
  connectTimeoutMs: number
  queryTimeoutMs: number
  maxRows: number
  maxResultBytes: number
  ssl: boolean
}

export type InlineReadonlyDatabaseConnection = {
  host: string
  port?: number
  database?: string
  user: string
  password: string
  ssl?: boolean
}

export type ReadonlyDatabaseTarget = {
  profile?: string
  connection?: InlineReadonlyDatabaseConnection
}

const INLINE_CONNECTION_DEFAULTS = {
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 10_000,
  maxRows: 500,
  maxResultBytes: 256_000,
} as const

export function getReadonlyDatabaseProfiles(
  settings: Pick<
    SettingsJson,
    'readonlyDatabaseProfiles'
  > = getInitialSettings(),
): Record<string, ReadonlyDatabaseProfile> {
  return settings.readonlyDatabaseProfiles ?? {}
}

export function hasReadonlyDatabaseProfiles(
  settings: Pick<
    SettingsJson,
    'readonlyDatabaseProfiles'
  > = getInitialSettings(),
): boolean {
  return Object.keys(getReadonlyDatabaseProfiles(settings)).length > 0
}

export function resolveReadonlyDatabaseProfile(
  name: string,
  settings: Pick<
    SettingsJson,
    'readonlyDatabaseProfiles'
  > = getInitialSettings(),
  env: Record<string, string | undefined> = process.env,
): ResolvedReadonlyDatabaseProfile {
  const profile = getReadonlyDatabaseProfiles(settings)[name]
  if (!profile) {
    throw new Error(`Unknown read-only database profile: ${name}`)
  }

  const user =
    profile.user ?? (profile.userEnv ? env[profile.userEnv] : undefined)
  if (!user) {
    throw new Error(
      `Read-only database profile '${name}' is missing user environment variable '${profile.userEnv}'`,
    )
  }

  const password = env[profile.passwordEnv]
  if (password === undefined) {
    throw new Error(
      `Read-only database profile '${name}' is missing password environment variable '${profile.passwordEnv}'`,
    )
  }

  return { ...profile, name, user, password }
}

export function resolveReadonlyDatabaseTarget(
  target: ReadonlyDatabaseTarget,
  settings: Pick<
    SettingsJson,
    'readonlyDatabaseProfiles'
  > = getInitialSettings(),
  env: Record<string, string | undefined> = process.env,
): ResolvedReadonlyDatabaseProfile {
  const hasProfile = typeof target.profile === 'string'
  const hasConnection = target.connection !== undefined
  if (hasProfile === hasConnection) {
    throw new Error('Provide exactly one of profile or connection')
  }

  if (target.profile) {
    return resolveReadonlyDatabaseProfile(target.profile, settings, env)
  }

  const connection = target.connection
  if (!connection) throw new Error('connection is required')
  if (!connection.host.trim())
    throw new Error('connection.host must not be empty')
  if (!connection.user.trim())
    throw new Error('connection.user must not be empty')
  const port = connection.port ?? 3306
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('connection.port must be an integer from 1 to 65535')
  }

  return {
    name: 'inline',
    driver: 'mysql',
    host: connection.host,
    port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ?? false,
    ...INLINE_CONNECTION_DEFAULTS,
  }
}
