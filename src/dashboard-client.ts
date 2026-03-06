import { createDashboardFormatters, getDashboardText, type DashboardLocale } from './dashboard-i18n'

type RangeKey = '7d' | '30d' | '1y' | 'all'
type TabKey = 'performance' | 'mix' | 'models'

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

type DashboardState = {
  locale: DashboardLocale
  defaultRange: RangeKey
  defaultTab: TabKey
  fullDateAxis: DateAxisPoint[]
  sourceSeries: SourceSeries[]
  modelDaily: ModelPoint[]
}

type ChartGeometry = {
  width: number
  height: number
  padLeft: number
  padRight: number
  padTop: number
  padBottom: number
}

type ViewState = {
  dateAxis: DateAxisPoint[]
  rangeSeriesAll: SourceSeries[]
  visibleSeries: SourceSeries[]
  summary: SummarySnapshot
  topModels: Array<{ label: string; totalTokens: number }>
}

const rangeOptions: Array<{ key: RangeKey; days: number | null }> = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '1y', days: 365 },
  { key: 'all', days: null },
]

let currentText = getDashboardText('en')
let currentFormatters = createDashboardFormatters('en')

function initDashboard() {
  const root = document.querySelector<HTMLElement>('[data-dashboard-root]')
  const stateElement = document.getElementById('dashboard-state')
  if (!root || !stateElement?.textContent) {
    return
  }

  let state: DashboardState

  try {
    state = JSON.parse(stateElement.textContent) as DashboardState
  } catch {
    return
  }

  if (state.fullDateAxis.length === 0 || state.sourceSeries.length === 0) {
    return
  }

  currentText = getDashboardText(state.locale)
  currentFormatters = createDashboardFormatters(state.locale)

  createDashboardController(root, state).init()
}

