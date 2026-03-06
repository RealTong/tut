import type { D1DatabaseLike } from './usage'

type SummaryRow = {
  active_sources: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  first_event_at: string | null
  last_event_at: string | null
}

type SourceDailyRow = {
  date: string
  source: string
  total_tokens: number
}

type RankRow = {
  label: string
  total_tokens: number
}

type DateAxisPoint = {
  date: string
  shortLabel: string
}

type SourceSeriesPoint = {
  date: string
  shortLabel: string
  totalTokens: number
}

type SourceSeries = {
  source: string
  label: string
  color: string
  totalTokens: number
  points: SourceSeriesPoint[]
}

type ModelRank = {
  label: string
  totalTokens: number
}

type ChartPayload = {
  chartWidth: number
  chartHeight: number
  padLeft: number
  padRight: number
  padTop: number
  padBottom: number
  maximum: number
  dateAxis: DateAxisPoint[]
  sourceSeries: Array<{
    source: string
    label: string
    color: string
    points: Array<{
      totalTokens: number
    }>
  }>
}

export type DashboardData = {
  configured: boolean
  empty: boolean
  summary: {
    activeSources: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    firstEventAt: string | null
    lastEventAt: string | null
    cacheRatio: number
    peakDayLabel: string
    peakDayTokens: number
  }
  dateAxis: DateAxisPoint[]
  sourceSeries: SourceSeries[]
  topModels: ModelRank[]
}

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const percentNumber = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
})

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const microDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const sourceDisplayNames: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

const sourceColors: Record<string, string> = {
  claude: '#d5c47d',
  codex: '#8abc8a',
  opencode: '#dde5d8',
  kimi: '#bf9a63',
  droid: '#8ea89f',
}

export async function loadDashboardData(db?: D1DatabaseLike): Promise<DashboardData> {
  if (!db) {
    return emptyDashboardData(false)
  }

  const since = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString()

  const summarySql = `
    SELECT
      COUNT(DISTINCT source) AS active_sources,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      MIN(occurred_at) AS first_event_at,
      MAX(occurred_at) AS last_event_at
    FROM usage_events
  `

  const sourceDailySql = `
    SELECT
      substr(occurred_at, 1, 10) AS date,
      source AS source,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    WHERE occurred_at >= ?
    GROUP BY substr(occurred_at, 1, 10), source
    ORDER BY date ASC, total_tokens DESC, source ASC
  `

  const sourceRankSql = `
    SELECT
      source AS label,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    GROUP BY source
    ORDER BY total_tokens DESC, label ASC
    LIMIT 12
  `

  const modelRankSql = `
    SELECT
      model AS label,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    GROUP BY model
    ORDER BY total_tokens DESC, label ASC
    LIMIT 5
  `

  let summary: SummaryRow | null
  let sourceDailyResult: { results?: SourceDailyRow[] }
  let sourceRankResult: { results?: RankRow[] }
  let modelRankResult: { results?: RankRow[] }

  try {
    ;[summary, sourceDailyResult, sourceRankResult, modelRankResult] = await Promise.all([
      db.prepare(summarySql).first<SummaryRow>(),
      db.prepare(sourceDailySql).bind(since).all<SourceDailyRow>(),
      db.prepare(sourceRankSql).all<RankRow>(),
      db.prepare(modelRankSql).all<RankRow>(),
    ])
  } catch {
    return emptyDashboardData(false)
  }

  const totalTokens = Number(summary?.total_tokens ?? 0)
  if (totalTokens === 0) {
    return emptyDashboardData(true)
  }

  const dateAxis = buildDateAxis()
  const sourceSeries = buildSourceSeries(dateAxis, sourceDailyResult.results ?? [], sourceRankResult.results ?? [])
  const peakDay = findPeakDay(dateAxis, sourceSeries)

  return {
    configured: true,
    empty: false,
    summary: {
      activeSources: Number(summary?.active_sources ?? 0),
      inputTokens: Number(summary?.input_tokens ?? 0),
      outputTokens: Number(summary?.output_tokens ?? 0),
      cacheReadTokens: Number(summary?.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(summary?.cache_write_tokens ?? 0),
      totalTokens,
      firstEventAt: summary?.first_event_at ?? null,
      lastEventAt: summary?.last_event_at ?? null,
      cacheRatio:
        totalTokens === 0
          ? 0
          : (Number(summary?.cache_read_tokens ?? 0) + Number(summary?.cache_write_tokens ?? 0)) / totalTokens,
      peakDayLabel: peakDay ? peakDay.shortLabel : 'No data',
      peakDayTokens: peakDay?.totalTokens ?? 0,
    },
    dateAxis,
    sourceSeries,
    topModels: (modelRankResult.results ?? []).map((row) => ({
      label: row.label,
      totalTokens: Number(row.total_tokens ?? 0),
    })),
  }
}

function emptyDashboardData(configured: boolean): DashboardData {
  return {
    configured,
    empty: true,
    summary: {
      activeSources: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      firstEventAt: null,
      lastEventAt: null,
      cacheRatio: 0,
      peakDayLabel: 'No data',
      peakDayTokens: 0,
    },
    dateAxis: buildDateAxis(),
    sourceSeries: [],
    topModels: [],
  }
}

function buildDateAxis(): DateAxisPoint[] {
  const axis: DateAxisPoint[] = []

  for (let offset = 27; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCDate(date.getUTCDate() - offset)

    axis.push({
      date: date.toISOString().slice(0, 10),
      shortLabel: shortDate.format(date),
    })
  }

  return axis
}

function buildSourceSeries(dateAxis: DateAxisPoint[], rows: SourceDailyRow[], sourceRanks: RankRow[]): SourceSeries[] {
  const sourceTotals = new Map<string, number>()
  const valuesBySource = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const source = row.source
    const total = Number(row.total_tokens ?? 0)
    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + total)

    const dateMap = valuesBySource.get(source) ?? new Map<string, number>()
    dateMap.set(row.date, total)
    valuesBySource.set(source, dateMap)
  }

  const orderedSources = sourceRanks
    .map((row) => row.label)
    .filter((label) => sourceTotals.has(label))

  for (const source of valuesBySource.keys()) {
    if (!orderedSources.includes(source)) {
      orderedSources.push(source)
    }
  }

  return orderedSources.map((source, index) => ({
    source,
    label: sourceDisplayNames[source] ?? toTitleCase(source),
    color: sourceColors[source] ?? fallbackColor(index),
    totalTokens: sourceTotals.get(source) ?? 0,
    points: dateAxis.map((point) => ({
      date: point.date,
      shortLabel: point.shortLabel,
      totalTokens: valuesBySource.get(source)?.get(point.date) ?? 0,
    })),
  }))
}

