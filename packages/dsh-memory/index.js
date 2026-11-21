/**
 * DSH adapter for @somnia/core.
 *
 * The sleep loop lives in ./core.js, a copy of packages/core/src/somnia.js kept
 * in sync by scripts/sync-core.mjs (edit the core, then run `npm run sync-core`).
 * This file only wires DSH events, the model, prompt injection, and the memory
 * tool. Porting to another host means replacing this file, not core.js.
 */
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSomnia, salienceOf } from './core.js'

export const name = 'memory'
export const inject = ['tools', 'systemPrompt']

const DREAM_COOLDOWN_MS = 6 * 60 * 60 * 1000
const MAX_TIMEOUT_MS = 2_147_483_647

export const RECALL_MARKER = '[long-term memory]'
const AUTO_RECALL_K = 6
const AUTO_RECALL_MAX_CHARS = 1400

export function messageText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content.trim()
  const blocks = Array.isArray(message.content) ? message.content : []
  return blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join(' ').trim()
}

/**
 * Build a recall preview for diagnostic and test callers. The DSH adapter
 * exposes live recall through the memory tool and system prompt section.
 */
export function buildRecallMessage(messages, somnia, opts = {}) {
  const k = Number(opts.k) > 0 ? Number(opts.k) : AUTO_RECALL_K
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : AUTO_RECALL_MAX_CHARS
  if (!Array.isArray(messages)) return null
  if (messages.some((message) => messageText(message).includes(RECALL_MARKER))) return null
  const text = messages
    .filter((message) => message && message.role === 'user' && (!message.source || message.source.kind === 'user'))
    .map(messageText)
    .join('\n')
    .trim()
  if (text.length < 8) return null
  const recall = somnia.retrieve(text, k)
  const entries = (recall.entries || []).filter((entry) => !entry.superseded)
  // Raw episodes are evidence, not memory: only durable, non-question episodes may be
  // injected, and at most two. Chatter ("...怎么样", "...吗？") stays out.
  const episodes = (recall.episodes || [])
    .filter((episode) => typeof episode.text === 'string'
      && episode.text.length <= 200
      && !/[?？]\s*$/.test(episode.text)
      && salienceOf(episode.text) >= 1.5)
    .slice(0, 2)
  const parts = [...entries, ...episodes]
    .map((entry) => entry && entry.text)
    .filter((value) => typeof value === 'string' && value.length > 0)
  if (parts.length === 0) return null
  const block = `${RECALL_MARKER} relevant long-term memory (use silently; do not repeat it to the user):\n`
    + parts.map((value) => `- ${value}`).join('\n')
  return {
    id: randomUUID(),
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: block.slice(0, maxChars) }],
  }
}

async function callModel(services, system, userText, maxTokens, signal) {
  const llm = services.llm
  const selection = services.defaultModel && typeof services.defaultModel.currentSelection === 'function'
    ? services.defaultModel.currentSelection()
    : undefined
  if (typeof llm?.stream !== 'function' || !selection?.provider || !selection.model || signal?.aborted) return null
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  signal?.addEventListener('abort', interrupt, { once: true })
  const timer = setTimeout(() => controller.abort(), 90000)
  timer.unref()
  let text = ''
  let usage = null
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens: maxTokens || 2000,
      temperature: 0.2,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (controller.signal.aborted) break
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk && chunk.usage) usage = chunk.usage
      else if (chunk && chunk.data && chunk.data.usage) usage = chunk.data.usage
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', interrupt)
  }
  return { text, usage }
}

