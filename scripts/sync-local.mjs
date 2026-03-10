#!/usr/bin/env bun

import { createHash } from 'bun:crypto'
import { Database } from 'bun:sqlite'
import { createReadStream } from 'bun:fs'
import { promises as fs } from 'bun:fs'
import os from 'bun:os'
import path from 'bun:path'
import readline from 'bun:readline'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/api/v1/usage'
const DEFAULT_BATCH_SIZE = 200
const SUPPORTED_SOURCES = ['claude', 'codex', 'opencode']

function parseArgs(argv) {
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    token: process.env.TUT_API_TOKEN || null,
    sources: [...SUPPORTED_SOURCES],
    since: null,
    full: false,
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    stateFile: process.env.TUT_SYNC_STATE || path.join(os.homedir(), '.config', 'tut', 'sync-state.json'),
  }

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i]

    if (current === '--help' || current === '-h') {
      printHelp()
      process.exit(0)
    }

    if (current === '--full') {
      args.full = true
      continue
    }

    if (current === '--dry-run') {
      args.dryRun = true
      continue
    }

    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${current}`)
    }

    if (current === '--endpoint') {
      args.endpoint = next
      i += 1
      continue
    }

    if (current === '--token') {
      args.token = next
      i += 1
      continue
    }

    if (current === '--sources') {
      args.sources = next
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      i += 1
      continue
    }

    if (current === '--since') {
      args.since = normalizeToIso(next)
      if (!args.since) {
        throw new Error(`Invalid --since value: ${next}`)
      }
      i += 1
      continue
    }

    if (current === '--batch-size') {
      const parsed = Number.parseInt(next, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --batch-size value: ${next}`)
      }
      args.batchSize = parsed
      i += 1
      continue
    }

    if (current === '--state-file') {
      args.stateFile = next
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${current}`)
  }

  const invalid = args.sources.filter((item) => !SUPPORTED_SOURCES.includes(item))
  if (invalid.length > 0) {
    throw new Error(`Unsupported sources: ${invalid.join(', ')}`)
  }

  if (args.sources.length === 0) {
    throw new Error('No source selected. Use --sources claude,codex,opencode')
  }

  return args
}

function printHelp() {
  console.log(`tut local sync

Usage:
  node scripts/sync-local.mjs [options]

Options:
  --endpoint <url>       API endpoint (default: ${DEFAULT_ENDPOINT})
  --token <token>        Bearer token (or env TUT_API_TOKEN)
  --sources <list>       claude,codex,opencode (default: all)
  --since <datetime>     only sync events after datetime (ISO or YYYY-MM-DD)
  --batch-size <n>       upload batch size (default: ${DEFAULT_BATCH_SIZE})
  --state-file <path>    checkpoint state path
  --full                 ignore checkpoint state
  --dry-run              parse only, do not upload
  -h, --help             show this help
`)
}

function sha1(input) {
  return createHash('sha1').update(input).digest('hex')
}

function buildFingerprint(value) {
  return sha1(typeof value === 'string' ? value : JSON.stringify(value))
}

function clampToken(value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    return 0
  }
  if (numberValue <= 0) {
    return 0
  }
  return Math.floor(numberValue)
}

function normalizeToIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00.000Z`
  }

  const date = new Date(raw)
  if (Number.isNaN(date.valueOf())) {
    return null
  }

  return date.toISOString()
}

function normalizeTimestamp(value, fallbackMs = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(millis)
    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString()
    }
  }

  if (typeof value === 'string') {
    const maybeIso = normalizeToIso(value)
    if (maybeIso) {
      return maybeIso
    }

    if (/^\d+$/.test(value.trim())) {
      return normalizeTimestamp(Number(value.trim()), fallbackMs)
    }
  }

  return new Date(fallbackMs).toISOString()
}

function toMs(isoOrNull) {
  if (!isoOrNull) return null
  const ms = Date.parse(isoOrNull)
  return Number.isNaN(ms) ? null : ms
}

