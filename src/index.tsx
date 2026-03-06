import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DashboardPage, loadDashboardData } from './dashboard'
import { normalizeDashboardTheme, resolveDashboardLocale } from './dashboard-i18n'
import { renderer } from './renderer'
import {
  buildUsageFilters,
  extractIncomingEvents,
  insertUsageEvents,
  normalizeUsageEvent,
  readClampedIntParam,
  readSortOrder,
  safeJsonParse,
  type D1DatabaseLike,
} from './usage'

interface TutBindings {
  DB?: D1DatabaseLike
  INGEST_API_KEY?: string
}

type AppEnv = {
  Bindings: TutBindings
}

type UsageRow = {
  id: number
  event_id: string | null
  model: string
  provider: string
  source: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  occurred_at: string
  created_at: string
  metadata: string | null
}

type SummaryRow = {
  event_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  first_event_at: string | null
  last_event_at: string | null
}

type BreakdownRow = {
  source?: string
  provider?: string
  model?: string
  date?: string
  event_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
}

const app = new Hono<AppEnv>()

app.use('/api/*', cors())
app.use(renderer)

app.get('/health', (c) => {
  return c.json({
    ok: true,
    service: 'tut',
    auth: {
      ingestConfigured: Boolean(c.env.INGEST_API_KEY),
    },
  })
})

app.get('/', async (c) => {
  const url = new URL(c.req.url)
  const locale = resolveDashboardLocale(url.searchParams.get('lang'), c.req.header('Accept-Language'))
  const theme = normalizeDashboardTheme(url.searchParams.get('theme'))
  const data = await loadDashboardData(c.env.DB, locale)
  return c.render(<DashboardPage authEnabled={Boolean(c.env.INGEST_API_KEY)} data={data} locale={locale} theme={theme} />)
})

app.post('/api/v1/usage', async (c) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 binding "DB" is not configured.' }, 500)
  }

  const authError = validateIngestAuth(c.req.raw, c.env.INGEST_API_KEY)
  if (authError) {
    return c.json(authError.body, authError.status)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }

  const incoming = extractIncomingEvents(body)
  if (incoming.length === 0) {
    return c.json({ error: 'No events found. Expected object, array, {events: []}, or {data: []}.' }, 400)
  }

  if (incoming.length > 1000) {
    return c.json({ error: 'Too many events. Maximum 1000 per request.' }, 400)
  }

  const errors: string[] = []
  const normalized = incoming
    .map((event, index) => {
      const result = normalizeUsageEvent(event, index)
      errors.push(...result.errors)
      return result.event
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event))

  if (errors.length > 0) {
    return c.json({ error: 'Validation failed.', details: errors }, 400)
  }

  const { inserted, duplicates } = await insertUsageEvents(db, normalized)

  return c.json({
    ok: true,
    received: incoming.length,
    inserted,
    duplicates,
  })
})

app.get('/api/v1/usage', async (c) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 binding "DB" is not configured.' }, 500)
  }

  const query = new URL(c.req.url).searchParams
  const filters = buildUsageFilters(query)
  if (filters.errors.length > 0) {
    return c.json({ error: 'Invalid query params.', details: filters.errors }, 400)
  }

  const limit = readClampedIntParam(query, 'limit', 50, 1, 200)
  const offset = readClampedIntParam(query, 'offset', 0, 0, 100_000)
  const order = readSortOrder(query)

  const sortBy = query.get('sortBy') ?? 'occurredAt'
  const sortColumn =
    sortBy === 'total'
      ? 'total_tokens'
      : sortBy === 'input'
        ? 'input_tokens'
        : sortBy === 'output'
          ? 'output_tokens'
          : sortBy === 'cacheRead'
            ? 'cache_read_tokens'
            : sortBy === 'cacheWrite'
              ? 'cache_write_tokens'
              : sortBy === 'createdAt'
                ? 'created_at'
                : 'occurred_at'

  const listSql = `
    SELECT
      id,
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
      created_at,
      metadata
    FROM usage_events
    ${filters.whereClause}
    ORDER BY ${sortColumn} ${order}, id ${order}
    LIMIT ? OFFSET ?
  `

  const countSql = `
    SELECT COUNT(*) AS count
    FROM usage_events
    ${filters.whereClause}
  `

  const [listResult, countResult] = await Promise.all([
    db.prepare(listSql).bind(...filters.bindings, limit, offset).all<UsageRow>(),
    db.prepare(countSql).bind(...filters.bindings).first<{ count: number }>(),
  ])

  const rows = listResult.results ?? []
  const total = Number(countResult?.count ?? 0)

  return c.json({
    items: rows.map((row) => ({
      id: Number(row.id),
      eventId: row.event_id,
      model: row.model,
      provider: row.provider,
      source: row.source,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      tokens: {
        input: Number(row.input_tokens ?? 0),
        output: Number(row.output_tokens ?? 0),
        cacheRead: Number(row.cache_read_tokens ?? 0),
        cacheWrite: Number(row.cache_write_tokens ?? 0),
        total: Number(row.total_tokens ?? 0),
      },
      metadata: safeJsonParse(row.metadata),
    })),
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + rows.length < total,
    },
  })
})