function findPeakDay(dateAxis: DateAxisPoint[], sourceSeries: SourceSeries[]) {
  const totals = dateAxis.map((point, index) => ({
    date: point.date,
    shortLabel: point.shortLabel,
    totalTokens: sourceSeries.reduce((sum, series) => sum + (series.points[index]?.totalTokens ?? 0), 0),
  }))

  return totals.reduce<{ date: string; shortLabel: string; totalTokens: number } | null>((peak, point) => {
    if (!peak || point.totalTokens > peak.totalTokens) {
      return point
    }
    return peak
  }, null)
}

function toTitleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function fallbackColor(index: number) {
  const palette = ['#9ca98f', '#8d9dad', '#b2998a', '#a3b39c', '#9a8fb1']
  return palette[index % palette.length]
}

function formatCompact(value: number) {
  return compactNumber.format(value)
}

function formatPercent(value: number) {
  return percentNumber.format(value)
}

function formatDate(value: string | null) {
  if (!value) return 'No data yet'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return longDate.format(date)
}

function formatMicroDate(value: string | null) {
  if (!value) return 'No data'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return microDate.format(date)
}

function buildLinePath(points: SourceSeriesPoint[], maximum: number, padLeft: number, padTop: number, innerWidth: number, innerHeight: number) {
  if (maximum <= 0 || points.length === 0) {
    return ''
  }

  return points
    .map((point, index) => {
      const x = padLeft + (index / Math.max(points.length - 1, 1)) * innerWidth
      const y = padTop + innerHeight - (point.totalTokens / maximum) * innerHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function buildChartPayload(
  dateAxis: DateAxisPoint[],
  sourceSeries: SourceSeries[],
  maximum: number,
  chartWidth: number,
  chartHeight: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
) {
  const payload: ChartPayload = {
    chartWidth,
    chartHeight,
    padLeft,
    padRight,
    padTop,
    padBottom,
    maximum,
    dateAxis,
    sourceSeries: sourceSeries.map((series) => ({
      source: series.source,
      label: series.label,
      color: series.color,
      points: series.points.map((point) => ({
        totalTokens: point.totalTokens,
      })),
    })),
  }

  return JSON.stringify(payload)
}

function RailSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: unknown
}) {
  return (
    <section class="rail-section">
      <div class="rail-section__head">
        <p class="micro-label">{title}</p>
        {note ? <span>{note}</span> : null}
      </div>
      <div class="rail-section__body">{children}</div>
    </section>
  )
}

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <article class="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  )
}