export function apply(ctx, config) {
  const dir = (config && typeof config.dir === 'string' && config.dir.length > 0)
    ? config.dir
    : path.join(os.homedir(), '.dsh', 'memory')
  const somnia = createSomnia({
    dir,
    embed: (config && typeof config.embed === 'function') ? config.embed : undefined,
    generate: async ({ system, user, maxTokens, signal }) => {
      const services = { llm: ctx.get('llm'), defaultModel: ctx.get('agentDefaultModel') }
      const result = await callModel(services, system, user, maxTokens, signal)
      return result || { text: '', usage: null }
    },
  })

  const configuredIdle = Number(config?.idleMinutes ?? NaN)
  if (Number.isFinite(configuredIdle) && configuredIdle >= 0) somnia.setIdleMinutes(configuredIdle)
  const configuredCooldown = Number(config?.dreamCooldownMinutes) * 60 * 1000
  const cooldownMs = Number.isFinite(configuredCooldown)
    ? Math.max(DREAM_COOLDOWN_MS, configuredCooldown)
    : DREAM_COOLDOWN_MS

  // The adapter has one shared memory store, so it may dream only when every
  // agent with an observed status is idle.
  const statuses = new Map()
  let timer = null
  let idleSince = null
  let dreamAttempted = false

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const dreamDeadline = () => {
    const { idleMinutes, lastDreamAt, lastAttemptAt, paused } = somnia.state()
    if (idleSince === null || dreamAttempted || paused || idleMinutes <= 0) return null
    const idleDelay = idleMinutes * 60 * 1000
    if (!Number.isFinite(idleDelay)) return null
    const lastRun = Math.max(lastDreamAt, lastAttemptAt)
    return Math.max(idleSince + idleDelay, lastRun ? lastRun + cooldownMs : 0)
  }

  const scheduleDream = () => {
    clearTimer()
    const dueAt = dreamDeadline()
    if (dueAt === null) return
    timer = setTimeout(() => {
      timer = null
      const currentDeadline = dreamDeadline()
      if (currentDeadline === null) return
      if (Date.now() < currentDeadline) {
        scheduleDream()
        return
      }
      dreamAttempted = true
      void somnia.dream('idle').catch(() => console.warn('Somnia idle consolidation failed.'))
    }, Math.min(MAX_TIMEOUT_MS, Math.max(0, dueAt - Date.now())))
    timer.unref()
  }

  const beginIdle = () => {
    if (idleSince !== null || statuses.size === 0 || [...statuses.values()].some((status) => status !== 'idle')) return
    idleSince = Date.now()
    dreamAttempted = false
    somnia.setState('asleep')
    scheduleDream()
  }

  const wake = () => {
    clearTimer()
    idleSince = null
    somnia.interruptDream()
    somnia.setState('awake')
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (agent?.id === undefined) return
    statuses.set(agent.id, status)
    if (status === 'idle') beginIdle()
    else wake()
  })
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message?.source?.kind !== 'user') return
    if (agent?.id !== undefined) statuses.set(agent.id, 'running')
    wake()
  })
  // Broad capture; the nap decides what survives.
  ctx.on('session/event', (session, event) => {
    if (event === null || typeof event !== 'object' || event.type !== 'user/message') return
    // A user/message event carries the message as its data.
    const message = event.data
    if (message === null || typeof message !== 'object') return
    if (message.source && message.source.kind !== 'user') return
    const text = messageText(message)
    if (text.length < 6 || text.length > 600) return
    if (/^[/<\[]/.test(text)) return
    somnia.capture(session && session.id ? String(session.id) : '', text)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    if (!statuses.delete(agent?.id)) return
    if (statuses.size === 0) wake()
    else beginIdle()
  })
  ctx.effect(() => () => {
    clearTimer()
    statuses.clear()
    somnia.interruptDream()
  }, 'memory: dream timers')

  ctx.systemPrompt.section({
    name: 'memory:index',
    order: 850,
    // Pass the session's working directory so scope-relevant entries rank first; a context that an
    // entry explicitly excludes drops it from the injection.
    text: () => {
      let context = ''
      try {
        const agent = ctx.agents && typeof ctx.agents.currentInitiator === 'function' ? ctx.agents.currentInitiator() : undefined
        const session = agent && agent.session ? agent.session : undefined
        if (session && ctx.workingDirectory && typeof ctx.workingDirectory.get === 'function') context = String(ctx.workingDirectory.get(session))
      } catch (error) {
        context = ''
      }
      return somnia.injectText(context)
    },
  })

  // NOTE: per-step retrieval used to prepend a user-role message here, which the Web
  // transcript rendered as a visible bubble. User-role messages are surface events, not
  // hidden context; use the invisible channels instead (system prompt section + the
  // memory tool's recall action). Do not re-add a user message here.

  ctx.tools.register({
    name: 'memory',
    description:
      'Inspect and maintain long-term memory. Pinned and profile entries are injected verbatim; the rest is a summary. '
      + 'Actions: save (add a foreground entry, optionally pinned), search (entries), recall (entries + episodes, including archive), list (with status filter), pin/unpin, hide/show, forget, edit (change text or scope), source (why an entry exists), pause/resume (stop or restore injection), export (write a markdown dump), dream, wash, state, config (idleMinutes), snapshots, restore.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['save', 'search', 'recall', 'list', 'hide', 'show', 'pin', 'forget', 'edit', 'source', 'pause', 'resume', 'export', 'dream', 'wash', 'state', 'config', 'snapshots', 'restore'], description: 'Memory operation.' },
        text: { type: 'string', description: 'Statement to save, or the replacement text for edit.' },
        scope: {
          type: 'object',
          additionalProperties: false,
          description: 'Applicability for edit: the object it applies to and the situation.',
          properties: {
            object: { type: 'string' },
            situation: { type: 'string' },
            excludes: { type: 'string' },
          },
        },
        kind: { type: 'string', enum: ['fact', 'preference', 'lesson', 'note'], description: 'Entry class; default note.' },
        confidence: { type: 'number', description: '0–1 confidence for save.' },
        pinned: { type: 'boolean', description: 'Pin on save/pin: pinned entries survive rewrites and are injected verbatim.' },
        subject: { type: 'string', description: 'Subject key for factual entries; entries sharing a subject with a newer value are marked superseded.' },
        query: { type: 'string', description: 'Search query.' },
        id: { type: 'string', description: 'Entry id for pin/hide/show/forget.' },
        status: { type: 'string', enum: ['foreground', 'background'], description: 'Filter for list.' },
        limit: { type: 'number', description: 'Result cap.' },
        idleMinutes: { type: 'number', description: 'Idle minutes before a nap; 0 disables.' },
        name: { type: 'string', description: 'Snapshot file name for restore.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          result: { description: 'Action-specific JSON result.' },
        },
        required: ['ok', 'action'],
      },
      render: (_args, value) => {
        const text = typeof value.result === 'string' ? value.result : JSON.stringify(value.result, null, 2)
        return [{ type: 'text', text: text.length > 16000 ? `${text.slice(0, 16000)}\n…[truncated]` : text }]
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const result = await somnia.action(args)
      if (args.action === 'config' || args.action === 'pause' || args.action === 'resume') scheduleDream()
      if (args.action === 'dream' || args.action === 'wash') {
        return { ok: true, action: args.action, result: { lastDreamAt: somnia.state().lastDreamAt, ...result } }
      }
      return { ok: true, action: args.action, result }
    },
  })
}