function createDashboardController(root: HTMLElement, state: DashboardState) {
  let activeRange: RangeKey = state.defaultRange
  let activeTab: TabKey = state.defaultTab
  let focusSource: string | null = null
  const visibleSources = new Set(state.sourceSeries.map((series) => series.source))

  const elements = {
    chipGrid: root.querySelector<HTMLElement>('[data-source-chip-grid]'),
    activeSources: root.querySelector<HTMLElement>('[data-summary-active-sources]'),
    firstSeen: root.querySelector<HTMLElement>('[data-summary-first-seen]'),
    lastEvent: root.querySelector<HTMLElement>('[data-summary-last-event]'),
    cacheMeter: root.querySelector<HTMLElement>('[data-cache-meter]'),
    cacheRatio: root.querySelector<HTMLElement>('[data-summary-cache-ratio]'),
    peakLine: root.querySelector<HTMLElement>('[data-summary-peak-line]'),
    channelList: root.querySelector<HTMLElement>('[data-channel-list]'),
    railCount: root.querySelector<HTMLElement>('[data-rail-count]'),
    metricStrip: root.querySelector<HTMLElement>('[data-metric-strip]'),
    rangeMeta: root.querySelector<HTMLElement>('[data-range-meta]'),
    latestMeta: root.querySelector<HTMLElement>('[data-latest-meta]'),
    workspaceGrid: root.querySelector<HTMLElement>('[data-workspace-grid]'),
    workspaceCaption: root.querySelector<HTMLElement>('[data-workspace-caption]'),
    footer: root.querySelector<HTMLElement>('[data-console-footer]'),
    sourceList: root.querySelector<HTMLElement>('[data-source-list]'),
    modelTableBody: root.querySelector<HTMLElement>('[data-model-table-body]'),
    tokenMix: root.querySelector<HTMLElement>('[data-token-mix]'),
    chartLegend: root.querySelector<HTMLElement>('[data-chart-legend]'),
    chartRangeLabel: root.querySelector<HTMLElement>('[data-chart-range-label]'),
    chartRangeWindow: root.querySelector<HTMLElement>('[data-chart-range-window]'),
    chartRoot: root.querySelector<HTMLElement>('[data-chart-root]'),
    tabButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab-key]')),
    rangeButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-range-key]')),
    panels: Array.from(root.querySelectorAll<HTMLElement>('[data-tab-panel]')),
  }

  const geometry = readChartGeometry(elements.chartRoot)
  let chartAbort: AbortController | null = null

  function init() {
    bindControls()
    render()
  }

  function bindControls() {
    elements.chipGrid?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-source-toggle]')
      if (!button) {
        return
      }

      const source = button.dataset.sourceToggle
      if (!source) {
        return
      }

      if (visibleSources.has(source)) {
        if (visibleSources.size === 1) {
          return
        }
        visibleSources.delete(source)
        if (focusSource === source) {
          focusSource = null
        }
      } else {
        visibleSources.add(source)
      }

      render()
    })

    elements.rangeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextRange = button.dataset.rangeKey as RangeKey | undefined
        if (!nextRange || nextRange === activeRange) {
          return
        }
        activeRange = nextRange
        render()
      })
    })

    elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextTab = button.dataset.tabKey as TabKey | undefined
        if (!nextTab || nextTab === activeTab) {
          return
        }
        activeTab = nextTab
        render()
      })
    })

    elements.chartLegend?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-legend-source]')
      if (!button) {
        return
      }

      const source = button.dataset.legendSource
      if (!source) {
        return
      }

      if (!visibleSources.has(source)) {
        visibleSources.add(source)
        focusSource = source
      } else {
        focusSource = focusSource === source ? null : source
      }

      render()
    })
  }

  function render() {
    const view = buildViewState(state, activeRange, visibleSources)

    if (focusSource && !view.visibleSeries.some((series) => series.source === focusSource)) {
      focusSource = null
    }

    renderSourceChips(view.rangeSeriesAll)
    renderRangeButtons()
    renderSummary(view.summary)
    renderChannels(view.summary)
    renderMetrics(view.summary)
    renderMeta(view.summary, view.dateAxis)
    renderPanels()
    renderSourceMix(view.visibleSeries, view.summary.totalTokens)
    renderModels(view.topModels, view.summary)
    renderChart(view)
  }

  function renderSourceChips(rangeSeriesAll: SourceSeries[]) {
    if (!elements.chipGrid) return

    elements.chipGrid.replaceChildren(
      ...rangeSeriesAll.map((series) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'agent-chip'
        button.dataset.sourceToggle = series.source
        button.dataset.source = series.source
        button.style.setProperty('--chip-color', series.color)
        button.setAttribute('aria-pressed', visibleSources.has(series.source) ? 'true' : 'false')
        button.classList.toggle('is-hidden', !visibleSources.has(series.source))
        button.classList.toggle('is-focus', focusSource === series.source)
        button.append(element('span', '', series.label), element('strong', '', currentFormatters.formatCompact(series.totalTokens)))
        return button
      }),
    )

    if (elements.railCount) {
      elements.railCount.textContent = String(visibleSources.size)
    }
  }

  function renderRangeButtons() {
    elements.rangeButtons.forEach((button) => {
      const isActive = button.dataset.rangeKey === activeRange
      button.classList.toggle('is-active', isActive)
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
    })
  }

  function renderSummary(summary: SummarySnapshot) {
    if (elements.activeSources) elements.activeSources.textContent = String(summary.activeSources)
    if (elements.firstSeen) elements.firstSeen.textContent = currentFormatters.formatMicroDate(summary.firstEventAt)
    if (elements.lastEvent) elements.lastEvent.textContent = currentFormatters.formatMicroDate(summary.lastEventAt)
    if (elements.cacheRatio) elements.cacheRatio.textContent = currentFormatters.formatPercent(summary.cacheRatio)
    if (elements.peakLine) {
      elements.peakLine.textContent = `${currentFormatters.formatCompact(summary.peakDayTokens)} / ${summary.peakDayLabel}`
    }
    if (elements.cacheMeter) {
      elements.cacheMeter.style.width = `${Math.max(summary.cacheRatio * 100, 2).toFixed(2)}%`
    }
  }

  function renderChannels(summary: SummarySnapshot) {
    if (!elements.channelList) return

    const items = [
      { label: currentText.labels.input, value: summary.inputTokens },
      { label: currentText.labels.output, value: summary.outputTokens },
      { label: currentText.labels.cacheRead, value: summary.cacheReadTokens },
      { label: currentText.labels.cacheWrite, value: summary.cacheWriteTokens },
    ]

    const maximum = Math.max(...items.map((item) => item.value), 1)

    elements.channelList.replaceChildren(
      ...items.map((item) => {
        const row = element('article', 'channel-row')
        const head = element('div', 'channel-row__head')
        head.append(element('span', '', item.label), element('strong', '', currentFormatters.formatCompact(item.value)))

        const meter = element('div', 'channel-meter')
        const fill = element('span')
        fill.style.width = `${((item.value / maximum) * 100).toFixed(2)}%`
        meter.append(fill)

        row.append(head, meter)
        return row
      }),
    )
  }

  function renderMetrics(summary: SummarySnapshot) {
    const metrics: Record<string, { value: string; note: string }> = {
      totalTokens: { value: currentFormatters.formatCompact(summary.totalTokens), note: currentText.metricNotes.allVisible },
      activeSources: { value: String(summary.activeSources), note: currentText.metricNotes.trackedLines },
      peakDayTokens: { value: currentFormatters.formatCompact(summary.peakDayTokens), note: summary.peakDayLabel },
      cacheRatio: { value: currentFormatters.formatPercent(summary.cacheRatio), note: currentText.metricNotes.readWrite },
      inputTokens: { value: currentFormatters.formatCompact(summary.inputTokens), note: currentText.metricNotes.promptVolume },
      outputTokens: { value: currentFormatters.formatCompact(summary.outputTokens), note: currentText.metricNotes.completionVolume },
    }

    for (const tile of elements.metricStrip?.querySelectorAll<HTMLElement>('[data-metric-tile]') ?? []) {
      const metric = tile.dataset.metricTile
      if (!metric || !metrics[metric]) {
        continue
      }

      const value = tile.querySelector<HTMLElement>('[data-metric-value]')
      const note = tile.querySelector<HTMLElement>('[data-metric-note]')
      if (value) value.textContent = metrics[metric].value
      if (note) note.textContent = metrics[metric].note
    }
  }

  function renderMeta(summary: SummarySnapshot, dateAxis: DateAxisPoint[]) {
    if (elements.rangeMeta) {
      elements.rangeMeta.textContent = `${currentText.labels.window}: ${rangeLabel(activeRange)}`
    }
    if (elements.latestMeta) {
      elements.latestMeta.textContent = `${currentText.labels.latest}: ${currentFormatters.formatDate(summary.lastEventAt)}`
    }
    if (elements.workspaceCaption) {
      elements.workspaceCaption.textContent = currentText.tabCaptions[activeTab]
    }
    if (elements.footer) {
      const windowLabel =
        dateAxis.length > 0
          ? `${dateAxis[0]?.shortLabel ?? currentText.noData} ${currentText.labels.rangeConnector} ${dateAxis[dateAxis.length - 1]?.shortLabel ?? currentText.noData}`
          : currentText.noData
      elements.footer.textContent = `${currentText.labels.dataSource} · ${windowLabel}`
    }
    if (elements.chartRangeLabel) {
      elements.chartRangeLabel.textContent = `${rangeLabel(activeRange)} / ${currentText.labels.daily}`
    }
    if (elements.chartRangeWindow) {
      elements.chartRangeWindow.textContent =
        dateAxis.length > 0
          ? `${dateAxis[0]?.shortLabel ?? currentText.noData} ${currentText.labels.rangeConnector} ${dateAxis[dateAxis.length - 1]?.shortLabel ?? currentText.noData}`
          : currentText.noData
    }
  }

  function renderPanels() {
    if (elements.workspaceGrid) {
      elements.workspaceGrid.dataset.activeTab = activeTab
    }

    elements.tabButtons.forEach((button) => {
      const isActive = button.dataset.tabKey === activeTab
      button.classList.toggle('is-active', isActive)
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
    })

    elements.panels.forEach((panel) => {
      const tabs = (panel.dataset.tabPanel ?? '').split(/\s+/).filter(Boolean)
      panel.hidden = !tabs.includes(activeTab)
    })
  }

  function renderSourceMix(visibleSeries: SourceSeries[], totalTokens: number) {
    if (!elements.sourceList) return

    const ordered = [...visibleSeries]
      .filter((series) => series.totalTokens > 0)
      .sort((left, right) => {
        if (right.totalTokens !== left.totalTokens) return right.totalTokens - left.totalTokens
        return left.label.localeCompare(right.label)
      })

    elements.sourceList.replaceChildren(
      ...ordered.map((series) => {
        const share = totalTokens === 0 ? 0 : series.totalTokens / totalTokens
        const item = element('li', 'source-list__item')
        const head = element('div', 'source-list__head')
        const label = element('span', 'source-list__label')
        const dot = element('i', 'source-list__dot')
        dot.style.backgroundColor = series.color
        label.append(dot, document.createTextNode(series.label))
        head.append(label, element('strong', '', currentFormatters.formatCompact(series.totalTokens)))

        const meter = element('div', 'source-list__meter')
        const fill = element('span', 'source-list__fill')
        fill.style.width = `${Math.max(share * 100, 2).toFixed(2)}%`
        fill.style.backgroundColor = series.color
        meter.append(fill)

        item.append(head, meter, element('span', 'source-list__share', currentFormatters.formatPercent(share)))
        return item
      }),
    )
  }

  function renderModels(topModels: Array<{ label: string; totalTokens: number }>, summary: SummarySnapshot) {
    if (elements.modelTableBody) {
      elements.modelTableBody.replaceChildren(
        ...(topModels.length > 0
          ? topModels.map((model, index) => {
              const row = document.createElement('tr')
              row.append(
                element('td', '', String(index + 1).padStart(2, '0')),
                element('td', '', model.label),
                element('td', '', currentFormatters.formatCompact(model.totalTokens)),
              )
              return row
            })
          : [emptyModelRow()]),
      )
    }

    if (elements.tokenMix) {
      const tokenMix = [
        { label: currentText.labels.input, value: summary.inputTokens },
        { label: currentText.labels.output, value: summary.outputTokens },
        { label: currentText.labels.cacheRead, value: summary.cacheReadTokens },
        { label: currentText.labels.cacheWrite, value: summary.cacheWriteTokens },
      ]
      const maximum = Math.max(...tokenMix.map((item) => item.value), 1)

      elements.tokenMix.replaceChildren(
        ...tokenMix.map((item) => {
          const article = element('article')
          const head = element('div', 'token-mix__head')
          head.append(element('span', '', item.label), element('strong', '', currentFormatters.formatCompact(item.value)))
          const meter = element('div', 'token-mix__meter')
          const fill = element('span', 'token-mix__fill')
          fill.style.width = `${((item.value / maximum) * 100).toFixed(2)}%`
          meter.append(fill)
          article.append(head, meter)
          return article
        }),
      )
    }
  }

  function renderChart(view: ViewState) {
    if (!elements.chartRoot || !geometry) return

    const { width, height, padLeft, padRight, padTop, padBottom } = geometry
    const innerWidth = width - padLeft - padRight
    const innerHeight = height - padTop - padBottom
    const maximum = Math.max(...view.visibleSeries.flatMap((series) => series.points.map((point) => point.totalTokens)), 1)

    const gridGroup = elements.chartRoot.querySelector<SVGGElement>('[data-chart-grid]')
    const xAxisGroup = elements.chartRoot.querySelector<SVGGElement>('[data-chart-x-axis]')
    const seriesLayer = elements.chartRoot.querySelector<SVGGElement>('[data-chart-series-layer]')
    const markerLayer = elements.chartRoot.querySelector<SVGGElement>('[data-chart-marker-layer]')
    const crosshair = elements.chartRoot.querySelector<SVGLineElement>('[data-chart-crosshair]')
    const overlay = elements.chartRoot.querySelector<SVGRectElement>('[data-chart-overlay]')
    const tooltip = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip]')
    const tooltipDate = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-date]')
    const tooltipTotal = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-total]')
    const tooltipSeries = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-series]')

    if (!gridGroup || !xAxisGroup || !seriesLayer || !markerLayer || !crosshair || !overlay || !tooltip || !tooltipDate || !tooltipTotal || !tooltipSeries) {
      return
    }

    gridGroup.replaceChildren(...buildGrid(maximum, geometry))
    xAxisGroup.replaceChildren(...buildXAxis(view.dateAxis, geometry))
    seriesLayer.replaceChildren(
      ...view.visibleSeries.map((series) => {
        const path = svg('path', {
          class: 'trend-line',
          d: buildLinePath(series.points, maximum, padLeft, padTop, innerWidth, innerHeight),
          stroke: series.color,
          'data-series-path': series.source,
        })

        if (focusSource) {
          path.setAttribute('stroke-opacity', focusSource === series.source ? '1' : '0.18')
        }

        return path
      }),
    )

    markerLayer.replaceChildren(
      ...view.visibleSeries.map((series) =>
        svg('circle', {
          class: 'trend-marker',
          cx: String(padLeft),
          cy: String(height - padBottom),
          fill: series.color,
          r: '4.5',
          'data-chart-marker': series.source,
        }),
      ),
    )

    crosshair.style.opacity = '0'
    tooltip.hidden = true
    tooltip.style.transform = 'translate(-999px, -999px)'

    renderLegend(view.rangeSeriesAll)
    bindChartInteractions(view, geometry)
  }

  function renderLegend(rangeSeriesAll: SourceSeries[]) {
    if (!elements.chartLegend) return

    elements.chartLegend.replaceChildren(
      ...rangeSeriesAll.map((series) => {
        const listItem = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'chart-legend__item'
        button.dataset.legendSource = series.source
        button.setAttribute('aria-pressed', focusSource === series.source ? 'true' : 'false')
        button.classList.toggle('is-focus', focusSource === series.source)
        button.classList.toggle('is-hidden', !visibleSources.has(series.source))

        const label = element('span', 'chart-legend__label')
        const dot = element('i', 'chart-legend__dot')
        dot.style.backgroundColor = series.color
        label.append(dot, document.createTextNode(series.label))

        button.append(label, element('strong', '', currentFormatters.formatCompact(series.totalTokens)))
        listItem.append(button)
        return listItem
      }),
    )
  }

  function bindChartInteractions(view: ViewState, geometry: ChartGeometry) {
    if (!elements.chartRoot) return

    chartAbort?.abort()
    chartAbort = new AbortController()

    const overlay = elements.chartRoot.querySelector<SVGRectElement>('[data-chart-overlay]')
    const crosshair = elements.chartRoot.querySelector<SVGLineElement>('[data-chart-crosshair]')
    const tooltip = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip]')
    const tooltipDate = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-date]')
    const tooltipTotal = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-total]')
    const tooltipSeries = elements.chartRoot.querySelector<HTMLElement>('[data-chart-tooltip-series]')

    if (!overlay || !crosshair || !tooltip || !tooltipDate || !tooltipTotal || !tooltipSeries) {
      return
    }

    const markerMap = new Map<string, SVGCircleElement>()
    elements.chartRoot.querySelectorAll<SVGCircleElement>('[data-chart-marker]').forEach((marker) => {
      const source = marker.dataset.chartMarker
      if (source) markerMap.set(source, marker)
    })

    const innerWidth = geometry.width - geometry.padLeft - geometry.padRight
    const innerHeight = geometry.height - geometry.padTop - geometry.padBottom
    const pointCount = Math.max(view.dateAxis.length - 1, 1)
    let activeIndex = Math.max(view.dateAxis.length - 1, 0)

    const getX = (index: number) => geometry.padLeft + (index / pointCount) * innerWidth
    const getY = (value: number, maximum: number) => geometry.padTop + innerHeight - (value / Math.max(maximum, 1)) * innerHeight
    const maximum = Math.max(...view.visibleSeries.flatMap((series) => series.points.map((point) => point.totalTokens)), 1)

    const renderFocus = (index: number, pointerX?: number, pointerY?: number) => {
      if (view.dateAxis.length === 0) {
        return
      }

      activeIndex = clamp(index, 0, view.dateAxis.length - 1)
      const point = view.dateAxis[activeIndex]
      const x = getX(activeIndex)
      const tooltipRows = focusSource
        ? [...view.visibleSeries].sort((left, right) => Number(right.source === focusSource) - Number(left.source === focusSource))
        : view.visibleSeries
      const total = view.visibleSeries.reduce((sum, series) => sum + (series.points[activeIndex]?.totalTokens ?? 0), 0)

      crosshair.setAttribute('x1', `${x}`)
      crosshair.setAttribute('x2', `${x}`)
      crosshair.style.opacity = '1'

      for (const series of view.visibleSeries) {
        const marker = markerMap.get(series.source)
        if (!marker) continue
        const value = series.points[activeIndex]?.totalTokens ?? 0
        marker.setAttribute('cx', `${x}`)
        marker.setAttribute('cy', `${getY(value, maximum)}`)
        marker.style.opacity = focusSource && focusSource !== series.source ? '0.25' : value > 0 ? '1' : '0.2'
      }

      tooltipDate.textContent = currentFormatters.formatDate(point.date)
      tooltipTotal.textContent = currentFormatters.formatCompact(total)
      tooltipSeries.replaceChildren(
        ...tooltipRows.map((series) => {
          const row = element('div', 'trend-tooltip__row')
          if (focusSource === series.source) {
            row.classList.add('is-focus')
          }

          const label = element('span', 'trend-tooltip__label')
          const swatch = element('i', 'trend-tooltip__swatch')
          swatch.style.backgroundColor = series.color
          label.append(swatch, document.createTextNode(series.label))

          row.append(label, element('strong', '', currentFormatters.formatCompact(series.points[activeIndex]?.totalTokens ?? 0)))
          return row
        }),
      )

      tooltip.hidden = false
      positionTooltip(elements.chartRoot!, overlay, tooltip, x, pointerX, pointerY)
    }

    const hide = () => {
      crosshair.style.opacity = '0'
      tooltip.hidden = true
      tooltip.style.transform = 'translate(-999px, -999px)'
      for (const marker of markerMap.values()) {
        marker.style.opacity = '0'
      }
    }

    const handlePointer = (event: PointerEvent) => {
      const bounds = overlay.getBoundingClientRect()
      if (bounds.width === 0) {
        return
      }

      const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
      const index = Math.round(ratio * pointCount)
      renderFocus(index, event.clientX, event.clientY)
    }

    overlay.addEventListener('pointerenter', handlePointer, { signal: chartAbort.signal })
    overlay.addEventListener('pointermove', handlePointer, { signal: chartAbort.signal })
    overlay.addEventListener('pointerleave', hide, { signal: chartAbort.signal })
    overlay.addEventListener('pointerdown', handlePointer, { signal: chartAbort.signal })

    elements.chartRoot.addEventListener(
      'focus',
      () => {
        renderFocus(activeIndex)
      },
      { signal: chartAbort.signal },
    )

    elements.chartRoot.addEventListener(
      'blur',
      (event) => {
        if (event.relatedTarget instanceof Node && elements.chartRoot?.contains(event.relatedTarget)) {
          return
        }
        hide()
      },
      { signal: chartAbort.signal },
    )

    elements.chartRoot.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          renderFocus(activeIndex - 1)
          return
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          renderFocus(activeIndex + 1)
          return
        }

        if (event.key === 'Home') {
          event.preventDefault()
          renderFocus(0)
          return
        }

        if (event.key === 'End') {
          event.preventDefault()
          renderFocus(view.dateAxis.length - 1)
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          hide()
        }
      },
      { signal: chartAbort.signal },
    )
  }

  return { init }
}

