import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {
  applyRewrite,
  createSomnia,
  downscale,
  redactSecrets,
  salienceOf,
} from '../src/somnia.js'

// redaction
assert.ok(!redactSecrets('token sk-abcdefgh12345678').includes('abcdefgh'))
assert.ok(redactSecrets('mail me a@b.com').includes('[email]'))
assert.ok(redactSecrets('card 4111 1111 1111 1111').includes('[number]'))
assert.ok(redactSecrets('Bearer abcdefghijklmnop').includes('Bearer …'))

// salience
assert.ok(salienceOf('记住我不吃辣') >= 1)
assert.ok(salienceOf('如果我是你，也许可以') < 1)
assert.ok(salienceOf('我的偏好是中文') >= 1)
assert.ok(salienceOf('发布 v1.0.0 到仓库') >= 1.5)

// short CJK entries must survive a rewrite
const rewrite = applyRewrite({ entries: [{ section: 'preferences', text: '不吃辣' }] }, { entries: [] })
assert.equal(rewrite.entries.length, 1)

// source is kept; test-only preferences become background
const sourced = applyRewrite({
  entries: [
    { section: 'projects', text: 'Somnia v1.0.0 已发布', source: '2026-11-17T21:00:00Z' },
    { section: 'preferences', text: '测试时使用 3 分钟', source: '2026-11-16T10:00:00Z' },
  ],
}, { entries: [] }, Date.now())
assert.equal(sourced.entries[0].source, '2026-11-17T21:00:00Z')
assert.equal(sourced.entries[1].status, 'background')

// downscale: stale + unused + low confidence disappears
const now = Date.now()
const dropped = downscale([
  { section: 'notes', text: 'old', confidence: 0.1, status: 'foreground', lastUsedAt: 0, firstSeen: now - 200 * 86400000, uses: 0 },
], now)
assert.equal(dropped.length, 0)
const demoted = downscale([
  { section: 'notes', text: 'stale', confidence: 0.9, status: 'foreground', lastUsedAt: 0, firstSeen: now - 40 * 86400000, uses: 0 },
], now)
assert.equal(demoted[0].status, 'background')

// BOM in state.json must not reset the idle time
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-units-'))
fs.writeFileSync(path.join(dir, 'state.json'), '\uFEFF' + JSON.stringify({ idleMinutes: 7 }), 'utf8')
let calls = 0
const somnia = createSomnia({
  dir,
  generate: async () => {
    calls += 1
    return ''
  },
})
assert.equal(somnia.state().idleMinutes, 7)

// capture redacts before writing
somnia.capture('s', '我的 token 是 sk-abcdefgh12345678，记住')
assert.ok(!somnia.episodes()[0].text.includes('abcdefgh'))

// a failed model must fall back, not wipe
const fallback = await somnia.dream('manual')
assert.equal(fallback.engine, 'fallback')
assert.ok(somnia.memory().entries.length >= 1)
assert.equal(calls, 1)

// no new episodes since the last dream -> no second model call
const idle = await somnia.dream('manual')
assert.equal(idle.engine, 'maintenance')
assert.equal(calls, 1, 'a dream without new episodes must not spend tokens')

// usage and cost are recorded per dream
const costDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-cost-'))
const costSomnia = createSomnia({
  dir: costDir,
  generate: async () => ({
    text: JSON.stringify({
      entries: [{ section: 'projects', text: 'Somnia 已发布', source: '2026-11-17T00:00:00Z' }],
      hypotheses: [],
    }),
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 },
  }),
})
costSomnia.capture('s', '发布 Somnia 到仓库')
const costDream = await costSomnia.dream('manual')
assert.equal(costDream.engine, 'model')
assert.ok(costDream.costCny > 0)
const journal = JSON.parse(fs.readFileSync(path.join(costDir, 'dream-journal.json'), 'utf8'))
assert.equal(journal.phase, 'done')
assert.ok(journal.costCny > 0)
fs.rmSync(costDir, { recursive: true, force: true })

console.log('units ok')
fs.rmSync(dir, { recursive: true, force: true })
