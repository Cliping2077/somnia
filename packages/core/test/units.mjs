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

// short CJK entries must survive a rewrite
const rewrite = applyRewrite({ entries: [{ section: 'preferences', text: '不吃辣' }] }, { entries: [] })
assert.equal(rewrite.entries.length, 1)

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
const somnia = createSomnia({ dir, generate: async () => '' })
assert.equal(somnia.state().idleMinutes, 7)

// capture redacts before writing
somnia.capture('s', '我的 token 是 sk-abcdefgh12345678，记住')
assert.ok(!somnia.episodes()[0].text.includes('abcdefgh'))

// a failed model must fall back, not wipe
const fallback = await somnia.dream('manual')
assert.equal(fallback.engine, 'fallback')
assert.ok(somnia.memory().entries.length >= 1)

console.log('units ok')
fs.rmSync(dir, { recursive: true, force: true })
