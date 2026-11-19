import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createSomnia } from '../packages/core/src/somnia.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-eval-'))
let modelCalls = 0
const somnia = createSomnia({
  dir,
  generate: async () => {
    modelCalls += 1
    return {
      text: JSON.stringify({
        ops: [
          { op: 'add', section: 'projects', text: 'Somnia 使用 SQLite 作为记忆存储', confidence: 0.9,
            quote: '我们决定用 SQLite 存记忆', scope: { object: 'Somnia', situation: '记忆存储' } },
          { op: 'add', section: 'preferences', text: '用户偏好暗金色界面', confidence: 0.9,
            quote: '以后所有界面都用暗金色', scope: { object: '界面', situation: '配色' } },
        ],
      }),
    }
  },
})

const scenarios = [
  '我们决定用 SQLite 存记忆',
  '发布 Somnia v1.0.0 到 GitHub',
  '以后所有界面都用暗金色',
]
for (const text of scenarios) somnia.capture('eval', text)

const pinned = await somnia.action({
  action: 'save',
  text: '跨对话必须保留：用户要主见、抗批评、端到端推进',
  kind: 'preference',
  confidence: 0.99,
  pinned: true,
})

const before = somnia.memory().entries.length
await somnia.dream('manual')
const after = somnia.memory()
const pinnedSurvived = after.entries.some((entry) => entry.id === pinned.id && entry.pinned)
assert.ok(pinnedSurvived, 'pinned entry must survive a dream')

const sqliteHits = somnia.retrieve('SQLite 存储', 5)
assert.ok(sqliteHits.entries.length + sqliteHits.episodes.length > 0, 'SQLite must be retrievable')

const goldHits = somnia.retrieve('暗金色 界面', 5)
assert.ok(goldHits.entries.length + goldHits.episodes.length > 0, 'gold preference must be retrievable')

const used = somnia.memory().entries.filter((entry) => (entry.uses || 0) > 0).length
assert.ok(used > 0, 'retrieval must reinforce entries')

const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-eval-fallback-'))
const fallback = createSomnia({ dir: fallbackDir, generate: async () => { throw new Error('model down') } })
await fallback.action({ action: 'save', text: '必须保留的偏好', kind: 'preference', confidence: 0.9, pinned: true })
fallback.capture('eval', '发布一个版本')
await fallback.dream('manual')
assert.ok(fallback.memory().entries.some((entry) => entry.pinned), 'fallback must not wipe pinned')

const report = {
  entriesBefore: before,
  entriesAfter: after.entries.length,
  modelCalls,
  pinnedSurvived,
  retrievalHits: {
    sqlite: sqliteHits.entries.length + sqliteHits.episodes.length,
    gold: goldHits.entries.length + goldHits.episodes.length,
  },
  reinforcedEntries: used,
  fallbackKeptPinned: true,
}
console.log(JSON.stringify(report, null, 2))
fs.rmSync(dir, { recursive: true, force: true })
fs.rmSync(fallbackDir, { recursive: true, force: true })
