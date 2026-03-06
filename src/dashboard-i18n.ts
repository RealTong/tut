export type DashboardLocale = 'en' | 'zh'
export type DashboardTheme = 'light' | 'dark'

const localeMap: Record<DashboardLocale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
}

const dashboardCopy = {
  en: {
    htmlLang: 'en',
    brandEyebrow: 'agent token telemetry',
    title: 'TUT MONITOR',
    railTopline: 'Signal routing',
    railCountLabel: 'Active sources',
    railNotes: {
      toggleVisibility: 'toggle visibility',
      selectionAware: 'selection aware',
    },
    railSections: {
      sourceSelection: 'Source selection',
      systemState: 'System state',
      cacheProfile: 'Cache profile',
      tokenChannels: 'Token channels',
    },
    labels: {
      ingestAuth: 'Ingest auth',
      activeAgents: 'Active agents',
      firstSeen: 'First seen',
      lastEvent: 'Last event',
      cacheShare: 'Cache share',
      peakBurst: 'Peak burst',
      input: 'Input',
      output: 'Output',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      edgeWorker: 'edge worker',
      ingestOnline: 'ingest online',
      authMissing: 'auth missing',
      window: 'window',
      latest: 'latest',
      layout: 'Layout',
      nextStep: 'Next step',
      theme: 'Theme',
      language: 'Language',
      configured: 'Configured',
      missing: 'Missing',
      singleScreen: 'Single screen',
      runLocalSync: 'Run local sync',
      total: 'Total',
      daily: 'Daily',
      rangeConnector: 'to',
      dataSource: 'Data: Cloudflare D1 / usage_events',
      lastEventPrefix: 'last event',
      windowMode: 'Window / mode',
      armed: 'ARMED',
      locked: 'LOCKED',
    },
    metrics: {
      totalTokens: 'Total tokens',
      activeSources: 'Active agents',
      peakDayTokens: 'Peak burst',
      cacheRatio: 'Cache share',
      inputTokens: 'Input lane',
      outputTokens: 'Output lane',
    },
    metricNotes: {
      allVisible: 'all visible',
      trackedLines: 'tracked lines',
      readWrite: 'read + write',
      promptVolume: 'prompt volume',
      completionVolume: 'completion volume',
    },
    tabs: {
      performance: 'Performance',
      mix: 'Mix',
      models: 'Models',
    },
    tabCaptions: {
      performance: 'Daily token flow · hover chart for source detail',
      mix: 'Visible source allocation · current range totals and share',
      models: 'Model leaderboard · filtered by current range and visible sources',
    },
    rangeLabels: {
      '7d': '7D',
      '30d': '30D',
      '1y': '1Y',
      all: 'ALL',
    },
    chart: {
      kicker: 'Performance',
      title: 'Net token flow',
      note: 'Hover the plot for day detail. Use source chips to hide lines and legend to isolate one line.',
      aria: 'Interactive line chart showing token usage by agent across time',
    },
    sourceMix: {
      kicker: 'Weight distribution',
      title: 'Agent split',
      note: 'Current range token share per visible source.',
    },
    models: {
      kicker: 'Model matrix',
      title: 'Observed leaders',
      note: 'Most active models for the current range and visible source set.',
      rank: '#',
      model: 'Model',
      tokens: 'Tokens',
      empty: 'No model totals for the current selection.',
    },
    emptyState: {
      configured:
        'The ingest API is ready, but there is no token history to render yet. Send usage from your local agents and the chart will populate.',
      unconfigured:
        'This worker cannot read the D1 binding yet. Check the database binding and run the migrations before expecting charts.',
    },
    themeOptions: {
      light: 'Light',
      dark: 'Dark',
    },
    languageOptions: {
      en: 'EN',
      zh: '中文',
    },
    noData: 'No data',
    noDataYet: 'No data yet',
  },
  zh: {
    htmlLang: 'zh-CN',
    brandEyebrow: 'Agent Token 遥测',
    title: 'TUT MONITOR',
    railTopline: '信号路由',
    railCountLabel: '活跃来源',
    railNotes: {
      toggleVisibility: '切换可见性',
      selectionAware: '跟随筛选',
    },
    railSections: {
      sourceSelection: '来源选择',
      systemState: '系统状态',
      cacheProfile: '缓存概况',
      tokenChannels: 'Token 通道',
    },
    labels: {
      ingestAuth: '写入认证',
      activeAgents: '活跃 Agent',
      firstSeen: '首次记录',
      lastEvent: '最后记录',
      cacheShare: '缓存占比',
      peakBurst: '峰值日',
      input: '输入',
      output: '输出',
      cacheRead: '缓存读取',
      cacheWrite: '缓存写入',
      edgeWorker: '边缘 Worker',
      ingestOnline: '写入在线',
      authMissing: '缺少认证',
      window: '窗口',
      latest: '最新',
      layout: '布局',
      nextStep: '下一步',
      theme: '主题',
      language: '语言',
      configured: '已配置',
      missing: '缺失',
      singleScreen: '单屏布局',
      runLocalSync: '运行本地同步',
      total: '总量',
      daily: '日',
      rangeConnector: '至',
      dataSource: '数据: Cloudflare D1 / usage_events',
      lastEventPrefix: '最后事件',
      windowMode: '窗口 / 粒度',
      armed: '已启用',
      locked: '已锁定',
    },
    metrics: {
      totalTokens: '总 Tokens',
      activeSources: '活跃 Agent',
      peakDayTokens: '峰值日',
      cacheRatio: '缓存占比',
      inputTokens: '输入通道',
      outputTokens: '输出通道',
    },
    metricNotes: {
      allVisible: '当前可见',
      trackedLines: '可见折线',
      readWrite: '读取 + 写入',
      promptVolume: '提示输入量',
      completionVolume: '输出量',
    },
    tabs: {
      performance: '走势',
      mix: '占比',
      models: '模型',
    },
    tabCaptions: {
      performance: '按天展示 token 变化 · 悬停查看来源详情',
      mix: '当前可见来源占比 · 基于当前窗口统计',
      models: '模型榜单 · 按当前窗口和可见来源过滤',
    },
    rangeLabels: {
      '7d': '7天',
      '30d': '30天',
      '1y': '1年',
      all: '全部',
    },
    chart: {
      kicker: '走势',
      title: 'Token 趋势',
      note: '悬停查看每日详情。左侧可隐藏来源，图例可单独高亮某条线。',
      aria: '按时间展示各个 Agent token 用量的交互折线图',
    },
    sourceMix: {
      kicker: '来源分布',
      title: 'Agent 占比',
      note: '当前时间窗口内，各可见来源的 token 份额。',
    },
    models: {
      kicker: '模型矩阵',
      title: '活跃模型',
      note: '当前窗口与可见来源条件下最活跃的模型。',
      rank: '#',
      model: '模型',
      tokens: 'Tokens',
      empty: '当前筛选条件下没有模型统计数据。',
    },
    emptyState: {
      configured: '写入 API 已就绪，但还没有 token 历史数据。同步本地 agent 使用量后，这里会出现图表。',
      unconfigured: '当前 Worker 还无法读取 D1 绑定。请先检查数据库绑定并执行迁移。',
    },
    themeOptions: {
      light: '浅色',
      dark: '深色',
    },
    languageOptions: {
      en: 'EN',
      zh: '中文',
    },
    noData: '暂无数据',
    noDataYet: '暂无数据',
  },
} as const

