import type { D1DatabaseLike } from './usage'

type RangeKey = '7d' | '30d' | '1y' | 'all'
type TabKey = 'performance' | 'mix' | 'models'

type SourceDailyRow = {
  date: string
  source: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
}

type ModelDailyRow = {
  date: string
  source: string
  model: string
  total_tokens: number
}

type DateAxisPoint = {
  date: string
  shortLabel: string
}

type SourceSeriesPoint = {
  date: string
  shortLabel: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

type SourceSeries = {
  source: string
  label: string
  color: string
  totalTokens: number
  points: SourceSeriesPoint[]
}

type ModelPoint = {
  date: string
  source: string
  model: string
  totalTokens: number
}

type ModelRank = {
  label: string
  totalTokens: number
}

type SummarySnapshot = {
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

type DashboardClientState = {
  defaultRange: RangeKey
  defaultTab: TabKey
  fullDateAxis: DateAxisPoint[]
  sourceSeries: SourceSeries[]
  modelDaily: ModelPoint[]
}

export type DashboardData = {
  configured: boolean
  empty: boolean
  summary: SummarySnapshot
  dateAxis: DateAxisPoint[]
  sourceSeries: SourceSeries[]
  topModels: ModelRank[]
  clientState: DashboardClientState
}

const DEFAULT_RANGE: RangeKey = '30d'
const DEFAULT_TAB: TabKey = 'performance'

const rangeOptions: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'ALL', days: null },
]

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

  const sourceDailySql = `
    SELECT
      substr(occurred_at, 1, 10) AS date,
      source AS source,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    GROUP BY substr(occurred_at, 1, 10), source
    ORDER BY date ASC, source ASC
  `

  const modelDailySql = `
    SELECT
      substr(occurred_at, 1, 10) AS date,
      source AS source,
      model AS model,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM usage_events
    GROUP BY substr(occurred_at, 1, 10), source, model
    ORDER BY date ASC, source ASC, total_tokens DESC, model ASC
  `

  let sourceDailyResult: { results?: SourceDailyRow[] }
  let modelDailyResult: { results?: ModelDailyRow[] }

  try {
    ;[sourceDailyResult, modelDailyResult] = await Promise.all([
      db.prepare(sourceDailySql).all<SourceDailyRow>(),
      db.prepare(modelDailySql).all<ModelDailyRow>(),
    ])
  } catch {
    return emptyDashboardData(false)
  }

  const sourceDailyRows = (sourceDailyResult.results ?? []).map((row) => ({
    date: row.date,
    source: row.source,
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    cache_read_tokens: Number(row.cache_read_tokens ?? 0),
    cache_write_tokens: Number(row.cache_write_tokens ?? 0),
    total_tokens: Number(row.total_tokens ?? 0),
  }))

  if (sourceDailyRows.length === 0) {
    return emptyDashboardData(true)
  }

  const dateBounds = getDateBounds(sourceDailyRows)
  if (!dateBounds) {
    return emptyDashboardData(true)
  }

  const fullDateAxis = buildDateAxis(dateBounds.startDate, dateBounds.endDate)
  const fullSourceSeries = buildSourceSeries(fullDateAxis, sourceDailyRows)
  const modelDaily = (modelDailyResult.results ?? []).map((row) => ({
    date: row.date,
    source: row.source,
    model: row.model,
    totalTokens: Number(row.total_tokens ?? 0),
  }))

  const clientState: DashboardClientState = {
    defaultRange: DEFAULT_RANGE,
    defaultTab: DEFAULT_TAB,
    fullDateAxis,
    sourceSeries: fullSourceSeries,
    modelDaily,
  }

  const initialView = buildView(clientState, DEFAULT_RANGE, new Set(fullSourceSeries.map((series) => series.source)))

  return {
    configured: true,
    empty: initialView.summary.totalTokens === 0,
    summary: initialView.summary,
    dateAxis: initialView.dateAxis,
    sourceSeries: initialView.sourceSeries,
    topModels: initialView.topModels,
    clientState,
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
    dateAxis: [],
    sourceSeries: [],
    topModels: [],
    clientState: {
      defaultRange: DEFAULT_RANGE,
      defaultTab: DEFAULT_TAB,
      fullDateAxis: [],
      sourceSeries: [],
      modelDaily: [],
    },
  }
}