function shouldIncludeEvent(eventIso, cutoffIso) {
  if (!cutoffIso) return true
  const eventMs = toMs(eventIso)
  const cutoffMs = toMs(cutoffIso)
  if (eventMs === null || cutoffMs === null) return true
  return eventMs > cutoffMs
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function* walkFiles(rootDir) {
  if (!(await pathExists(rootDir))) {
    return
  }

  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile()) {
        yield fullPath
      }
    }
  }
}

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function loadState(statePath) {
  const defaultState = {
    version: 1,
    sources: {
      claude: { lastOccurredAt: null },
      codex: { lastOccurredAt: null },
      opencode: { lastOccurredAt: null },
    },
  }

  try {
    const content = await fs.readFile(statePath, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') {
      return defaultState
    }

    return {
      version: 1,
      sources: {
        claude: {
          lastOccurredAt: normalizeToIso(parsed.sources?.claude?.lastOccurredAt || '') || null,
        },
        codex: {
          lastOccurredAt: normalizeToIso(parsed.sources?.codex?.lastOccurredAt || '') || null,
        },
        opencode: {
          lastOccurredAt: normalizeToIso(parsed.sources?.opencode?.lastOccurredAt || '') || null,
        },
      },
    }
  } catch {
    return defaultState
  }
}

async function saveState(statePath, state) {
  const dir = path.dirname(statePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')
}

function getCutoff(source, args, state) {
  if (args.full) return null
  if (args.since) return args.since
  return state.sources[source]?.lastOccurredAt ?? null
}

function makeEvent({
  source,
  model,
  provider,
  input,
  output,
  cacheRead,
  cacheWrite,
  occurredAt,
  eventId,
  metadata,
}) {
  const cleanModel = typeof model === 'string' && model.trim() ? model.trim() : 'unknown'
  const cleanProvider = typeof provider === 'string' && provider.trim() ? provider.trim() : 'unknown'
  const cleanMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && value !== ''))
      : null

  return {
    eventId,
    model: cleanModel,
    provider: cleanProvider,
    source,
    input: clampToken(input),
    output: clampToken(output),
    cacheRead: clampToken(cacheRead),
    cacheWrite: clampToken(cacheWrite),
    occurredAt,
    metadata: cleanMetadata && Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
  }
}

async function collectClaudeEvents(cutoffIso) {
  const root = path.join(os.homedir(), '.claude', 'projects')
  const events = []
  const stats = { files: 0, parsed: 0, skipped: 0 }

  for await (const filePath of walkFiles(root)) {
    if (!filePath.endsWith('.jsonl')) continue

    stats.files += 1

    let fallbackMs = Date.now()
    try {
      const fileStat = await fs.stat(filePath)
      fallbackMs = fileStat.mtimeMs
    } catch {
      // noop
    }

    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let entry
      try {
        entry = JSON.parse(trimmed)
      } catch {
        stats.skipped += 1
        continue
      }

      if (entry?.type !== 'assistant') continue

      const usage = entry?.message?.usage
      const model = entry?.message?.model
      if (!usage || typeof usage !== 'object' || typeof model !== 'string' || !model.trim()) {
        continue
      }

      const occurredAt = normalizeTimestamp(entry.timestamp, fallbackMs)
      if (!shouldIncludeEvent(occurredAt, cutoffIso)) {
        continue
      }

      const msgId = typeof entry?.message?.id === 'string' ? entry.message.id : ''
      const reqId = typeof entry?.requestId === 'string' ? entry.requestId : ''
      const fallbackId = buildFingerprint(trimmed)
      const eventId = msgId && reqId ? `claude:${msgId}:${reqId}` : `claude:${fallbackId}`

      const event = makeEvent({
        source: 'claude',
        model,
        provider: 'anthropic',
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens,
        occurredAt,
        eventId,
      })

      const total = event.input + event.output + event.cacheRead + event.cacheWrite
      if (total <= 0) continue

      events.push(event)
      stats.parsed += 1
    }
  }

  return { events, stats }
}

function extractCodexModel(payload) {
  if (!payload || typeof payload !== 'object') return null
  const model = payload.model ?? payload.model_name ?? payload.info?.model ?? payload.info?.model_name
  return typeof model === 'string' && model.trim() ? model.trim() : null
}