function AgentTrendChart({ dateAxis, sourceSeries }: { dateAxis: DateAxisPoint[]; sourceSeries: SourceSeries[] }) {
  const chartWidth = 920
  const chartHeight = 400
  const padLeft = 56
  const padRight = 18
  const padTop = 16
  const padBottom = 40
  const innerWidth = chartWidth - padLeft - padRight
  const innerHeight = chartHeight - padTop - padBottom
  const maximum = Math.max(...sourceSeries.flatMap((series) => series.points.map((point) => point.totalTokens)), 1)
  const tickValues = [1, 0.75, 0.5, 0.25, 0]
  const payload = buildChartPayload(dateAxis, sourceSeries, maximum, chartWidth, chartHeight, padLeft, padRight, padTop, padBottom)

  return (
    <section class="chart-panel">
      <div class="panel-head panel-head--chart">
        <div>
          <p class="panel-kicker">Performance</p>
          <h2>Net token flow</h2>
          <p class="panel-note">Hover the plot or use left and right arrow keys to inspect a single session day.</p>
        </div>
        <div class="chart-summary">
          <span>Window / mode</span>
          <strong>28D / Daily</strong>
          <small>
            {dateAxis[0]?.shortLabel} to {dateAxis[dateAxis.length - 1]?.shortLabel}
          </small>
        </div>
      </div>

      <ul class="chart-legend" aria-label="Chart legend">
        {sourceSeries.map((series) => (
          <li class="chart-legend__item" key={series.source}>
            <span class="chart-legend__label">
              <i class="chart-legend__dot" style={`background:${series.color}`} />
              {series.label}
            </span>
            <strong>{formatCompact(series.totalTokens)}</strong>
          </li>
        ))}
      </ul>

      <div
        aria-label="Interactive line chart showing token usage by agent across the last 28 days"
        class="chart-shell"
        data-chart-root
        data-chart-state={payload}
        role="img"
        tabindex={0}
      >
        <svg aria-hidden="true" class="trend-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {tickValues.map((ratio) => {
            const y = padTop + (1 - ratio) * innerHeight
            return (
              <g key={ratio}>
                <line class="trend-grid" x1={padLeft} x2={chartWidth - padRight} y1={y} y2={y} />
                <text class="trend-y-label" text-anchor="end" x={padLeft - 10} y={y + 4}>
                  {formatCompact(maximum * ratio)}
                </text>
              </g>
            )
          })}

          {dateAxis.map((point, index) => {
            if (index % 7 !== 0 && index !== dateAxis.length - 1) {
              return null
            }

            const x = padLeft + (index / Math.max(dateAxis.length - 1, 1)) * innerWidth
            const anchor = index === 0 ? 'start' : index === dateAxis.length - 1 ? 'end' : 'middle'

            return (
              <text class="trend-x-label" key={`${point.date}-${index}`} text-anchor={anchor} x={x} y={chartHeight - 12}>
                {point.shortLabel}
              </text>
            )
          })}

          {sourceSeries.map((series) => (
            <path
              class="trend-line"
              d={buildLinePath(series.points, maximum, padLeft, padTop, innerWidth, innerHeight)}
              key={series.source}
              stroke={series.color}
            />
          ))}

          <line
            class="trend-crosshair"
            data-chart-crosshair
            x1={padLeft}
            x2={padLeft}
            y1={padTop}
            y2={chartHeight - padBottom}
          />

          {sourceSeries.map((series) => (
            <circle
              class="trend-marker"
              cx={padLeft}
              cy={chartHeight - padBottom}
              data-chart-marker={series.source}
              fill={series.color}
              key={`${series.source}-marker`}
              r="4.5"
            />
          ))}

          <rect data-chart-overlay fill="transparent" height={innerHeight} width={innerWidth} x={padLeft} y={padTop} />
        </svg>

        <div class="trend-tooltip" data-chart-tooltip hidden>
          <p class="trend-tooltip__date" data-chart-tooltip-date />
          <div class="trend-tooltip__total">
            <span>Total</span>
            <strong data-chart-tooltip-total />
          </div>
          <div class="trend-tooltip__series" data-chart-tooltip-series />
        </div>
      </div>
    </section>
  )
}

