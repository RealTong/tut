import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectCursorEvents, collectGrokEvents, collectPiEvents, loadState } from './sync-local.mjs'
import { cursorHookEvent, installCursorHook } from './cursor-hook.mjs'

let root
const timestamp = '2026-09-23T10:00:00.000Z'
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'tut-sync-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function jsonl(relative, entries) {
  const target = path.join(root, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, entries.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n'))
  return target
}

const assistant = {
  type: 'message', id: 'a1', timestamp,
  message: {
    role: 'assistant', model: 'claude-sonnet-4', provider: 'anthropic', timestamp: Date.parse(timestamp),
    content: [{ type: 'text', text: 'private response' }],
    usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 5, totalTokens: 205, reasoning: 10 },
  },
}

test('pi preserves disjoint token buckets and gives forked entries the same event ID', async () => {
  await jsonl('pi/a.jsonl', [
    { type: 'session', id: 'first', timestamp },
    { type: 'message', message: { role: 'user', usage: { input: 999 } } },
    assistant, '{partial',
  ])
  await jsonl('pi/fork.jsonl', [{ type: 'session', id: 'fork', timestamp }, assistant])
  const result = await collectPiEvents('pi', null, path.join(root, 'pi'))
  expect(result.events).toHaveLength(2)
  expect(new Set(result.events.map((event) => event.eventId)).size).toBe(1)
  expect(result.events[0]).toMatchObject({ source: 'pi', input: 100, output: 20, cacheRead: 80, cacheWrite: 5, occurredAt: timestamp })
  expect(JSON.stringify(result.events)).not.toContain('private response')
  expect(result.stats.skipped).toBe(1)
  expect((await collectPiEvents('pi', timestamp, path.join(root, 'pi'))).events).toHaveLength(2)
  expect((await collectPiEvents('pi', '2026-09-23T10:00:01Z', path.join(root, 'pi'))).events).toHaveLength(0)
})

test('omp includes standalone model usage and ignores user messages and zero usage', async () => {
  await jsonl('omp/session.jsonl', [
    assistant,
    { type: 'model_usage', id: 'side', timestamp, purpose: 'auto-thinking', model: 'tiny', provider: 'test', usage: { input: 3, output: 2 } },
    { ...assistant, id: 'zero', message: { ...assistant.message, usage: { input: 0, output: 0 } } },
  ])
  const result = await collectPiEvents('omp', null, path.join(root, 'omp'))
  expect(result.events).toHaveLength(2)
  expect(result.events[1]).toMatchObject({ source: 'omp', model: 'tiny', input: 3, output: 2 })
})

test('Grok counts each prompt and model once without summing aggregate or subagent totals', async () => {
  const completed = (prompt, usage, sessionId = 'session-1') => ({
    timestamp: Date.parse(timestamp) / 1000, method: '_x.ai/session/update',
    params: { sessionId, update: { sessionUpdate: 'turn_completed', prompt_id: prompt, usage } },
  })
  await jsonl('grok/project/session-1/updates.jsonl', [
    completed('p1', { inputTokens: 1000, outputTokens: 60, modelUsage: {
      'grok-build': { inputTokens: 900, outputTokens: 50, cachedReadTokens: 700, cacheCreationTokens: 50, reasoningTokens: 30 },
      'grok-small': { inputTokens: 100, outputTokens: 10 },
    } }),
    completed('p2', { inputTokens: 100, outputTokens: 20, cachedReadTokens: 80 }),
    completed('child-prompt', { inputTokens: 10000 }, 'child-session'),
    { timestamp, params: { update: { sessionUpdate: 'usage_update', usage: { inputTokens: 999999 } } } },
    '{partial',
  ])
  await writeFile(path.join(root, 'grok/project/session-1/summary.json'), JSON.stringify({ current_model_id: 'grok-fallback' }))
  const result = await collectGrokEvents(null, path.join(root, 'grok'))
  expect(result.events).toHaveLength(3)
  expect(result.events[0]).toMatchObject({ model: 'grok-build', input: 150, output: 50, cacheRead: 700, cacheWrite: 50 })
  expect(result.events[2]).toMatchObject({ model: 'grok-fallback', input: 20, output: 20, cacheRead: 80 })
  expect(result.events.reduce((total, e) => total + e.input + e.output + e.cacheRead + e.cacheWrite, 0)).toBe(1180)
  expect((await collectGrokEvents(timestamp, path.join(root, 'grok'))).events).toEqual(result.events)
  expect((await collectGrokEvents('2026-09-23T10:00:01Z', path.join(root, 'grok'))).events).toHaveLength(0)
})