function extractCodexUsage(info, previousTotals) {
  if (!info || typeof info !== 'object') {
    return null
  }

  const readCached = (obj) => {
    if (!obj || typeof obj !== 'object') return 0
    return clampToken(obj.cached_input_tokens ?? obj.cache_read_input_tokens)
  }

  if (info.last_token_usage && typeof info.last_token_usage === 'object') {
    const totalInput = clampToken(info.last_token_usage.input_tokens)
    const cached = readCached(info.last_token_usage)
    return {
      input: Math.max(totalInput - cached, 0),
      output: clampToken(info.last_token_usage.output_tokens),
      cacheRead: cached,
      cacheWrite: 0,
      totals: previousTotals,
    }
  }

  if (info.total_token_usage && typeof info.total_token_usage === 'object') {
    const currentTotal = {
      input: clampToken(info.total_token_usage.input_tokens),
      output: clampToken(info.total_token_usage.output_tokens),
      cacheRead: readCached(info.total_token_usage),
    }

    if (!previousTotals) {
      return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totals: currentTotal,
      }
    }

    const deltaInput = Math.max(currentTotal.input - previousTotals.input, 0)
    const deltaOutput = Math.max(currentTotal.output - previousTotals.output, 0)
    const deltaCached = Math.max(currentTotal.cacheRead - previousTotals.cacheRead, 0)

    return {
      input: Math.max(deltaInput - deltaCached, 0),
      output: deltaOutput,
      cacheRead: deltaCached,
      cacheWrite: 0,
      totals: currentTotal,
    }
  }

  return null
}

async function collectCodexEvents(cutoffIso) {
  const roots = [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]

  const events = []
  const stats = { files: 0, parsed: 0, skipped: 0 }

  for (const root of roots) {
    for await (const filePath of walkFiles(root)) {
      if (!filePath.endsWith('.jsonl')) continue

      stats.files += 1

      let fallbackMs = Date.now()
      try {
        const fileStat = await fs.stat(filePath)
        fallbackMs = fileStat.mtimeMs
      } catch {
        // noop
      }

      const stream = createReadStream(filePath, { encoding: 'utf8' })
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

      let currentModel = null
      let previousTotals = null

      for await (const line of rl) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let entry
        try {
          entry = JSON.parse(trimmed)
        } catch {
          stats.skipped += 1
          continue
        }

        const payload = entry?.payload

        if (entry?.type === 'turn_context' && payload) {
          currentModel = extractCodexModel(payload) || currentModel
          continue
        }

        if (entry?.type !== 'event_msg' || payload?.type !== 'token_count') {
          continue
        }

        currentModel = extractCodexModel(payload) || currentModel

        if (payload?.info?.model && typeof payload.info.model === 'string') {
          currentModel = payload.info.model
        }
        if (payload?.info?.model_name && typeof payload.info.model_name === 'string') {
          currentModel = payload.info.model_name
        }

        const usage = extractCodexUsage(payload?.info, previousTotals)
        if (!usage) continue

        if (usage.totals) {
          previousTotals = usage.totals
        }

        const model = currentModel || 'unknown'
        const occurredAt = normalizeTimestamp(entry.timestamp, fallbackMs)
        if (!shouldIncludeEvent(occurredAt, cutoffIso)) {
          continue
        }

        const event = makeEvent({
          source: 'codex',
          model,
          provider: 'openai',
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          occurredAt,
          eventId: `codex:${buildFingerprint(trimmed)}`,
        })

        const total = event.input + event.output + event.cacheRead + event.cacheWrite
        if (total <= 0) continue

        events.push(event)
        stats.parsed += 1
      }
    }
  }

  return { events, stats }
}

