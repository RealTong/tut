type ChartAxisPoint = {
  date: string
  shortLabel: string
}

type ChartSeries = {
  source: string
  label: string
  color: string
  points: Array<{
    totalTokens: number
  }>
}

type ChartState = {
  chartWidth: number
  chartHeight: number
  padLeft: number
  padRight: number
  padTop: number
  padBottom: number
  maximum: number
  dateAxis: ChartAxisPoint[]
  sourceSeries: ChartSeries[]
}

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function initCharts() {
  document.querySelectorAll<HTMLElement>('[data-chart-root]').forEach((root) => {
    setupChart(root)
  })
}

function setupChart(root: HTMLElement) {
  const rawState = root.dataset.chartState
  if (!rawState) {
    return
  }

  let state: ChartState

  try {
    state = JSON.parse(rawState) as ChartState
  } catch {
    return
  }

  if (state.dateAxis.length === 0 || state.sourceSeries.length === 0) {
    return
  }

  const overlay = root.querySelector<SVGRectElement>('[data-chart-overlay]')
  const crosshair = root.querySelector<SVGLineElement>('[data-chart-crosshair]')
  const tooltip = root.querySelector<HTMLElement>('[data-chart-tooltip]')
  const tooltipDate = root.querySelector<HTMLElement>('[data-chart-tooltip-date]')
  const tooltipTotal = root.querySelector<HTMLElement>('[data-chart-tooltip-total]')
  const tooltipSeries = root.querySelector<HTMLElement>('[data-chart-tooltip-series]')

  if (!overlay || !crosshair || !tooltip || !tooltipDate || !tooltipTotal || !tooltipSeries) {
    return
  }

  const markerMap = new Map<string, SVGCircleElement>()
  root.querySelectorAll<SVGCircleElement>('[data-chart-marker]').forEach((marker) => {
    const source = marker.dataset.chartMarker
    if (source) {
      markerMap.set(source, marker)
    }
  })

  const innerWidth = state.chartWidth - state.padLeft - state.padRight
  const innerHeight = state.chartHeight - state.padTop - state.padBottom
  const pointCount = Math.max(state.dateAxis.length - 1, 1)

  let activeIndex = state.dateAxis.length - 1

  const getX = (index: number) => state.padLeft + (index / pointCount) * innerWidth
  const getY = (value: number) => state.padTop + innerHeight - (value / Math.max(state.maximum, 1)) * innerHeight

  const render = (index: number, pointerX?: number, pointerY?: number) => {
    activeIndex = clamp(index, 0, state.dateAxis.length - 1)

    const point = state.dateAxis[activeIndex]
    const x = getX(activeIndex)
    const total = state.sourceSeries.reduce((sum, series) => sum + (series.points[activeIndex]?.totalTokens ?? 0), 0)

    crosshair.setAttribute('x1', `${x}`)
    crosshair.setAttribute('x2', `${x}`)
    crosshair.style.opacity = '1'

    for (const series of state.sourceSeries) {
      const marker = markerMap.get(series.source)
      if (!marker) {
        continue
      }

      const value = series.points[activeIndex]?.totalTokens ?? 0
      marker.setAttribute('cx', `${x}`)
      marker.setAttribute('cy', `${getY(value)}`)
      marker.style.opacity = value > 0 ? '1' : '0.2'
    }

    tooltipDate.textContent = formatLongDate(point.date)
    tooltipTotal.textContent = compactNumber.format(total)
    tooltipSeries.replaceChildren(
      ...state.sourceSeries.map((series) => {
        const row = document.createElement('div')
        row.className = 'trend-tooltip__row'

        const label = document.createElement('span')
        label.className = 'trend-tooltip__label'

        const swatch = document.createElement('i')
        swatch.className = 'trend-tooltip__swatch'
        swatch.style.backgroundColor = series.color

        label.append(swatch, document.createTextNode(series.label))

        const value = document.createElement('strong')
        value.textContent = compactNumber.format(series.points[activeIndex]?.totalTokens ?? 0)

        row.append(label, value)
        return row
      }),
    )

    tooltip.hidden = false
    positionTooltip(root, overlay, tooltip, x, pointerX, pointerY)
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
    render(index, event.clientX, event.clientY)
  }

  overlay.addEventListener('pointerenter', handlePointer)
  overlay.addEventListener('pointermove', handlePointer)
  overlay.addEventListener('pointerleave', hide)
  overlay.addEventListener('pointerdown', handlePointer)

  root.addEventListener('focus', () => {
    render(activeIndex)
  })

  root.addEventListener('blur', (event) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return
    }
    hide()
  })

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      render(activeIndex - 1)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      render(activeIndex + 1)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      render(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      render(state.dateAxis.length - 1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
    }
  })
}

function positionTooltip(
  root: HTMLElement,
  overlay: SVGRectElement,
  tooltip: HTMLElement,
  chartX: number,
  pointerX?: number,
  pointerY?: number,
) {
  const rootBounds = root.getBoundingClientRect()
  const overlayBounds = overlay.getBoundingClientRect()
  const ratio = (chartX - Number(overlay.getAttribute('x') ?? 0)) / Math.max(Number(overlay.getAttribute('width') ?? 1), 1)

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

function formatLongDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf())) {
    return value
  }
  return longDate.format(date)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCharts, { once: true })
} else {
  initCharts()
}
