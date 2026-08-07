import mysql, {
  type Connection,
  type ConnectionOptions,
  type FieldPacket,
} from 'mysql2/promise'
import type {
  InlineReadonlyDatabaseConnection,
  ResolvedReadonlyDatabaseProfile,
} from './config.js'

export const DEFAULT_QUERY_MAX_ROWS = 200

const ALLOWED_PREFIXES = [
  'select ',
  'select\n',
  'select\t',
  'show ',
  'show\n',
  'show\t',
  'describe ',
  'describe\n',
  'describe\t',
  'desc ',
  'desc\n',
  'desc\t',
  'explain ',
  'explain\n',
  'explain\t',
] as const

const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /\binto\s+(?:out|dump)file\b/i,
  /\bfor\s+update\b/i,
  /\block\s+in\s+share\s+mode\b/i,
  /\bget_lock\s*\(/i,
  /\brelease_lock\s*\(/i,
  /\bsleep\s*\(/i,
  /\bbenchmark\s*\(/i,
  /\bload_file\s*\(/i,
]

export type ReadonlyQueryInput = {
  profile?: string
  connection?: InlineReadonlyDatabaseConnection
  sql: string
  params?: unknown[]
  max_rows?: number
}

export type ReadonlyQueryResult = {
  columns: string[]
  rows: unknown[][]
  row_count: number
  truncated: boolean
}

export function validateReadonlySql(rawSql: string): string {
  let sql = rawSql.trim()
  if (!sql) throw new Error('sql must not be empty')

  if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd()
  if (sql.includes(';')) {
    throw new Error('Only one SQL statement is allowed')
  }

  // Comments make keyword-level validation ambiguous. Reject them instead of
  // attempting to implement a partial MySQL lexer in the permission boundary.
  if (/(?:\/\*|\*\/|--|#)/.test(sql)) {
    throw new Error('SQL comments are not allowed')
  }

  const lower = sql.toLowerCase()
  const isBareSelect = lower === 'select'
  const isBareShow = lower === 'show'
  if (
    !isBareSelect &&
    !isBareShow &&
    !ALLOWED_PREFIXES.some(prefix => lower.startsWith(prefix))
  ) {
    throw new Error(
      'Only SELECT, SHOW, DESCRIBE, DESC, and EXPLAIN statements are allowed',
    )
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error(
        'The query contains a blocked locking, file, or resource operation',
      )
    }
  }

  if (
    /^explain\s+(?:analyze\s+)?(?:insert|update|delete|replace|call)\b/i.test(
      sql,
    )
  ) {
    throw new Error('EXPLAIN is limited to read-only statements')
  }

  return sql
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  return value
}

function buildResult(
  rows: unknown[],
  fields: FieldPacket[],
  maxRows: number,
  maxResultBytes: number,
): ReadonlyQueryResult {
  const normalizedRows: unknown[][] = []
  let truncated = rows.length > maxRows

  for (const row of rows.slice(0, maxRows)) {
    const normalized = Array.isArray(row)
      ? row.map(normalizeValue)
      : Object.values(row as Record<string, unknown>).map(normalizeValue)
    const candidate = [...normalizedRows, normalized]
    const candidateResult: ReadonlyQueryResult = {
      columns: fields.map(field => field.name),
      rows: candidate,
      row_count: candidate.length,
      truncated,
    }
    if (
      Buffer.byteLength(JSON.stringify(candidateResult), 'utf8') >
      maxResultBytes
    ) {
      truncated = true
      break
    }
    normalizedRows.push(normalized)
  }

  return {
    columns: fields.map(field => field.name),
    rows: normalizedRows,
    row_count: normalizedRows.length,
    truncated,
  }
}

export type ReadonlyQueryDependencies = {
  createConnection(
    options: ConnectionOptions,
  ): Promise<Pick<Connection, 'execute' | 'query' | 'rollback' | 'end'>>
}

const DEFAULT_DEPENDENCIES: ReadonlyQueryDependencies = {
  createConnection: options => mysql.createConnection(options),
}

export async function executeReadonlyQuery(
  profile: ResolvedReadonlyDatabaseProfile,
  input: Omit<ReadonlyQueryInput, 'profile' | 'connection'>,
  dependencies: ReadonlyQueryDependencies = DEFAULT_DEPENDENCIES,
): Promise<ReadonlyQueryResult> {
  const sql = validateReadonlySql(input.sql)
  const params = input.params ?? []
  if (!Array.isArray(params)) throw new Error('params must be an array')

  const requestedMaxRows = input.max_rows ?? DEFAULT_QUERY_MAX_ROWS
  if (!Number.isInteger(requestedMaxRows) || requestedMaxRows < 1) {
    throw new Error('max_rows must be a positive integer')
  }
  const maxRows = Math.min(requestedMaxRows, profile.maxRows)

  const connection = await dependencies.createConnection({
    host: profile.host,
    port: profile.port,
    user: profile.user,
    password: profile.password,
    database: profile.database,
    connectTimeout: profile.connectTimeoutMs,
    multipleStatements: false,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    rowsAsArray: true,
    ssl: profile.ssl ? {} : undefined,
  })

  try {
    await connection.query(
      `SET SESSION MAX_EXECUTION_TIME = ${profile.queryTimeoutMs}`,
    )
    await connection.query('START TRANSACTION READ ONLY')
    const [rows, fields] = await connection.execute({
      sql,
      values: params,
      rowsAsArray: true,
      timeout: profile.queryTimeoutMs,
    })
    if (!Array.isArray(rows) || !Array.isArray(fields)) {
      throw new Error('The database did not return a row set')
    }
    return buildResult(
      rows as unknown[],
      fields,
      maxRows,
      profile.maxResultBytes,
    )
  } finally {
    try {
      await connection.rollback()
    } finally {
      await connection.end()
    }
  }
}