app.get('/api/v1/usage/summary', async (c) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 binding "DB" is not configured.' }, 500)
  }

  const query = new URL(c.req.url).searchParams
  const filters = buildUsageFilters(query)
  if (filters.errors.length > 0) {
    return c.json({ error: 'Invalid query params.', details: filters.errors }, 400)
  }

  const summarySql = `
    SELECT
      COUNT(*) AS event_count,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      MIN(occurred_at) AS first_event_at,
      MAX(occurred_at) AS last_event_at
    FROM usage_events
    ${filters.whereClause}
  `

  const row = await db.prepare(summarySql).bind(...filters.bindings).first<SummaryRow>()

  return c.json({
    eventCount: Number(row?.event_count ?? 0),
    tokens: {
      input: Number(row?.input_tokens ?? 0),
      output: Number(row?.output_tokens ?? 0),
      cacheRead: Number(row?.cache_read_tokens ?? 0),
      cacheWrite: Number(row?.cache_write_tokens ?? 0),
      total: Number(row?.total_tokens ?? 0),
    },
    range: {
      from: row?.first_event_at ?? null,
      to: row?.last_event_at ?? null,
    },
  })
})

app.get('/api/v1/usage/breakdown', async (c) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 binding "DB" is not configured.' }, 500)
  }

  const query = new URL(c.req.url).searchParams
  const filters = buildUsageFilters(query)
  if (filters.errors.length > 0) {
    return c.json({ error: 'Invalid query params.', details: filters.errors }, 400)
  }

  const byRaw = query.get('by') ?? 'source,provider,model'
  const dimensions = byRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => ['source', 'provider', 'model', 'date'].includes(value))

  if (dimensions.length === 0) {
    return c.json({ error: 'Invalid "by" param. Use source,provider,model,date.' }, 400)
  }

  const uniqueDimensions = [...new Set(dimensions)]

  const dimensionSelectMap: Record<string, string> = {
    source: 'source AS source',
    provider: 'provider AS provider',
    model: 'model AS model',
    date: "substr(occurred_at, 1, 10) AS date",
  }

  const dimensionGroupMap: Record<string, string> = {
    source: 'source',
    provider: 'provider',
    model: 'model',
    date: 'substr(occurred_at, 1, 10)',
  }

  const selectDimensions = uniqueDimensions.map((dimension) => dimensionSelectMap[dimension])
  const groupDimensions = uniqueDimensions.map((dimension) => dimensionGroupMap[dimension])

  const limit = readClampedIntParam(query, 'limit', 100, 1, 500)
  const offset = readClampedIntParam(query, 'offset', 0, 0, 100_000)
  const order = readSortOrder(query)

  const sortBy = query.get('sortBy') ?? 'tokens'
  const sortMap: Record<string, string> = {
    tokens: 'total_tokens',
    events: 'event_count',
    input: 'input_tokens',
    output: 'output_tokens',
    cacheRead: 'cache_read_tokens',
    cacheWrite: 'cache_write_tokens',
    source: uniqueDimensions.includes('source') ? 'source' : 'total_tokens',
    provider: uniqueDimensions.includes('provider') ? 'provider' : 'total_tokens',
    model: uniqueDimensions.includes('model') ? 'model' : 'total_tokens',
    date: uniqueDimensions.includes('date') ? 'date' : 'total_tokens',
  }
  const sortColumn = sortMap[sortBy] ?? 'total_tokens'

  const breakdownSql = `
    SELECT
      ${selectDimensions.join(', ')},
      COUNT(*) AS event_count,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    ${filters.whereClause}
    GROUP BY ${groupDimensions.join(', ')}
    ORDER BY ${sortColumn} ${order}
    LIMIT ? OFFSET ?
  `

  const breakdownCountSql = `
    SELECT COUNT(*) AS count
    FROM (
      SELECT 1
      FROM usage_events
      ${filters.whereClause}
      GROUP BY ${groupDimensions.join(', ')}
    ) grouped
  `

  const [listResult, countResult] = await Promise.all([
    db.prepare(breakdownSql).bind(...filters.bindings, limit, offset).all<BreakdownRow>(),
    db.prepare(breakdownCountSql).bind(...filters.bindings).first<{ count: number }>(),
  ])

  const rows = listResult.results ?? []
  const total = Number(countResult?.count ?? 0)

  return c.json({
    by: uniqueDimensions,
    items: rows.map((row) => ({
      dimensions: {
        source: row.source ?? null,
        provider: row.provider ?? null,
        model: row.model ?? null,
        date: row.date ?? null,
      },
      metrics: {
        events: Number(row.event_count ?? 0),
        tokens: {
          input: Number(row.input_tokens ?? 0),
          output: Number(row.output_tokens ?? 0),
          cacheRead: Number(row.cache_read_tokens ?? 0),
          cacheWrite: Number(row.cache_write_tokens ?? 0),
          total: Number(row.total_tokens ?? 0),
        },
      },
    })),
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + rows.length < total,
    },
  })
})

