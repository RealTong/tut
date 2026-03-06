import {
  createDashboardFormatters,
  getDashboardText,
  type DashboardLocale,
  type DashboardText,
  type DashboardTheme,
} from './dashboard-i18n'
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
  locale: DashboardLocale
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

type DashboardFormatters = ReturnType<typeof createDashboardFormatters>

const DEFAULT_RANGE: RangeKey = '30d'
const DEFAULT_TAB: TabKey = 'performance'

const rangeOptions: Array<{ key: RangeKey; days: number | null }> = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '1y', days: 365 },
  { key: 'all', days: null },
]

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

export async function loadDashboardData(db: D1DatabaseLike | undefined, locale: DashboardLocale): Promise<DashboardData> {
  const formatters = createDashboardFormatters(locale)
  const text = formatters.text

  if (!db) {
    return emptyDashboardData(false, locale)
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
    return emptyDashboardData(false, locale)
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
    return emptyDashboardData(true, locale)
  }

  const dateBounds = getDateBounds(sourceDailyRows)
  if (!dateBounds) {
    return emptyDashboardData(true, locale)
  }

  const fullDateAxis = buildDateAxis(dateBounds.startDate, dateBounds.endDate, formatters.shortDate)
  const fullSourceSeries = buildSourceSeries(fullDateAxis, sourceDailyRows)
  const modelDaily = (modelDailyResult.results ?? []).map((row) => ({
    date: row.date,
    source: row.source,
    model: row.model,
    totalTokens: Number(row.total_tokens ?? 0),
  }))

  const clientState: DashboardClientState = {
    locale,
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

function emptyDashboardData(configured: boolean, locale: DashboardLocale): DashboardData {
  const text = getDashboardText(locale)

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
      peakDayLabel: text.noData,
      peakDayTokens: 0,
    },
    dateAxis: [],
    sourceSeries: [],
    topModels: [],
    clientState: {
      locale,
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

function buildDateAxis(startDate: string, endDate: string, shortDate: Intl.DateTimeFormat): DateAxisPoint[] {
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

function rangeLabel(range: RangeKey, text: DashboardText) {
  return text.rangeLabels[range] ?? range.toUpperCase()
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
  label,
  metric,
  note,
  value,
}: {
  label: string
  metric: 'totalTokens' | 'activeSources' | 'peakDayTokens' | 'cacheRatio' | 'inputTokens' | 'outputTokens'
  note: string
  value: string
}) {
  return (
    <article class="metric-tile" data-metric-tile={metric}>
      <span>{label}</span>
      <strong data-metric-value>{value}</strong>
      <small data-metric-note>{note}</small>
    </article>
  )
}

function RangeSwitch({ activeRange, text }: { activeRange: RangeKey; text: DashboardText }) {
  return (
    <div class="range-switch" data-range-switch>
      {rangeOptions.map((option) => (
        <button
          aria-pressed={option.key === activeRange}
          class={option.key === activeRange ? 'is-active' : ''}
          data-range-key={option.key}
          type="button"
        >
          {text.rangeLabels[option.key]}
        </button>
      ))}
    </div>
  )
}

function AgentTrendChart({
  dateAxis,
  formatters,
  sourceSeries,
  activeRange,
  text,
}: {
  dateAxis: DateAxisPoint[]
  formatters: DashboardFormatters
  sourceSeries: SourceSeries[]
  activeRange: RangeKey
  text: DashboardText
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
          <p class="panel-kicker">{text.chart.kicker}</p>
          <h2>{text.chart.title}</h2>
          <p class="panel-note">{text.chart.note}</p>
        </div>
        <div class="chart-summary">
          <span>{text.labels.windowMode}</span>
          <strong data-chart-range-label>
            {rangeLabel(activeRange, text)} / {text.labels.daily}
          </strong>
          <small data-chart-range-window>
            {dateAxis[0]?.shortLabel ?? text.noData} {text.labels.rangeConnector} {dateAxis[dateAxis.length - 1]?.shortLabel ?? text.noData}
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
              <strong>{formatters.formatCompact(series.totalTokens)}</strong>
            </button>
          </li>
        ))}
      </ul>

      <div
        aria-label={text.chart.aria}
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
                    {formatters.formatCompact(maximum * ratio)}
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
            <span>{text.labels.total}</span>
            <strong data-chart-tooltip-total />
          </div>
          <div class="trend-tooltip__series" data-chart-tooltip-series />
        </div>
      </div>
    </section>
  )
}

