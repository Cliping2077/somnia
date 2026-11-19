import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { apply, buildRecallMessage, RECALL_MARKER } from './index.js'
import { createSomnia } from './core.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-adapter-'))
const tool = { current: null }
const handlers = {}
const ctx = {
  on: (name, fn) => { handlers[name] = fn },
  get: () => null,
  effect: () => {},
  systemPrompt: { section: () => {} },
  tools: { register: (definition) => { tool.current = definition } },
}

apply(ctx, { idleMinutes: 10, dir, embed: () => [1, 0, 0] })
const state = await tool.current.execute({ action: 'state' })
if (!state.ok) throw new Error('adapter state failed')
if (state.result.idleMinutes !== 10) throw new Error('idleMinutes not applied')

const sessionEvent = handlers['session/event']
assert.equal(typeof sessionEvent, 'function', 'session/event handler must be registered')

// regression: no user-role message may be injected into agent/pre-step (it renders in the
// transcript). Retrieval is exposed through the system prompt and the memory tool only.
assert.equal(handlers['agent/pre-step'], undefined, 'agent/pre-step must not be registered (visible-injection bug)')

// knowledge update: newer subject value is current, superseded value is filtered
await tool.current.execute({ action: 'save', text: '出口用动态 IP', kind: 'fact', subject: '出口IP', confidence: 0.9 })
await new Promise((resolve) => setTimeout(resolve, 5))
await tool.current.execute({ action: 'save', text: '出口改用静态 IP', kind: 'fact', subject: '出口IP', confidence: 0.9 })

const userMessage = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '出口现在用什么 IP' }] }
const injected = buildRecallMessage([userMessage], createSomnia({ dir }))
assert.ok(injected && injected.content[0].text.includes(RECALL_MARKER))
assert.ok(injected.content[0].text.includes('静态'))
assert.ok(!injected.content[0].text.includes('动态'), 'superseded value must be filtered out')

const guarded = buildRecallMessage([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: RECALL_MARKER + ' 已注入' }] }], createSomnia({ dir }))
assert.equal(guarded, null, 'marker-bearing step must not re-inject')

// quality: raw chatter episodes must not enter the recall block; curated facts must
for (const chatter of ['发布到 GitHub 了吗？', '那么，你现在再看看这个余额功能怎么样']) {
  sessionEvent({ id: 'chatter' }, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: chatter }] } })
}
await tool.current.execute({ action: 'save', text: 'Somnia v1.0.0 已发布到 GitHub', kind: 'fact', confidence: 0.9 })
const quality = buildRecallMessage([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '发布 GitHub' }] }], createSomnia({ dir }))
const qualityText = quality && quality.content[0].text ? quality.content[0].text : ''
assert.ok(qualityText.includes('Somnia v1.0.0'), 'curated fact must be recalled')
assert.ok(!qualityText.includes('余额功能怎么样'), 'chatter must not be injected')
assert.ok(!qualityText.includes('了吗'), 'question form must not be injected')

// session/event capture: a user message must be written to the episodic buffer
const beforeEpisodes = (await tool.current.execute({ action: 'state' })).result.episodes
sessionEvent({ id: 'sess-test' }, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记住：出口现在用静态 IP' }] } })
const afterEpisodes = (await tool.current.execute({ action: 'state' })).result.episodes
assert.ok(afterEpisodes > beforeEpisodes, 'session/event must capture a user message as an episode')

fs.rmSync(dir, { recursive: true, force: true })
console.log('adapter ok', { entries: state.result.entries, episodes: state.result.episodes, visibleInjection: false, capture: true })
