import { apply } from './index.js'

const tool = { current: null }
const ctx = {
  on: () => {},
  get: () => null,
  effect: () => {},
  systemPrompt: { section: () => {} },
  tools: { register: (definition) => { tool.current = definition } },
}

apply(ctx, { idleMinutes: 10 })
const state = await tool.current.execute({ action: 'state' })
if (!state.ok) throw new Error('adapter state failed')
if (state.result.idleMinutes !== 10) throw new Error('idleMinutes not applied')
console.log('adapter ok', { entries: state.result.entries, episodes: state.result.episodes })