function SourceMixPanel({ sourceSeries, totalTokens }: { sourceSeries: SourceSeries[]; totalTokens: number }) {
  return (
    <section class="panel">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">Weight distribution</p>
          <h2>Agent split</h2>
          <p class="panel-note">Lifetime token share per source.</p>
        </div>
      </div>

      <ul class="source-list">
        {sourceSeries.map((series) => {
          const share = totalTokens === 0 ? 0 : series.totalTokens / totalTokens
          return (
            <li class="source-list__item" key={series.source}>
              <div class="source-list__head">
                <span class="source-list__label">
                  <i class="source-list__dot" style={`background:${series.color}`} />
                  {series.label}
                </span>
                <strong>{formatCompact(series.totalTokens)}</strong>
              </div>
              <div class="source-list__meter">
                <span class="source-list__fill" style={`width:${Math.max(share * 100, 2).toFixed(2)}%; background:${series.color}`} />
              </div>
              <span class="source-list__share">{formatPercent(share)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ModelPanel({
  topModels,
  summary,
}: {
  topModels: ModelRank[]
  summary: DashboardData['summary']
}) {
  const tokenMix = [
    { label: 'Input', value: summary.inputTokens },
    { label: 'Output', value: summary.outputTokens },
    { label: 'Cache read', value: summary.cacheReadTokens },
    { label: 'Cache write', value: summary.cacheWriteTokens },
  ]

  const maxMixValue = Math.max(...tokenMix.map((item) => item.value), 1)

  return (
    <section class="panel">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">Model matrix</p>
          <h2>Observed leaders</h2>
          <p class="panel-note">Most active models plus the channel split beneath them.</p>
        </div>
      </div>

      {topModels.length > 0 ? (
        <div class="table-shell">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {topModels.map((model, index) => (
                <tr key={`${model.label}-${index}`}>
                  <td>{String(index + 1).padStart(2, '0')}</td>
                  <td>{model.label}</td>
                  <td>{formatCompact(model.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="panel-empty">No model totals yet.</p>
      )}

      <div class="token-mix">
        {tokenMix.map((item) => (
          <article key={item.label}>
            <div class="token-mix__head">
              <span>{item.label}</span>
              <strong>{formatCompact(item.value)}</strong>
            </div>
            <div class="token-mix__meter">
              <span class="token-mix__fill" style={`width:${((item.value / maxMixValue) * 100).toFixed(2)}%`} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function EmptyState({ configured, authEnabled }: { configured: boolean; authEnabled: boolean }) {
  return (
    <main class="console console--empty">
      <section class="empty-state">
        <div class="empty-state__copy">
          <p class="masthead__eyebrow">agent token telemetry</p>
          <h1>TUT MONITOR</h1>
          <p class="empty-state__summary">
            {configured
              ? 'The ingest API is ready, but there is no token history to render yet. Send usage from your local agents and the chart will populate.'
              : 'This worker cannot read the D1 binding yet. Check the database binding and run the migrations before expecting charts.'}
          </p>
        </div>

        <div class="empty-state__meta">
          <article>
            <span>Ingest auth</span>
            <strong>{authEnabled ? 'Configured' : 'Missing'}</strong>
          </article>
          <article>
            <span>Layout</span>
            <strong>Single screen</strong>
          </article>
          <article>
            <span>Next step</span>
            <strong>Run local sync</strong>
          </article>
        </div>
      </section>
    </main>
  )
}

export function DashboardPage({ data, authEnabled }: { data: DashboardData; authEnabled: boolean }) {
  if (data.empty) {
    return <EmptyState authEnabled={authEnabled} configured={data.configured} />
  }

  const tokenChannels = [
    { label: 'Input', value: data.summary.inputTokens },
    { label: 'Output', value: data.summary.outputTokens },
    { label: 'Cache read', value: data.summary.cacheReadTokens },
    { label: 'Cache write', value: data.summary.cacheWriteTokens },
  ]

  const maxChannelValue = Math.max(...tokenChannels.map((item) => item.value), 1)

  return (
    <main class="console">
      <aside class="console__rail">
        <div class="rail-topline">
          <span>Signal routing</span>
          <strong>{data.sourceSeries.length}</strong>
        </div>

        <RailSection note="live" title="Source selection">
          <div class="agent-chip-grid">
            {data.sourceSeries.map((series) => (
              <article class="agent-chip" key={series.source} style={`--chip-color:${series.color}`}>
                <span>{series.label}</span>
                <strong>{formatCompact(series.totalTokens)}</strong>
              </article>
            ))}
          </div>
        </RailSection>

        <RailSection note="window" title="System state">
          <div class="rail-stat-grid">
            <article>
              <span>Ingest auth</span>
              <strong>{authEnabled ? 'ARMED' : 'LOCKED'}</strong>
            </article>
            <article>
              <span>Active agents</span>
              <strong>{data.summary.activeSources}</strong>
            </article>
            <article>
              <span>First seen</span>
              <strong>{formatMicroDate(data.summary.firstEventAt)}</strong>
            </article>
            <article>
              <span>Last event</span>
              <strong>{formatMicroDate(data.summary.lastEventAt)}</strong>
            </article>
          </div>
        </RailSection>

        <RailSection note="pressure" title="Cache profile">
          <div class="signal-meter">
            <span style={`width:${Math.max(data.summary.cacheRatio * 100, 2).toFixed(2)}%`} />
          </div>
          <div class="rail-line">
            <span>Cache share</span>
            <strong>{formatPercent(data.summary.cacheRatio)}</strong>
          </div>
          <div class="rail-line">
            <span>Peak burst</span>
            <strong>
              {formatCompact(data.summary.peakDayTokens)} / {data.summary.peakDayLabel}
            </strong>
          </div>
        </RailSection>

        <RailSection note="channels" title="Token channels">
          <div class="channel-list">
            {tokenChannels.map((item) => (
              <article class="channel-row" key={item.label}>
                <div class="channel-row__head">
                  <span>{item.label}</span>
                  <strong>{formatCompact(item.value)}</strong>
                </div>
                <div class="channel-meter">
                  <span style={`width:${((item.value / maxChannelValue) * 100).toFixed(2)}%`} />
                </div>
              </article>
            ))}
          </div>
        </RailSection>
      </aside>

      <section class="console__main">
        <div class="topline">
          <span>edge worker</span>
          <span>{authEnabled ? 'ingest online' : 'auth missing'}</span>
        </div>

        <header class="masthead">
          <div>
            <p class="masthead__eyebrow">agent token telemetry</p>
            <h1>TUT MONITOR</h1>
          </div>
          <div class="masthead__meta">
            <span>window: 28d</span>
            <span>latest: {formatDate(data.summary.lastEventAt)}</span>
          </div>
        </header>

        <section class="metric-strip">
          <StatTile label="Total tokens" note="all observed" value={formatCompact(data.summary.totalTokens)} />
          <StatTile label="Active agents" note="tracked lines" value={String(data.summary.activeSources)} />
          <StatTile label="Peak burst" note={data.summary.peakDayLabel} value={formatCompact(data.summary.peakDayTokens)} />
          <StatTile label="Cache share" note="read + write" value={formatPercent(data.summary.cacheRatio)} />
          <StatTile label="Input lane" note="prompt volume" value={formatCompact(data.summary.inputTokens)} />
          <StatTile label="Output lane" note="completion volume" value={formatCompact(data.summary.outputTokens)} />
        </section>

        <section class="workspace">
          <div class="workspace__header">
            <nav class="workspace-tabs" aria-label="Dashboard modes">
              <span class="is-active">Performance</span>
              <span>Mix</span>
              <span>Models</span>
            </nav>
            <p class="workspace-caption">Daily token flow · hover chart for source detail</p>
          </div>

          <div class="workspace-grid">
            <AgentTrendChart dateAxis={data.dateAxis} sourceSeries={data.sourceSeries} />
            <SourceMixPanel sourceSeries={data.sourceSeries} totalTokens={data.summary.totalTokens} />
            <ModelPanel summary={data.summary} topModels={data.topModels} />
          </div>
        </section>

        <footer class="console__footer">Data: Cloudflare D1 / usage_events · last event {formatDate(data.summary.lastEventAt)}</footer>
      </section>
    </main>
  )
}