export type DashboardText = (typeof dashboardCopy)[DashboardLocale]

export function getDashboardText(locale: DashboardLocale) {
  return dashboardCopy[locale]
}

export function normalizeDashboardTheme(value: string | null | undefined): DashboardTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function resolveDashboardLocale(requested: string | null | undefined, acceptLanguage?: string | null): DashboardLocale {
  const direct = normalizeDashboardLocale(requested)
  if (direct) {
    return direct
  }

  const fallback = normalizeDashboardLocale(acceptLanguage)
  return fallback ?? 'en'
}

function normalizeDashboardLocale(value: string | null | undefined): DashboardLocale | null {
  if (!value) {
    return null
  }

  const lower = value.toLowerCase()
  if (lower.startsWith('zh')) {
    return 'zh'
  }
  if (lower.startsWith('en')) {
    return 'en'
  }

  return null
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00Z`)
}

export function createDashboardFormatters(locale: DashboardLocale) {
  const intlLocale = localeMap[locale]
  const text = getDashboardText(locale)

  const compactNumber = new Intl.NumberFormat(intlLocale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })

  const percentNumber = new Intl.NumberFormat(intlLocale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })

  const shortDate = new Intl.DateTimeFormat(intlLocale, {
    month: 'short',
    day: 'numeric',
  })

  const longDate = new Intl.DateTimeFormat(intlLocale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const microDate = new Intl.DateTimeFormat(intlLocale, {
    month: 'short',
    day: 'numeric',
  })

  return {
    text,
    compactNumber,
    percentNumber,
    shortDate,
    longDate,
    microDate,
    formatCompact(value: number) {
      return compactNumber.format(value)
    },
    formatPercent(value: number) {
      return percentNumber.format(value)
    },
    formatDate(value: string | null) {
      if (!value) return text.noDataYet
      const date = parseUtcDate(value)
      if (Number.isNaN(date.valueOf())) return value
      return longDate.format(date)
    },
    formatMicroDate(value: string | null) {
      if (!value) return text.noData
      const date = parseUtcDate(value)
      if (Number.isNaN(date.valueOf())) return value
      return microDate.format(date)
    },
  }
}
