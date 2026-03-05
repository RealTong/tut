export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike
  run: () => Promise<{ meta?: { changes?: number } }>
  all: <T = unknown>() => Promise<{ results?: T[] }>
  first: <T = unknown>(columnName?: string) => Promise<T | null>
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike
  batch?: (statements: D1PreparedStatementLike[]) => Promise<Array<{ meta?: { changes?: number } }>>
}

export interface UsageEventRecord {
  eventId: string | null
  model: string
  provider: string
  source: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  occurredAt: string
  metadata: string | null
}

export interface UsageFilters {
  whereClause: string
  bindings: unknown[]
  errors: string[]
}

const MAX_TEXT_LENGTH = 256

const TOKEN_ALIASES = {
  input: ['input', 'inputTokens', 'input_tokens'],
  output: ['output', 'outputTokens', 'output_tokens'],
  cacheRead: [
    'cacheRead',
    'cache_read',
    'cacheReadTokens',
    'cache_read_tokens',
    'cache_read_input_tokens',
    'cached',
    'input_cache_read',
  ],
  cacheWrite: [
    'cacheWrite',
    'cache_write',
    'cacheWriteTokens',
    'cache_write_tokens',
    'cacheCreationTokens',
    'input_cache_creation',
  ],
} as const

export function extractIncomingEvents(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body
  }

  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>

    if (Array.isArray(obj.events)) {
      return obj.events
    }

    if (Array.isArray(obj.data)) {
      return obj.data
    }

    return [obj]
  }

  return []
}

export function normalizeUsageEvent(raw: unknown, index: number): { event?: UsageEventRecord; errors: string[] } {
  const errors: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { errors: [`events[${index}] must be a JSON object`] }
  }

  const payload = raw as Record<string, unknown>

  const model = getTextField(payload, ['model', 'modelId'], 'model', index, errors)
  const provider = getTextField(payload, ['provider', 'providerId'], 'provider', index, errors)
  const source = getTextField(payload, ['source', 'client'], 'source', index, errors)

  const inputTokens = getTokenField(payload, 'input', index, errors)
  const outputTokens = getTokenField(payload, 'output', index, errors)
  const cacheReadTokens = getTokenField(payload, 'cacheRead', index, errors)
  const cacheWriteTokens = getTokenField(payload, 'cacheWrite', index, errors)

  const occurredAt = normalizeTimestamp(
    getFirstDefined(payload, ['occurredAt', 'timestamp', 'time', 'createdAt', 'date', 'timestampMs']),
    index,
    errors,
  )

  const eventIdRaw = getFirstDefined(payload, ['eventId', 'event_id', 'id'])
  const eventId = normalizeOptionalText(eventIdRaw, index, 'eventId', errors)

  const metadata = normalizeMetadata(payload.metadata, index, errors)

  if (errors.length > 0 || !model || !provider || !source || !occurredAt) {
    return { errors }
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens

  return {
    event: {
      eventId,
      model,
      provider,
      source,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      occurredAt,
      metadata,
    },
    errors,
  }
}

function getTextField(
  payload: Record<string, unknown>,
  aliases: string[],
  fieldName: string,
  index: number,
  errors: string[],
): string | null {
  const value = getFirstDefined(payload, aliases)

  if (typeof value !== 'string') {
    errors.push(`events[${index}].${fieldName} is required and must be a string`)
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    errors.push(`events[${index}].${fieldName} cannot be empty`)
    return null
  }

  if (trimmed.length > MAX_TEXT_LENGTH) {
    errors.push(`events[${index}].${fieldName} exceeds ${MAX_TEXT_LENGTH} characters`)
    return null
  }

  return trimmed
}

function getTokenField(
  payload: Record<string, unknown>,
  tokenType: keyof typeof TOKEN_ALIASES,
  index: number,
  errors: string[],
): number {
  const topLevel = getFirstDefined(payload, TOKEN_ALIASES[tokenType])

  const tokensField = payload.tokens
  let nested: unknown

  if (tokensField && typeof tokensField === 'object') {
    const tokenObj = tokensField as Record<string, unknown>
    nested = getFirstDefined(tokenObj, TOKEN_ALIASES[tokenType])

    if (nested === undefined && tokenType === 'cacheRead') {
      const cache = tokenObj.cache
      if (cache && typeof cache === 'object') {
        nested = (cache as Record<string, unknown>).read
      }
    }

    if (nested === undefined && tokenType === 'cacheWrite') {
      const cache = tokenObj.cache
      if (cache && typeof cache === 'object') {
        nested = (cache as Record<string, unknown>).write
      }
    }
  }

  const resolved = topLevel ?? nested ?? 0
  const numberValue = normalizeNonNegativeInt(resolved)

  if (numberValue === null) {
    errors.push(`events[${index}].${tokenType} must be a non-negative integer`)
    return 0
  }

  return numberValue
}

