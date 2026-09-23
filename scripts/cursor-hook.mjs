#!/usr/bin/env bun

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFingerprint, clampToken, cursorUsageDir, makeEvent } from './sync-local.mjs'

export function cursorHookEvent(payload, occurredAt = new Date().toISOString()) {
  if (payload?.hook_event_name !== 'afterAgentResponse') return null
  const cacheRead = clampToken(payload.cache_read_tokens)
  const cacheWrite = clampToken(payload.cache_write_tokens)
  const event = makeEvent({
    source: 'cursor-agent',
    provider: 'cursor',
    model: payload.model,
    input: Math.max(clampToken(payload.input_tokens) - cacheRead - cacheWrite, 0),
    output: payload.output_tokens,
    cacheRead,
    cacheWrite,
    occurredAt,
    // Include the response fingerprint: a generation can contain several messages.
    // Only this hash and numeric usage are stored, never response text or paths.
    eventId: `cursor-agent:${buildFingerprint([
      payload.conversation_id, payload.generation_id, payload.model, payload.text,
      payload.input_tokens, payload.output_tokens, payload.cache_read_tokens, payload.cache_write_tokens,
    ])}`,
  })
  return event.input + event.output + event.cacheRead + event.cacheWrite > 0 ? event : null
}

export async function installCursorHook(configPath = path.join(os.homedir(), '.cursor', 'hooks.json')) {
  let config = { version: 1, hooks: {} }
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.hooks != null && (typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) {
    throw new Error('Invalid Cursor hooks configuration; existing file was not changed')
  }
  config.hooks ??= {}
  config.version ??= 1
  const hooks = config.hooks.afterAgentResponse ?? []
  if (!Array.isArray(hooks)) throw new Error('Cursor afterAgentResponse hooks must be an array')
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
  const command = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`
  if (hooks.some((hook) => hook?.command === command)) return configPath
  hooks.push({ command })
  config.hooks.afterAgentResponse = hooks
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  const tempPath = `${configPath}.tut-${process.pid}.tmp`
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(tempPath, configPath)
  } finally {
    await fs.rm(tempPath, { force: true })
  }
  return configPath
}

async function main() {
  if (process.argv.includes('--install')) {
    console.log(`Cursor usage hook installed in ${await installCursorHook()}`)
    console.log('Restart Cursor Agent to begin recording usage for future responses.')
    return
  }
  const payload = JSON.parse(await Bun.stdin.text())
  const event = cursorHookEvent(payload)
  if (!event) return
  const root = cursorUsageDir()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  await fs.appendFile(path.join(root, 'usage.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 })
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[tut cursor hook] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