async function collectOpenCodeFromSqlite(dbPath, cutoffIso) {
  const events = []
  const stats = { rows: 0, parsed: 0, skipped: 0 }
  const dedup = new Set()

  let db
  try {
    db = new Database(dbPath, { readOnly: true })
  } catch {
    return { events, stats, dedup }
  }

  try {
    const query = `
      SELECT m.id AS id, m.session_id AS session_id, m.data AS data
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(m.data, '$.tokens') IS NOT NULL
    `

    const rows = db.prepare(query).all()
    stats.rows = rows.length

    for (const row of rows) {
      let payload
      try {
        payload = JSON.parse(row.data)
      } catch {
        stats.skipped += 1
        continue
      }

      const tokens = payload?.tokens
      const model = payload?.modelID
      if (!tokens || typeof model !== 'string' || !model.trim()) {
        continue
      }

      const cache = tokens.cache ?? {}
      const occurredAt = normalizeTimestamp(payload?.time?.created, Date.now())
      if (!shouldIncludeEvent(occurredAt, cutoffIso)) {
        continue
      }

      const id = typeof row.id === 'string' && row.id ? row.id : sha1(JSON.stringify(payload))
      dedup.add(id)

      const event = makeEvent({
        source: 'opencode',
        model,
        provider: payload?.providerID,
        input: tokens.input,
        output: tokens.output,
        cacheRead: cache.read,
        cacheWrite: cache.write,
        occurredAt,
        eventId: `opencode:${id}`,
        metadata: {
          sessionId: typeof row.session_id === 'string' ? row.session_id : payload?.sessionID ?? null,
          agent: payload?.mode ?? payload?.agent ?? null,
          storage: 'sqlite',
        },
      })

      const total = event.input + event.output + event.cacheRead + event.cacheWrite
      if (total <= 0) continue

      events.push(event)
      stats.parsed += 1
    }
  } finally {
    db.close()
  }

  return { events, stats, dedup }
}

async function collectOpenCodeFromLegacyJson(rootDir, cutoffIso, dedupSet) {
  const events = []
  const stats = { files: 0, parsed: 0, skipped: 0 }

  for await (const filePath of walkFiles(rootDir)) {
    if (!filePath.endsWith('.json')) continue

    stats.files += 1
    const payload = await readJsonFile(filePath)
    if (!payload || typeof payload !== 'object') {
      stats.skipped += 1
      continue
    }

    if (payload.role !== 'assistant') continue
    const tokens = payload.tokens
    const model = payload.modelID

    if (!tokens || typeof model !== 'string' || !model.trim()) {
      continue
    }

    const cache = tokens.cache ?? {}
    const occurredAt = normalizeTimestamp(payload?.time?.created, Date.now())
    if (!shouldIncludeEvent(occurredAt, cutoffIso)) {
      continue
    }

    const fileBasedId = path.basename(filePath, '.json')
    const messageId = typeof payload.id === 'string' && payload.id ? payload.id : fileBasedId

    if (dedupSet.has(messageId)) {
      continue
    }

    const event = makeEvent({
      source: 'opencode',
      model,
      provider: payload.providerID,
      input: tokens.input,
      output: tokens.output,
      cacheRead: cache.read,
      cacheWrite: cache.write,
      occurredAt,
      eventId: `opencode:${messageId}`,
      metadata: {
        sessionId: payload.sessionID ?? null,
        agent: payload.mode ?? payload.agent ?? null,
        storage: 'json',
      },
    })

    const total = event.input + event.output + event.cacheRead + event.cacheWrite
    if (total <= 0) continue

    events.push(event)
    stats.parsed += 1
  }

  return { events, stats }
}

async function collectOpenCodeEvents(cutoffIso) {
  const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
  const jsonRoot = path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'message')

  const sqliteExists = await pathExists(dbPath)
  const jsonExists = await pathExists(jsonRoot)

  const allEvents = []
  const summary = {
    sqlite: { rows: 0, parsed: 0, skipped: 0 },
    json: { files: 0, parsed: 0, skipped: 0 },
  }

  const dedup = new Set()

  if (sqliteExists) {
    const { events, stats, dedup: sqliteDedup } = await collectOpenCodeFromSqlite(dbPath, cutoffIso)
    for (const key of sqliteDedup) dedup.add(key)
    allEvents.push(...events)
    summary.sqlite = stats
  }

  if (jsonExists) {
    const { events, stats } = await collectOpenCodeFromLegacyJson(jsonRoot, cutoffIso, dedup)
    allEvents.push(...events)
    summary.json = stats
  }

  return { events: allEvents, stats: summary }
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