function normalizeTimestamp(value: unknown, index: number, errors: string[]): string | null {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString()
  }

  const timestamp = parseTimestamp(value)
  if (!timestamp) {
    errors.push(`events[${index}].occurredAt/timestamp is invalid`)
    return null
  }

  return timestamp
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(millis)
    if (Number.isNaN(date.valueOf())) return null
    return date.toISOString()
  }

  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return null

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw)
      if (!Number.isFinite(numeric)) return null
      return parseTimestamp(numeric)
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${raw}T00:00:00.000Z`
    }

    const date = new Date(raw)
    if (Number.isNaN(date.valueOf())) return null
    return date.toISOString()
  }

  return null
}

function normalizeOptionalText(
  value: unknown,
  index: number,
  fieldName: string,
  errors: string[],
): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    errors.push(`events[${index}].${fieldName} must be a string if provided`)
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length > MAX_TEXT_LENGTH) {
    errors.push(`events[${index}].${fieldName} exceeds ${MAX_TEXT_LENGTH} characters`)
    return null
  }

  return trimmed
}

function normalizeMetadata(value: unknown, index: number, errors: string[]): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    errors.push(`events[${index}].metadata must be JSON-serializable`)
    return null
  }
}

function normalizeNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      return null
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
      return null
    }

    return numeric
  }

  return null
}

function getFirstDefined(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) {
      return payload[key]
    }
  }
  return undefined
}

export async function insertUsageEvents(db: D1DatabaseLike, events: UsageEventRecord[]) {
  if (events.length === 0) {
    return { inserted: 0, duplicates: 0 }
  }

  const insertSQL = `
    INSERT OR IGNORE INTO usage_events (
      event_id,
      model,
      provider,
      source,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      total_tokens,
      occurred_at,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `

  const statements = events.map((event) =>
    db
      .prepare(insertSQL)
      .bind(
        event.eventId,
        event.model,
        event.provider,
        event.source,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheWriteTokens,
        event.totalTokens,
        event.occurredAt,
        event.metadata,
      ),
  )

  let inserted = 0

  if (typeof db.batch === 'function') {
    const results = await db.batch(statements)
    inserted = results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0)
  } else {
    for (const statement of statements) {
      const result = await statement.run()
      inserted += result.meta?.changes ?? 0
    }
  }

  return {
    inserted,
    duplicates: events.length - inserted,
  }
}

export function buildUsageFilters(params: URLSearchParams): UsageFilters {
  const errors: string[] = []
  const conditions: string[] = []
  const bindings: unknown[] = []

  const models = readListParam(params, ['model', 'models'])
  const providers = readListParam(params, ['provider', 'providers'])
  const sources = readListParam(params, ['source', 'sources', 'client', 'clients'])

  pushInCondition('model', models, conditions, bindings)
  pushInCondition('provider', providers, conditions, bindings)
  pushInCondition('source', sources, conditions, bindings)

  const fromRaw = params.get('from') ?? params.get('start')
  if (fromRaw) {
    const from = parseTimeBound(fromRaw, 'start')
    if (!from) {
      errors.push('Query param "from" is invalid. Use ISO datetime or YYYY-MM-DD.')
    } else {
      conditions.push('occurred_at >= ?')
      bindings.push(from)
    }
  }

  const toRaw = params.get('to') ?? params.get('end')
  if (toRaw) {
    const to = parseTimeBound(toRaw, 'end')
    if (!to) {
      errors.push('Query param "to" is invalid. Use ISO datetime or YYYY-MM-DD.')
    } else {
      conditions.push('occurred_at <= ?')
      bindings.push(to)
    }
  }

  const eventIds = readListParam(params, ['eventId', 'event_id'])
  if (eventIds.length > 0) {
    pushInCondition('event_id', eventIds, conditions, bindings)
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    bindings,
    errors,
  }
}

function readListParam(params: URLSearchParams, keys: string[]): string[] {
  const values: string[] = []

  for (const key of keys) {
    const all = params.getAll(key)
    for (const part of all) {
      for (const item of part.split(',')) {
        const trimmed = item.trim()
        if (trimmed) {
          values.push(trimmed)
        }
      }
    }
  }

  return [...new Set(values)]
}

function pushInCondition(column: string, values: string[], conditions: string[], bindings: unknown[]) {
  if (values.length === 0) return

  const placeholders = values.map(() => '?').join(', ')
  conditions.push(`${column} IN (${placeholders})`)
  bindings.push(...values)
}

function parseTimeBound(value: string, mode: 'start' | 'end'): string | null {
  const raw = value.trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return mode === 'start' ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`
  }

  const date = new Date(raw)
  if (Number.isNaN(date.valueOf())) {
    return null
  }

  return date.toISOString()
}

export function readClampedIntParam(
  params: URLSearchParams,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = params.get(key)
  if (!raw) return defaultValue

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return defaultValue
  }

  return Math.min(max, Math.max(min, parsed))
}

export function readSortOrder(params: URLSearchParams): 'ASC' | 'DESC' {
  return params.get('order')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
}

export function safeJsonParse(value: string | null): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