function buildViewState(state: DashboardState, range: RangeKey, visibleSources: Set<string>): ViewState {
  const dateAxis = sliceDateAxis(state.fullDateAxis, range)
  const rangeSeriesAll = sliceSourceSeries(state.sourceSeries, dateAxis.length)
  const visibleSeries = rangeSeriesAll.filter((series) => visibleSources.has(series.source))
  const summary = computeSummary(visibleSeries)
  const topModels = computeTopModels(state.modelDaily, new Set(dateAxis.map((point) => point.date)), visibleSources)

  return { dateAxis, rangeSeriesAll, visibleSeries, summary, topModels }
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

  let peakDayLabel = currentText.noData
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

function buildGrid(maximum: number, geometry: ChartGeometry) {
  const innerHeight = geometry.height - geometry.padTop - geometry.padBottom
  const ticks = [1, 0.75, 0.5, 0.25, 0]

  return ticks.flatMap((ratio) => {
    const y = geometry.padTop + (1 - ratio) * innerHeight
    return [
      svg('line', {
        class: 'trend-grid',
        x1: String(geometry.padLeft),
        x2: String(geometry.width - geometry.padRight),
        y1: String(y),
        y2: String(y),
      }),
      svgText('trend-y-label', geometry.padLeft - 10, y + 4, currentFormatters.formatCompact(maximum * ratio), 'end'),
    ]
  })
}

function buildXAxis(dateAxis: DateAxisPoint[], geometry: ChartGeometry) {
  const innerWidth = geometry.width - geometry.padLeft - geometry.padRight
  const interval = Math.max(Math.floor(dateAxis.length / 4), 1)

  return dateAxis
    .map((point, index) => {
      if (index % interval !== 0 && index !== dateAxis.length - 1) {
        return null
      }

      const x = geometry.padLeft + (index / Math.max(dateAxis.length - 1, 1)) * innerWidth
      const anchor = index === 0 ? 'start' : index === dateAxis.length - 1 ? 'end' : 'middle'
      return svgText('trend-x-label', x, geometry.height - 12, point.shortLabel, anchor)
    })
    .filter(Boolean) as SVGTextElement[]
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

function readChartGeometry(chartRoot: HTMLElement | null): ChartGeometry | null {
  if (!chartRoot) return null

  const width = Number(chartRoot.dataset.chartWidth)
  const height = Number(chartRoot.dataset.chartHeight)
  const padLeft = Number(chartRoot.dataset.chartPadLeft)
  const padRight = Number(chartRoot.dataset.chartPadRight)
  const padTop = Number(chartRoot.dataset.chartPadTop)
  const padBottom = Number(chartRoot.dataset.chartPadBottom)

  if ([width, height, padLeft, padRight, padTop, padBottom].some((value) => Number.isNaN(value))) {
    return null
  }

  return { width, height, padLeft, padRight, padTop, padBottom }
}

function positionTooltip(root: HTMLElement, overlay: SVGRectElement, tooltip: HTMLElement, chartX: number, pointerX?: number, pointerY?: number) {
  const rootBounds = root.getBoundingClientRect()
  const overlayBounds = overlay.getBoundingClientRect()
  const overlayX = Number(overlay.getAttribute('x') ?? 0)
  const overlayWidth = Number(overlay.getAttribute('width') ?? 1)
  const ratio = (chartX - overlayX) / Math.max(overlayWidth, 1)

  const fallbackX = overlayBounds.left + overlayBounds.width * ratio
  const fallbackY = overlayBounds.top + overlayBounds.height * 0.22
  const targetX = pointerX ?? fallbackX
  const targetY = pointerY ?? fallbackY

  const tooltipWidth = tooltip.offsetWidth
  const tooltipHeight = tooltip.offsetHeight

  let left = targetX - rootBounds.left + 16
  let top = targetY - rootBounds.top - tooltipHeight - 14

  if (left + tooltipWidth > rootBounds.width - 12) {
    left = targetX - rootBounds.left - tooltipWidth - 16
  }

  if (left < 12) {
    left = 12
  }

  if (top < 12) {
    top = 12
  }

  if (top + tooltipHeight > rootBounds.height - 12) {
    top = rootBounds.height - tooltipHeight - 12
  }

  tooltip.style.transform = `translate(${left}px, ${top}px)`
}

function svg(tag: keyof SVGElementTagNameMap, attrs: Record<string, string>) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value)
  }
  return node
}

function svgText(className: string, x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end') {
  const node = svg('text', {
    class: className,
    x: String(x),
    y: String(y),
    'text-anchor': anchor,
  })
  node.textContent = text
  return node
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (typeof text === 'string') node.textContent = text
  return node
}

function emptyModelRow() {
  const row = document.createElement('tr')
  const cell = document.createElement('td')
  cell.colSpan = 3
  cell.textContent = currentText.models.empty
  row.append(cell)
  return row
}

function rangeLabel(range: RangeKey) {
  return currentText.rangeLabels[range] ?? range.toUpperCase()
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard, { once: true })
} else {
  initDashboard()
}