const cursorPayload = {
  hook_event_name: 'afterAgentResponse', conversation_id: 'chat', generation_id: 'turn', model: 'composer-2',
  text: 'private response', workspace_roots: ['/private/project'],
  input_tokens: 1000, output_tokens: 30, cache_read_tokens: 800, cache_write_tokens: 50,
}

test('Cursor hook removes cache from input, retains stable IDs and stores no text or paths', async () => {
  const event = cursorHookEvent(cursorPayload, timestamp)
  expect(event).toMatchObject({ source: 'cursor-agent', provider: 'cursor', input: 150, output: 30, cacheRead: 800, cacheWrite: 50 })
  expect(cursorHookEvent(cursorPayload).eventId).toBe(event.eventId)
  expect(cursorHookEvent({ ...cursorPayload, text: 'another response' }).eventId).not.toBe(event.eventId)
  expect(cursorHookEvent({ hook_event_name: 'afterAgentResponse', text: 'no usage' })).toBeNull()
  expect(cursorHookEvent({ ...cursorPayload, hook_event_name: 'preCompact' })).toBeNull()
  expect(JSON.stringify(event)).not.toMatch(/private|workspace|conversation|generation/)
  await jsonl('cursor/usage.jsonl', [event, { ...event, eventId: 123 }, { ...event, source: 'other' }, '{partial'])
  const result = await collectCursorEvents(timestamp, path.join(root, 'cursor'))
  expect(result.events).toEqual([event])
  expect((await collectCursorEvents('2026-09-23T10:00:01Z', path.join(root, 'cursor'))).events).toHaveLength(0)
})

test('Cursor hook installation preserves existing hooks, is idempotent and rejects corrupt config', async () => {
  const configPath = path.join(root, 'hooks.json')
  const existing = { version: 1, hooks: { stop: [{ command: 'existing-stop' }], afterAgentResponse: [{ command: 'existing-response' }] } }
  await writeFile(configPath, JSON.stringify(existing))
  await installCursorHook(configPath)
  await installCursorHook(configPath)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  expect(config.hooks.stop).toEqual(existing.hooks.stop)
  expect(config.hooks.afterAgentResponse).toHaveLength(2)
  expect(config.hooks.afterAgentResponse[0]).toEqual(existing.hooks.afterAgentResponse[0])
  await writeFile(configPath, '{invalid')
  await expect(installCursorHook(configPath)).rejects.toThrow()
  expect(await readFile(configPath, 'utf8')).toBe('{invalid')
})

test('old checkpoints gain new sources without losing existing progress', async () => {
  const statePath = path.join(root, 'state.json')
  await writeFile(statePath, JSON.stringify({ version: 1, sources: { claude: { lastOccurredAt: timestamp } } }))
  const state = await loadState(statePath)
  expect(state.sources.claude.lastOccurredAt).toBe(timestamp)
  for (const source of ['grok', 'cursor-agent', 'pi', 'omp']) expect(state.sources[source].lastOccurredAt).toBeNull()
  expect((await collectGrokEvents(null, path.join(root, 'missing'))).events).toEqual([])
})

test('Cursor hook and sync CLI work together; dry-run does not save a checkpoint', async () => {
  const env = { ...process.env, TUT_CURSOR_USAGE_DIR: path.join(root, 'usage') }
  const hook = Bun.spawn([process.execPath, 'scripts/cursor-hook.mjs'], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  hook.stdin.write(JSON.stringify(cursorPayload))
  hook.stdin.end()
  const hookError = await new Response(hook.stderr).text()
  expect(await hook.exited, hookError).toBe(0)
  const recorded = JSON.parse(await readFile(path.join(root, 'usage/usage.jsonl'), 'utf8'))
  expect(recorded).toMatchObject({ source: 'cursor-agent', input: 150 })
  const statePath = path.join(root, 'state.json')
  const sync = Bun.spawn([process.execPath, 'scripts/sync-local.mjs', '--sources', 'cursor-agent', '--dry-run', '--state-file', statePath], { env, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(sync.stdout).text()
  expect(await sync.exited).toBe(0)
  expect(stdout).toContain('[dry-run] parsed=1')
  expect(await Bun.file(statePath).exists()).toBe(false)
})
