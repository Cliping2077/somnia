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
  sampleEvenly,
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

// pinned entries are neocortical anchors: a rewrite and a downscale may not drop them
const pinnedRewrite = applyRewrite({ entries: [] }, {
  entries: [{ id: 'p1', section: 'preferences', text: '用户要主见', pinned: true, status: 'foreground', confidence: 0.9, firstSeen: now, reviewedAt: now }],
})
assert.ok(pinnedRewrite.entries.some((entry) => entry.pinned && entry.text === '用户要主见'))
const pinnedDown = downscale([
  { id: 'p1', section: 'preferences', text: '用户要主见', pinned: true, confidence: 0.01, status: 'foreground', lastUsedAt: 0, firstSeen: now - 200 * 86400000, uses: 0 },
], now)
assert.equal(pinnedDown.length, 1)

// injection keeps pinned and profile entries verbatim
const memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-inject-'))
const mem = createSomnia({ dir: memDir })
mem.action({ action: 'save', text: '跨对话最高优先级：要主见', kind: 'preference', pinned: true, confidence: 0.99 })
mem.action({ action: 'save', text: '余额面板数值右对齐', kind: 'preference', confidence: 0.9 })
const injected = mem.injectText()
assert.ok(injected.includes('跨对话最高优先级：要主见'))
assert.ok(injected.includes('余额面板数值右对齐'))
fs.rmSync(memDir, { recursive: true, force: true })

// interleaved replay samples evenly across the older pool
assert.equal(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3).length, 3)

// recall searches entries and episodes; archived episodes remain retrievable
const recallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-recall-'))
const recall = createSomnia({ dir: recallDir })
recall.capture('s', '我们决定把代理出口换成静态 IP')
recall.action({ action: 'save', text: '代理出口使用静态 IP', kind: 'preference', confidence: 0.9 })
const hits = await recall.action({ action: 'recall', query: '静态 IP', limit: 5 })
assert.ok(hits.entries.length + hits.episodes.length >= 1)
fs.writeFileSync(path.join(recallDir, 'episodes.jsonl'), JSON.stringify({ t: now - 40 * 86400000, session: 's', text: '很久以前讨论过新加坡搬家' }) + '\n', 'utf8')
await recall.action({ action: 'dream' })
const archivedHit = await recall.action({ action: 'recall', query: '新加坡 搬家', limit: 5 })
assert.ok(archivedHit.episodes.some((episode) => episode.archived))
fs.rmSync(recallDir, { recursive: true, force: true })

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

// a failed model must fall back, not wipe the previous curated entries
await somnia.action({ action: 'save', text: '必须保留的既有事实', kind: 'fact', confidence: 0.9 })
const fallback = await somnia.dream('manual')
assert.equal(fallback.engine, 'fallback')
assert.ok(somnia.memory().entries.some((entry) => entry.text.includes('必须保留的既有事实')))
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
      ops: [{
        op: 'add',
        section: 'projects',
        text: 'Somnia 已发布',
        scope: { object: 'Somnia 仓库', situation: '发布状态' },
        quote: '发布 Somnia 到仓库',
      }],
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

// embed interface: a semantic-only match surfaces an episode lexical/BM25 would miss
const embedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-embed-'))
const embed = (text) => {
  const vector = new Array(16).fill(0)
  if (/egress|outbound/i.test(text)) vector[0] = 1
  if (/gateway/i.test(text)) vector[1] = 1
  return vector
}
const embedSomnia = createSomnia({ dir: embedDir, embed })
embedSomnia.capture('a', 'egress via gateway')
const semantic = embedSomnia.retrieve('outbound path', 5)
assert.ok(semantic.episodes.some((episode) => episode.text.includes('egress')), 'embedding must surface a semantic-only match')
fs.rmSync(embedDir, { recursive: true, force: true })

console.log('units ok')
fs.rmSync(dir, { recursive: true, force: true })
