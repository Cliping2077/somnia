/**
 * DSH adapter for @somnia/core.
 *
 * The sleep loop lives in ./core.js. This file only wires DSH events, the model,
 * prompt injection, and the memory tool. Porting to another host means replacing
 * this file, not core.js.
 */
import os from 'node:os'
import path from 'node:path'
import { createSomnia } from './core.js'

export const name = 'memory'
export const inject = ['tools', 'systemPrompt']

const DREAM_COOLDOWN_MS = 5 * 60 * 1000

async function callModel(services, system, userText, maxTokens) {
  const llm = services.llm
  const selection = services.defaultModel && typeof services.defaultModel.currentSelection === 'function'
    ? services.defaultModel.currentSelection()
    : undefined
  if (!llm || selection === undefined || !selection.provider || !selection.model) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  let text = ''
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
      if (chunk && chunk.type === 'text-delta') text += chunk.text
    }
  } finally {
    clearTimeout(timer)
  }
  return text
}

export function apply(ctx, config) {
  const somnia = createSomnia({
    dir: path.join(os.homedir(), '.dsh', 'memory'),
    generate: async ({ system, user, maxTokens }) => {
      const services = { llm: ctx.get('llm'), defaultModel: ctx.get('agentDefaultModel') }
      return (await callModel(services, system, user, maxTokens)) ?? ''
    },
  })

  // Legacy test value (30 seconds) must not ship; production default is 10 minutes.
  if (somnia.state().idleMinutes < 1) somnia.setIdleMinutes(10)

  const configuredIdle = Number(config && config.idleMinutes)
  if (Number.isFinite(configuredIdle) && configuredIdle > 0) somnia.setIdleMinutes(configuredIdle)

  const timers = new Map()
  const clearTimer = (agent) => {
    const timer = timers.get(agent.id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(agent.id)
    }
  }
  const scheduleDream = (agent) => {
    clearTimer(agent)
    const idleMinutes = somnia.state().idleMinutes
    if (idleMinutes <= 0) return
    const timer = setTimeout(() => {
      timers.delete(agent.id)
      if (agent.status !== 'idle') return
      if (Date.now() - somnia.state().lastDreamAt < DREAM_COOLDOWN_MS) return
      void somnia.dream('idle')
    }, idleMinutes * 60 * 1000)
    timers.set(agent.id, timer)
  }

  ctx.on('agent/status', (payload) => {
    if (payload.status === 'idle') {
      somnia.setState('asleep')
      scheduleDream(payload.agent)
    } else {
      somnia.setState('awake')
      clearTimer(payload.agent)
    }
  })
  ctx.on('agent/inbox/inserted', (payload) => {
    if (payload.message && payload.message.source !== undefined && payload.message.source.kind === 'user') {
      somnia.setState('awake')
    }
  })
  // Broad capture; the nap decides what survives.
  ctx.on('session/event', (session, event) => {
    if (event === null || typeof event !== 'object' || event.type !== 'user/message') return
    // A user/message event carries the message as its data.
    const message = event.data
    if (message === null || typeof message !== 'object') return
    if (message.source !== undefined && message.source.kind !== 'user') return
    const blocks = Array.isArray(message.content) ? message.content : []
    const text = blocks.filter((block) => block && block.type === 'text').map((block) => block.text).join(' ').trim()
    if (text.length < 6 || text.length > 600) return
    if (/^[/<\[]/.test(text)) return
    somnia.capture(session && session.id ? String(session.id) : '', text)
  })
  ctx.on('agent/disposed', (payload) => clearTimer(payload.agent))
  ctx.effect(() => () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }, 'memory: dream timers')

  ctx.systemPrompt.section({
    name: 'memory:index',
    order: 850,
    text: () => somnia.injectText(),
  })

  ctx.tools.register({
    name: 'memory',
    description:
      'Inspect and maintain long-term memory. The store is a synthesized summary, not a transcript. '
      + 'Actions: save (add a foreground entry), search, list (with status filter), hide/show an entry, forget, dream (run one nap now), wash (rewrite the summary from existing entries), state, config (idleMinutes), snapshots, restore.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['save', 'search', 'list', 'hide', 'show', 'forget', 'dream', 'wash', 'state', 'config', 'snapshots', 'restore'], description: 'Memory operation.' },
        text: { type: 'string', description: 'Statement to save.' },
        kind: { type: 'string', enum: ['fact', 'preference', 'lesson', 'note'], description: 'Entry class; default note.' },
        confidence: { type: 'number', description: '0–1 confidence for save.' },
        query: { type: 'string', description: 'Search query.' },
        id: { type: 'string', description: 'Entry id for hide/show/forget.' },
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
      if (args.action === 'dream' || args.action === 'wash') {
        return { ok: true, action: args.action, result: { lastDreamAt: somnia.state().lastDreamAt, ...result } }
      }
      return { ok: true, action: args.action, result }
    },
  })
}