function SourceMixPanel({
  formatters,
  sourceSeries,
  text,
  totalTokens,
}: {
  formatters: DashboardFormatters
  sourceSeries: SourceSeries[]
  text: DashboardText
  totalTokens: number
}) {
  const nonZeroSeries = sourceSeries.filter((series) => series.totalTokens > 0)

  return (
    <section class="panel panel--source" data-tab-panel="performance mix">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">{text.sourceMix.kicker}</p>
          <h2>{text.sourceMix.title}</h2>
          <p class="panel-note">{text.sourceMix.note}</p>
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
                <strong>{formatters.formatCompact(series.totalTokens)}</strong>
              </div>
              <div class="source-list__meter">
                <span class="source-list__fill" style={`width:${Math.max(share * 100, 2).toFixed(2)}%; background:${series.color}`} />
              </div>
              <span class="source-list__share">{formatters.formatPercent(share)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ModelPanel({
  formatters,
  topModels,
  summary,
  text,
}: {
  formatters: DashboardFormatters
  topModels: ModelRank[]
  summary: SummarySnapshot
  text: DashboardText
}) {
  const tokenMix = [
    { label: text.labels.input, value: summary.inputTokens },
    { label: text.labels.output, value: summary.outputTokens },
    { label: text.labels.cacheRead, value: summary.cacheReadTokens },
    { label: text.labels.cacheWrite, value: summary.cacheWriteTokens },
  ]

  const maxMixValue = Math.max(...tokenMix.map((item) => item.value), 1)

  return (
    <section class="panel panel--models" data-tab-panel="performance models">
      <div class="panel-head panel-head--compact">
        <div>
          <p class="panel-kicker">{text.models.kicker}</p>
          <h2>{text.models.title}</h2>
          <p class="panel-note">{text.models.note}</p>
        </div>
      </div>

      <div class="table-shell">
        <table class="data-table">
          <thead>
            <tr>
              <th>{text.models.rank}</th>
              <th>{text.models.model}</th>
              <th>{text.models.tokens}</th>
            </tr>
          </thead>
          <tbody data-model-table-body>
            {topModels.map((model, index) => (
              <tr key={`${model.label}-${index}`}>
                <td>{String(index + 1).padStart(2, '0')}</td>
                <td>{model.label}</td>
                <td>{formatters.formatCompact(model.totalTokens)}</td>
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
              <strong>{formatters.formatCompact(item.value)}</strong>
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
  return <script dangerouslySetInnerHTML={{ __html: serialized }} id="dashboard-state" type="application/json" />
}

function DashboardChromeScript({ locale, theme }: { locale: DashboardLocale; theme: DashboardTheme }) {
  const htmlLang = getDashboardText(locale).htmlLang
  const code = `(function(){document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.lang=${JSON.stringify(htmlLang)};})();`
  return <script dangerouslySetInnerHTML={{ __html: code }} />
}

function PreferenceSwitch({
  current,
  label,
  links,
}: {
  current: string
  label: string
  links: Array<{ href: string; key: string; label: string }>
}) {
  return (
    <div class="toolbar-switch">
      <span>{label}</span>
      <div class="toolbar-switch__group">
        {links.map((link) => (
          <a class={link.key === current ? 'is-active' : ''} href={link.href}>
            {link.label}
          </a>
        ))}
      </div>
    </div>
  )
}

function buildPreferenceLinks(locale: DashboardLocale, theme: DashboardTheme) {
  const text = getDashboardText(locale)

  const buildHref = (nextLocale: DashboardLocale, nextTheme: DashboardTheme) => {
    const params = new URLSearchParams()
    params.set('lang', nextLocale)
    params.set('theme', nextTheme)

    const query = params.toString()
    return query ? `/?${query}` : '/'
  }

  return {
    themeLinks: (Object.keys(text.themeOptions) as DashboardTheme[]).map((key) => ({
      key,
      label: text.themeOptions[key],
      href: buildHref(locale, key),
    })),
    localeLinks: (Object.keys(text.languageOptions) as DashboardLocale[]).map((key) => ({
      key,
      label: text.languageOptions[key],
      href: buildHref(key, theme),
    })),
  }
}

function EmptyState({
  configured,
  authEnabled,
  locale,
  theme,
}: {
  configured: boolean
  authEnabled: boolean
  locale: DashboardLocale
  theme: DashboardTheme
}) {
  const text = getDashboardText(locale)
  const { themeLinks, localeLinks } = buildPreferenceLinks(locale, theme)

  return (
    <>
      <DashboardChromeScript locale={locale} theme={theme} />
      <main class="console console--empty">
        <section class="empty-state">
          <div class="topline topline--empty">
            <div class="topline__controls">
              <PreferenceSwitch current={theme} label={text.labels.theme} links={themeLinks} />
              <PreferenceSwitch current={locale} label={text.labels.language} links={localeLinks} />
            </div>
          </div>
          <div class="empty-state__copy">
            <p class="masthead__eyebrow">{text.brandEyebrow}</p>
            <h1>{text.title}</h1>
            <p class="empty-state__summary">{configured ? text.emptyState.configured : text.emptyState.unconfigured}</p>
          </div>

          <div class="empty-state__meta">
            <article>
              <span>{text.labels.ingestAuth}</span>
              <strong>{authEnabled ? text.labels.configured : text.labels.missing}</strong>
            </article>
            <article>
              <span>{text.labels.layout}</span>
              <strong>{text.labels.singleScreen}</strong>
            </article>
            <article>
              <span>{text.labels.nextStep}</span>
              <strong>{text.labels.runLocalSync}</strong>
            </article>
          </div>
        </section>
      </main>
    </>
  )
}

export function DashboardPage({
  data,
  authEnabled,
  locale,
  theme,
}: {
  data: DashboardData
  authEnabled: boolean
  locale: DashboardLocale
  theme: DashboardTheme
}) {
  const formatters = createDashboardFormatters(locale)
  const text = formatters.text
  const { themeLinks, localeLinks } = buildPreferenceLinks(locale, theme)

  if (data.empty) {
    return <EmptyState authEnabled={authEnabled} configured={data.configured} locale={locale} theme={theme} />
  }

  const tokenChannels = [
    { label: text.labels.input, value: data.summary.inputTokens },
    { label: text.labels.output, value: data.summary.outputTokens },
    { label: text.labels.cacheRead, value: data.summary.cacheReadTokens },
    { label: text.labels.cacheWrite, value: data.summary.cacheWriteTokens },
  ]

  const maxChannelValue = Math.max(...tokenChannels.map((item) => item.value), 1)

  return (
    <>
      <DashboardChromeScript locale={locale} theme={theme} />
      <main class="console" data-dashboard-root="true">
        <aside class="console__rail">
          <div class="rail-topline">
            <span>{text.railTopline}</span>
            <strong data-rail-count>{data.sourceSeries.length}</strong>
          </div>

          <RailSection note={text.railNotes.toggleVisibility} title={text.railSections.sourceSelection}>
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
                  <strong>{formatters.formatCompact(series.totalTokens)}</strong>
                </button>
              ))}
            </div>
          </RailSection>

          <RailSection note={text.railNotes.selectionAware} title={text.railSections.systemState}>
            <div class="rail-stat-grid">
              <article>
                <span>{text.labels.ingestAuth}</span>
                <strong>{authEnabled ? text.labels.armed : text.labels.locked}</strong>
              </article>
              <article>
                <span>{text.metrics.activeSources}</span>
                <strong data-summary-active-sources>{data.summary.activeSources}</strong>
              </article>
              <article>
                <span>{text.labels.firstSeen}</span>
                <strong data-summary-first-seen>{formatters.formatMicroDate(data.summary.firstEventAt)}</strong>
              </article>
              <article>
                <span>{text.labels.lastEvent}</span>
                <strong data-summary-last-event>{formatters.formatMicroDate(data.summary.lastEventAt)}</strong>
              </article>
            </div>
          </RailSection>

          <RailSection note={text.railNotes.selectionAware} title={text.railSections.cacheProfile}>
            <div class="signal-meter">
              <span data-cache-meter style={`width:${Math.max(data.summary.cacheRatio * 100, 2).toFixed(2)}%`} />
            </div>
            <div class="rail-line">
              <span>{text.metrics.cacheRatio}</span>
              <strong data-summary-cache-ratio>{formatters.formatPercent(data.summary.cacheRatio)}</strong>
            </div>
            <div class="rail-line">
              <span>{text.metrics.peakDayTokens}</span>
              <strong data-summary-peak-line>
                {formatters.formatCompact(data.summary.peakDayTokens)} / {data.summary.peakDayLabel}
              </strong>
            </div>
          </RailSection>

          <RailSection note={text.railNotes.selectionAware} title={text.railSections.tokenChannels}>
            <div class="channel-list" data-channel-list>
              {tokenChannels.map((item) => (
                <article class="channel-row" key={item.label}>
                  <div class="channel-row__head">
                    <span>{item.label}</span>
                    <strong>{formatters.formatCompact(item.value)}</strong>
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
            <div class="topline__controls">
              <PreferenceSwitch current={theme} label={text.labels.theme} links={themeLinks} />
              <PreferenceSwitch current={locale} label={text.labels.language} links={localeLinks} />
            </div>
            <div class="topline__status">
              <span>{text.labels.edgeWorker}</span>
              <span>{authEnabled ? text.labels.ingestOnline : text.labels.authMissing}</span>
            </div>
          </div>

          <header class="masthead">
            <div>
              <p class="masthead__eyebrow">{text.brandEyebrow}</p>
              <h1>{text.title}</h1>
            </div>
            <div class="masthead__meta">
              <span data-range-meta>
                {text.labels.window}: {rangeLabel(DEFAULT_RANGE, text)}
              </span>
              <span data-latest-meta>
                {text.labels.latest}: {formatters.formatDate(data.summary.lastEventAt)}
              </span>
            </div>
          </header>

          <section class="metric-strip" data-metric-strip>
            <StatTile
              label={text.metrics.totalTokens}
              metric="totalTokens"
              note={text.metricNotes.allVisible}
              value={formatters.formatCompact(data.summary.totalTokens)}
            />
            <StatTile
              label={text.metrics.activeSources}
              metric="activeSources"
              note={text.metricNotes.trackedLines}
              value={String(data.summary.activeSources)}
            />
            <StatTile
              label={text.metrics.peakDayTokens}
              metric="peakDayTokens"
              note={data.summary.peakDayLabel}
              value={formatters.formatCompact(data.summary.peakDayTokens)}
            />
            <StatTile
              label={text.metrics.cacheRatio}
              metric="cacheRatio"
              note={text.metricNotes.readWrite}
              value={formatters.formatPercent(data.summary.cacheRatio)}
            />
            <StatTile
              label={text.metrics.inputTokens}
              metric="inputTokens"
              note={text.metricNotes.promptVolume}
              value={formatters.formatCompact(data.summary.inputTokens)}
            />
            <StatTile
              label={text.metrics.outputTokens}
              metric="outputTokens"
              note={text.metricNotes.completionVolume}
              value={formatters.formatCompact(data.summary.outputTokens)}
            />
          </section>

          <section class="workspace">
            <div class="workspace__header">
              <div class="workspace-toolbar">
                <nav class="workspace-tabs" aria-label="Dashboard modes">
                  <button class="is-active" data-tab-key="performance" type="button">
                    {text.tabs.performance}
                  </button>
                  <button data-tab-key="mix" type="button">
                    {text.tabs.mix}
                  </button>
                  <button data-tab-key="models" type="button">
                    {text.tabs.models}
                  </button>
                </nav>
                <RangeSwitch activeRange={DEFAULT_RANGE} text={text} />
              </div>
              <p class="workspace-caption" data-workspace-caption>
                {text.tabCaptions.performance}
              </p>
            </div>

            <div class="workspace-grid" data-active-tab={DEFAULT_TAB} data-workspace-grid>
              <AgentTrendChart
                activeRange={DEFAULT_RANGE}
                dateAxis={data.dateAxis}
                formatters={formatters}
                sourceSeries={data.sourceSeries}
                text={text}
              />
              <SourceMixPanel formatters={formatters} sourceSeries={data.sourceSeries} text={text} totalTokens={data.summary.totalTokens} />
              <ModelPanel formatters={formatters} summary={data.summary} text={text} topModels={data.topModels} />
            </div>
          </section>

          <footer class="console__footer" data-console-footer>
            {text.labels.dataSource} · {text.labels.lastEventPrefix} {formatters.formatDate(data.summary.lastEventAt)}
          </footer>
        </section>
      </main>
      <DashboardStateScript state={data.clientState} />
    </>
  )
}