async function uploadEvents(events, args) {
  if (events.length === 0) {
    return { uploaded: 0, inserted: 0, duplicates: 0, batches: 0 }
  }

  if (args.dryRun) {
    return { uploaded: events.length, inserted: 0, duplicates: 0, batches: 0 }
  }

  const chunks = chunkArray(events, args.batchSize)
  let uploaded = 0
  let inserted = 0
  let duplicates = 0

  for (const [index, chunk] of chunks.entries()) {
    const headers = {
      'content-type': 'application/json',
    }

    if (args.token) {
      headers.authorization = `Bearer ${args.token}`
    }

    const response = await fetch(args.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: chunk }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Upload failed on batch ${index + 1}/${chunks.length}: HTTP ${response.status} ${text}`)
    }

    const result = await response.json()
    uploaded += chunk.length
    inserted += Number(result.inserted ?? 0)
    duplicates += Number(result.duplicates ?? 0)

    console.log(
      `[upload] batch ${index + 1}/${chunks.length} uploaded=${chunk.length} inserted=${result.inserted ?? 0} duplicates=${result.duplicates ?? 0}`,
    )
  }

  return { uploaded, inserted, duplicates, batches: chunks.length }
}

function groupBySource(events) {
  const grouped = {
    claude: [],
    codex: [],
    opencode: [],
  }

  for (const event of events) {
    if (event.source in grouped) {
      grouped[event.source].push(event)
    }
  }

  return grouped
}

function maxOccurredAt(events) {
  let maxMs = null
  for (const event of events) {
    const ms = toMs(event.occurredAt)
    if (ms === null) continue
    if (maxMs === null || ms > maxMs) maxMs = ms
  }
  return maxMs === null ? null : new Date(maxMs).toISOString()
}

function sortEventsByTime(events) {
  return events.sort((a, b) => {
    const aMs = toMs(a.occurredAt) ?? 0
    const bMs = toMs(b.occurredAt) ?? 0
    if (aMs === bMs) {
      return a.eventId.localeCompare(b.eventId)
    }
    return aMs - bMs
  })
}

async function main() {
  const args = parseArgs(process.argv)
  const state = await loadState(args.stateFile)

  console.log(`[sync] endpoint=${args.endpoint}`)
  console.log(`[sync] sources=${args.sources.join(',')} dryRun=${args.dryRun} full=${args.full}`)

  const sourceResults = {}
  const allEvents = []

  for (const source of args.sources) {
    const cutoffIso = getCutoff(source, args, state)
    console.log(`[collect] source=${source} cutoff=${cutoffIso ?? 'none'}`)

    if (source === 'claude') {
      const result = await collectClaudeEvents(cutoffIso)
      sourceResults.claude = result
      allEvents.push(...result.events)
      console.log(`[collect] source=claude files=${result.stats.files} parsed=${result.stats.parsed} skipped=${result.stats.skipped}`)
      continue
    }

    if (source === 'codex') {
      const result = await collectCodexEvents(cutoffIso)
      sourceResults.codex = result
      allEvents.push(...result.events)
      console.log(`[collect] source=codex files=${result.stats.files} parsed=${result.stats.parsed} skipped=${result.stats.skipped}`)
      continue
    }

    if (source === 'opencode') {
      const result = await collectOpenCodeEvents(cutoffIso)
      sourceResults.opencode = result
      allEvents.push(...result.events)
      console.log(
        `[collect] source=opencode sqlite(parsed=${result.stats.sqlite.parsed}/${result.stats.sqlite.rows}) json(parsed=${result.stats.json.parsed}/${result.stats.json.files})`,
      )
    }
  }

  const dedupMap = new Map()
  for (const event of allEvents) {
    dedupMap.set(event.eventId, event)
  }

  const uniqueEvents = sortEventsByTime([...dedupMap.values()])

  console.log(`[collect] total=${allEvents.length} unique=${uniqueEvents.length}`)

  const uploadSummary = await uploadEvents(uniqueEvents, args)

  if (args.dryRun) {
    console.log(`[dry-run] parsed=${uniqueEvents.length} (no upload, no state update)`)
    return
  }

  const grouped = groupBySource(uniqueEvents)
  for (const source of args.sources) {
    const sourceMax = maxOccurredAt(grouped[source] ?? [])
    if (sourceMax) {
      state.sources[source].lastOccurredAt = sourceMax
    }
  }

  await saveState(args.stateFile, state)

  console.log(
    `[done] uploaded=${uploadSummary.uploaded} inserted=${uploadSummary.inserted} duplicates=${uploadSummary.duplicates} batches=${uploadSummary.batches}`,
  )
  console.log(`[done] state saved to ${args.stateFile}`)
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