function getDateBounds(rows: SourceDailyRow[]) {
  if (rows.length === 0) {
    return null
  }

  let startDate = rows[0].date
  let endDate = rows[0].date

  for (const row of rows) {
    if (row.date < startDate) startDate = row.date
    if (row.date > endDate) endDate = row.date
  }

  return { startDate, endDate }
}

function buildDateAxis(startDate: string, endDate: string): DateAxisPoint[] {
  const axis: DateAxisPoint[] = []
  const current = parseUtcDate(startDate)
  const end = parseUtcDate(endDate)

  while (current <= end) {
    axis.push({
      date: current.toISOString().slice(0, 10),
      shortLabel: shortDate.format(current),
    })
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return axis
}

function buildSourceSeries(dateAxis: DateAxisPoint[], rows: SourceDailyRow[]): SourceSeries[] {
  const sourceTotals = new Map<string, number>()
  const valuesBySource = new Map<string, Map<string, SourceDailyRow>>()

  for (const row of rows) {
    sourceTotals.set(row.source, (sourceTotals.get(row.source) ?? 0) + row.total_tokens)
    const dateMap = valuesBySource.get(row.source) ?? new Map<string, SourceDailyRow>()
    dateMap.set(row.date, row)
    valuesBySource.set(row.source, dateMap)
  }

  const orderedSources = [...sourceTotals.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .map(([source]) => source)

  return orderedSources.map((source, index) => ({
    source,
    label: sourceDisplayNames[source] ?? toTitleCase(source),
    color: sourceColors[source] ?? fallbackColor(index),
    totalTokens: sourceTotals.get(source) ?? 0,
    points: dateAxis.map((point) => {
      const row = valuesBySource.get(source)?.get(point.date)
      return {
        date: point.date,
        shortLabel: point.shortLabel,
        inputTokens: row?.input_tokens ?? 0,
        outputTokens: row?.output_tokens ?? 0,
        cacheReadTokens: row?.cache_read_tokens ?? 0,
        cacheWriteTokens: row?.cache_write_tokens ?? 0,
        totalTokens: row?.total_tokens ?? 0,
      }
    }),
  }))
}

function buildView(clientState: DashboardClientState, range: RangeKey, visibleSources: Set<string>) {
  const dateAxis = sliceDateAxis(clientState.fullDateAxis, range)
  const sourceSeries = sliceSourceSeries(clientState.sourceSeries, dateAxis.length).filter((series) => visibleSources.has(series.source))
  const summary = computeSummary(sourceSeries)
  const topModels = computeTopModels(clientState.modelDaily, new Set(dateAxis.map((point) => point.date)), visibleSources)

  return { dateAxis, sourceSeries, summary, topModels }
}

function sliceDateAxis(dateAxis: DateAxisPoint[], range: RangeKey) {
  const days = rangeOptions.find((option) => option.key === range)?.days ?? null
  if (!days || days >= dateAxis.length) {
    return [...dateAxis]
  }
  return dateAxis.slice(-days)
}

function sliceSourceSeries(sourceSeries: SourceSeries[], pointCount: number) {
  if (pointCount <= 0) {
    return sourceSeries.map((series) => ({ ...series, totalTokens: 0, points: [] }))
  }

  return sourceSeries.map((series) => {
    const points = series.points.slice(-pointCount)
    return {
      ...series,
      totalTokens: points.reduce((sum, point) => sum + point.totalTokens, 0),
      points,
    }
  })
}

function computeSummary(sourceSeries: SourceSeries[]): SummarySnapshot {
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let firstEventAt: string | null = null
  let lastEventAt: string | null = null

  const perDay = new Map<string, number>()

  for (const series of sourceSeries) {
    for (const point of series.points) {
      totalTokens += point.totalTokens
      inputTokens += point.inputTokens
      outputTokens += point.outputTokens
      cacheReadTokens += point.cacheReadTokens
      cacheWriteTokens += point.cacheWriteTokens

      if (point.totalTokens > 0) {
        if (!firstEventAt || point.date < firstEventAt) firstEventAt = point.date
        if (!lastEventAt || point.date > lastEventAt) lastEventAt = point.date
      }

      perDay.set(point.date, (perDay.get(point.date) ?? 0) + point.totalTokens)
    }
  }

  let peakDayLabel = 'No data'
  let peakDayTokens = 0

  for (const series of sourceSeries) {
    for (const point of series.points) {
      const total = perDay.get(point.date) ?? 0
      if (total > peakDayTokens) {
        peakDayTokens = total
        peakDayLabel = point.shortLabel
      }
    }
  }

  return {
    activeSources: sourceSeries.filter((series) => series.totalTokens > 0).length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    firstEventAt,
    lastEventAt,
    cacheRatio: totalTokens === 0 ? 0 : (cacheReadTokens + cacheWriteTokens) / totalTokens,
    peakDayLabel,
    peakDayTokens,
  }
}

function computeTopModels(modelDaily: ModelPoint[], rangeDates: Set<string>, visibleSources: Set<string>) {
  const totals = new Map<string, number>()

  for (const row of modelDaily) {
    if (!rangeDates.has(row.date) || !visibleSources.has(row.source)) {
      continue
    }
    totals.set(row.model, (totals.get(row.model) ?? 0) + row.totalTokens)
  }

  return [...totals.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .slice(0, 5)
    .map(([label, totalTokens]) => ({ label, totalTokens }))
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

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00Z`)
}

function formatCompact(value: number) {
  return compactNumber.format(value)
}

function formatPercent(value: number) {
  return percentNumber.format(value)
}

function formatDate(value: string | null) {
  if (!value) return 'No data yet'
  const date = parseUtcDate(value)
  if (Number.isNaN(date.valueOf())) return value
  return longDate.format(date)
}

function formatMicroDate(value: string | null) {
  if (!value) return 'No data'
  const date = parseUtcDate(value)
  if (Number.isNaN(date.valueOf())) return value
  return microDate.format(date)
}

function rangeLabel(range: RangeKey) {
  return rangeOptions.find((option) => option.key === range)?.label ?? range.toUpperCase()
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

function StatTile({
  metric,
  note,
  value,
}: {
  metric: 'totalTokens' | 'activeSources' | 'peakDayTokens' | 'cacheRatio' | 'inputTokens' | 'outputTokens'
  note: string
  value: string
}) {
  const labels: Record<typeof metric, string> = {
    totalTokens: 'Total tokens',
    activeSources: 'Active agents',
    peakDayTokens: 'Peak burst',
    cacheRatio: 'Cache share',
    inputTokens: 'Input lane',
    outputTokens: 'Output lane',
  }

  return (
    <article class="metric-tile" data-metric-tile={metric}>
      <span>{labels[metric]}</span>
      <strong data-metric-value>{value}</strong>
      <small data-metric-note>{note}</small>
    </article>
  )
}

function RangeSwitch({ activeRange }: { activeRange: RangeKey }) {
  return (
    <div class="range-switch" data-range-switch>
      {rangeOptions.map((option) => (
        <button
          aria-pressed={option.key === activeRange}
          class={option.key === activeRange ? 'is-active' : ''}
          data-range-key={option.key}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function AgentTrendChart({
  dateAxis,
  sourceSeries,
  activeRange,
}: {
  dateAxis: DateAxisPoint[]
  sourceSeries: SourceSeries[]
  activeRange: RangeKey
}) {
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

  return (
    <section class="chart-panel panel--chart" data-tab-panel="performance">
      <div class="panel-head panel-head--chart">
        <div>
          <p class="panel-kicker">Performance</p>
          <h2>Net token flow</h2>
          <p class="panel-note">Hover the plot for day detail. Use source chips to hide lines and legend to isolate one line.</p>
        </div>
        <div class="chart-summary">
          <span>Window / mode</span>
          <strong data-chart-range-label>
            {rangeLabel(activeRange)} / Daily
          </strong>
          <small data-chart-range-window>
            {dateAxis[0]?.shortLabel ?? 'No data'} to {dateAxis[dateAxis.length - 1]?.shortLabel ?? 'No data'}
          </small>
        </div>
      </div>

      <ul class="chart-legend" aria-label="Chart legend" data-chart-legend>
        {sourceSeries.map((series) => (
          <li key={series.source}>
            <button aria-pressed="false" class="chart-legend__item" data-legend-source={series.source} type="button">
              <span class="chart-legend__label">
                <i class="chart-legend__dot" style={`background:${series.color}`} />
                {series.label}
              </span>
              <strong>{formatCompact(series.totalTokens)}</strong>
            </button>
          </li>
        ))}
      </ul>

      <div
        aria-label="Interactive line chart showing token usage by agent across time"
        class="chart-shell"
        data-chart-root="true"
        data-chart-height={String(chartHeight)}
        data-chart-pad-bottom={String(padBottom)}
        data-chart-pad-left={String(padLeft)}
        data-chart-pad-right={String(padRight)}
        data-chart-pad-top={String(padTop)}
        data-chart-width={String(chartWidth)}
        role="img"
        tabIndex={0}
      >
        <svg aria-hidden="true" class="trend-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          <g data-chart-grid>
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
          </g>

          <g data-chart-x-axis>
            {dateAxis.map((point, index) => {
              if (index % Math.max(Math.floor(dateAxis.length / 4), 1) !== 0 && index !== dateAxis.length - 1) {
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
          </g>

          <g data-chart-series-layer>
            {sourceSeries.map((series) => (
              <path
                class="trend-line"
                d={buildLinePath(series.points, maximum, padLeft, padTop, innerWidth, innerHeight)}
                data-series-path={series.source}
                key={series.source}
                stroke={series.color}
              />
            ))}
          </g>

          <line
            class="trend-crosshair"
            data-chart-crosshair
            x1={padLeft}
            x2={padLeft}
            y1={padTop}
            y2={chartHeight - padBottom}
          />

          <g data-chart-marker-layer>
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
          </g>

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
  const nonZeroSeries = sourceSeries.filter((series) => series.totalTokens > 0)

  return (
    <section class="panel panel--source" data-tab-panel="performance mix">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">Weight distribution</p>
          <h2>Agent split</h2>
          <p class="panel-note">Current range token share per visible source.</p>
        </div>
      </div>

      <ul class="source-list" data-source-list>
        {nonZeroSeries.map((series) => {
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
  summary: SummarySnapshot
}) {
  const tokenMix = [
    { label: 'Input', value: summary.inputTokens },
    { label: 'Output', value: summary.outputTokens },
    { label: 'Cache read', value: summary.cacheReadTokens },
    { label: 'Cache write', value: summary.cacheWriteTokens },
  ]

  const maxMixValue = Math.max(...tokenMix.map((item) => item.value), 1)

  return (
    <section class="panel panel--models" data-tab-panel="performance models">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">Model matrix</p>
          <h2>Observed leaders</h2>
          <p class="panel-note">Most active models for the current range and visible source set.</p>
        </div>
      </div>

      <div class="table-shell">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Model</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody data-model-table-body>
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

      <div class="token-mix" data-token-mix>
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

function DashboardStateScript({ state }: { state: DashboardClientState }) {
  const serialized = JSON.stringify(state).replace(/</g, '\\u003c')
  return (
    <script id="dashboard-state" type="application/json">
      {serialized}
    </script>
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
    <>
      <main class="console" data-dashboard-root="true">
        <aside class="console__rail">
          <div class="rail-topline">
            <span>Signal routing</span>
            <strong data-rail-count>{data.sourceSeries.length}</strong>
          </div>

          <RailSection note="toggle visibility" title="Source selection">
            <div class="agent-chip-grid" data-source-chip-grid>
              {data.sourceSeries.map((series) => (
                <button
                  aria-pressed="true"
                  class="agent-chip"
                  data-source-toggle={series.source}
                  key={series.source}
                  style={`--chip-color:${series.color}`}
                  type="button"
                >
                  <span>{series.label}</span>
                  <strong>{formatCompact(series.totalTokens)}</strong>
                </button>
              ))}
            </div>
          </RailSection>

          <RailSection note="selection aware" title="System state">
            <div class="rail-stat-grid">
              <article>
                <span>Ingest auth</span>
                <strong>{authEnabled ? 'ARMED' : 'LOCKED'}</strong>
              </article>
              <article>
                <span>Active agents</span>
                <strong data-summary-active-sources>{data.summary.activeSources}</strong>
              </article>
              <article>
                <span>First seen</span>
                <strong data-summary-first-seen>{formatMicroDate(data.summary.firstEventAt)}</strong>
              </article>
              <article>
                <span>Last event</span>
                <strong data-summary-last-event>{formatMicroDate(data.summary.lastEventAt)}</strong>
              </article>
            </div>
          </RailSection>

          <RailSection note="selection aware" title="Cache profile">
            <div class="signal-meter">
              <span data-cache-meter style={`width:${Math.max(data.summary.cacheRatio * 100, 2).toFixed(2)}%`} />
            </div>
            <div class="rail-line">
              <span>Cache share</span>
              <strong data-summary-cache-ratio>{formatPercent(data.summary.cacheRatio)}</strong>
            </div>
            <div class="rail-line">
              <span>Peak burst</span>
              <strong data-summary-peak-line>
                {formatCompact(data.summary.peakDayTokens)} / {data.summary.peakDayLabel}
              </strong>
            </div>
          </RailSection>

          <RailSection note="selection aware" title="Token channels">
            <div class="channel-list" data-channel-list>
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
              <span data-range-meta>window: {rangeLabel(DEFAULT_RANGE)}</span>
              <span data-latest-meta>latest: {formatDate(data.summary.lastEventAt)}</span>
            </div>
          </header>

          <section class="metric-strip" data-metric-strip>
            <StatTile metric="totalTokens" note="all visible" value={formatCompact(data.summary.totalTokens)} />
            <StatTile metric="activeSources" note="tracked lines" value={String(data.summary.activeSources)} />
            <StatTile metric="peakDayTokens" note={data.summary.peakDayLabel} value={formatCompact(data.summary.peakDayTokens)} />
            <StatTile metric="cacheRatio" note="read + write" value={formatPercent(data.summary.cacheRatio)} />
            <StatTile metric="inputTokens" note="prompt volume" value={formatCompact(data.summary.inputTokens)} />
            <StatTile metric="outputTokens" note="completion volume" value={formatCompact(data.summary.outputTokens)} />
          </section>

          <section class="workspace">
            <div class="workspace__header">
              <div class="workspace-toolbar">
                <nav class="workspace-tabs" aria-label="Dashboard modes">
                  <button class="is-active" data-tab-key="performance" type="button">
                    Performance
                  </button>
                  <button data-tab-key="mix" type="button">
                    Mix
                  </button>
                  <button data-tab-key="models" type="button">
                    Models
                  </button>
                </nav>
                <RangeSwitch activeRange={DEFAULT_RANGE} />
              </div>
              <p class="workspace-caption" data-workspace-caption>
                Daily token flow · hover chart for source detail
              </p>
            </div>

            <div class="workspace-grid" data-active-tab={DEFAULT_TAB} data-workspace-grid>
              <AgentTrendChart activeRange={DEFAULT_RANGE} dateAxis={data.dateAxis} sourceSeries={data.sourceSeries} />
              <SourceMixPanel sourceSeries={data.sourceSeries} totalTokens={data.summary.totalTokens} />
              <ModelPanel summary={data.summary} topModels={data.topModels} />
            </div>
          </section>

          <footer class="console__footer" data-console-footer>
            Data: Cloudflare D1 / usage_events · last event {formatDate(data.summary.lastEventAt)}
          </footer>
        </section>
      </main>
      <DashboardStateScript state={data.clientState} />
    </>
  )
}
