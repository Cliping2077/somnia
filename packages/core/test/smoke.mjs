import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createSomnia } from '../src/somnia.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-'))
let calls = 0

const generate = async ({ system, user }) => {
  calls += 1
  assert.match(system, /applying operations/)
  const payload = JSON.parse(user)
  assert.ok(Array.isArray(payload.existing))
  const [episode] = payload.episodes
  return JSON.stringify({
    ops: [{
      op: 'add',
      section: 'preferences',
      text: '不吃辣',
      scope: { object: '食物', situation: '点餐时' },
      quote: episode.text,
      episodes: [episode.id],
      confidence: 0.9,
    }],
  })
}

const somnia = createSomnia({ dir, generate })

assert.equal(somnia.capture('s1', '用户说：以后我都不吃辣，记住'), true)
assert.equal(somnia.capture('s1', 'x'), false)
assert.equal(somnia.episodes().length, 1)

const result = await somnia.dream('manual')
assert.equal(result.engine, 'model')
assert.equal(result.entries, 1)
assert.equal(calls, 1)

assert.match(somnia.injectText(), /不吃辣/)
assert.equal(somnia.memory().entries.length, 1)
assert.ok(fs.existsSync(path.join(dir, 'memory.json')))
assert.ok(fs.existsSync(path.join(dir, 'dream-report.md')))
assert.ok(fs.readdirSync(path.join(dir, 'snapshots')).length >= 1)

const saved = await somnia.action({ action: 'save', text: '交付前自查间距', kind: 'lesson' })
assert.ok(saved.id)
assert.ok((await somnia.action({ action: 'search', query: '间距' })).length >= 1)

const snapshots = await somnia.action({ action: 'snapshots' })
assert.ok(snapshots.length >= 1)
const restored = await somnia.action({ action: 'restore', name: snapshots[0] })
assert.equal(restored.entries, 1)

await somnia.action({ action: 'config', idleMinutes: 10 })
assert.equal(somnia.state().idleMinutes, 10)

console.log('ok', { entries: somnia.memory().entries.length, snapshots: snapshots.length, calls })
fs.rmSync(dir, { recursive: true, force: true })