app.get('/api/v1/usage/dimensions', async (c) => {
  const db = c.env.DB
  if (!db) {
    return c.json({ error: 'D1 binding "DB" is not configured.' }, 500)
  }

  const query = new URL(c.req.url).searchParams
  const filters = buildUsageFilters(query)
  if (filters.errors.length > 0) {
    return c.json({ error: 'Invalid query params.', details: filters.errors }, 400)
  }

  const buildDimensionSql = (column: 'source' | 'provider' | 'model') => `
    SELECT
      ${column} AS value,
      COUNT(*) AS event_count,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    ${filters.whereClause}
    GROUP BY ${column}
    ORDER BY total_tokens DESC, event_count DESC, value ASC
    LIMIT 200
  `

  const [sources, providers, models] = await Promise.all([
    db.prepare(buildDimensionSql('source')).bind(...filters.bindings).all<{ value: string; event_count: number; total_tokens: number }>(),
    db.prepare(buildDimensionSql('provider')).bind(...filters.bindings).all<{ value: string; event_count: number; total_tokens: number }>(),
    db.prepare(buildDimensionSql('model')).bind(...filters.bindings).all<{ value: string; event_count: number; total_tokens: number }>(),
  ])

  const mapItems = (items: Array<{ value: string; event_count: number; total_tokens: number }> | undefined) =>
    (items ?? []).map((item) => ({
      value: item.value,
      eventCount: Number(item.event_count ?? 0),
      totalTokens: Number(item.total_tokens ?? 0),
    }))

  return c.json({
    sources: mapItems(sources.results),
    providers: mapItems(providers.results),
    models: mapItems(models.results),
  })
})

function validateIngestAuth(request: Request, expectedApiKey?: string) {
  if (!expectedApiKey) {
    return {
      status: 503 as const,
      body: { error: 'Ingest auth is not configured. Set the INGEST_API_KEY Worker secret.' },
    }
  }

  const providedApiKey = extractProvidedApiKey(request)
  if (!providedApiKey || providedApiKey !== expectedApiKey) {
    return {
      status: 401 as const,
      body: { error: 'Unauthorized. Provide a valid Bearer token or x-api-key.' },
    }
  }

  return null
}

function extractProvidedApiKey(request: Request): string | null {
  const bearerHeader = request.headers.get('authorization')
  if (bearerHeader?.startsWith('Bearer ')) {
    const token = bearerHeader.slice(7).trim()
    return token || null
  }

  const apiKeyHeader = request.headers.get('x-api-key')?.trim()
  return apiKeyHeader || null
}

export default app
