// Failure-mode eval for the ported memory write pipeline.
// Pure functions, no model call. Every case names the failure it prevents.
import assert from 'node:assert/strict'
import { applyOps } from '../packages/core/src/consolidate.js'

const now = Date.parse('2026-11-18T22:00:00Z')
const episodes = [
  { id: 'e1', t: now - 86400000, text: '这个演示视频里把红色改成暗金，其它地方不用改' },
  { id: 'e2', t: now - 3600000, text: '以后所有 UI 都用暗金强调色' },
  { id: 'e3', t: now, text: '正在把 DSH 改造成 GPT 级体验' },
  { id: 'e4', t: now, text: '余额面板保留充值入口' },
  { id: 'e5', t: now, text: '以后出口换 1.2.3.4' },
  { id: 'e6', t: now, text: 'DSH 改造工作已撤销' },
  { id: 'e7', t: now, text: 'Alpha 项目用本地模拟环境验收' },
  { id: 'e8', t: now, text: 'Beta 项目用集成环境验收' },
]

function base() {
  return {
    entries: [
      {
        id: 'keep-1',
        section: 'projects',
        text: '正在把 DSH 改造成接近 GPT 的使用体验。',
        scope: { object: 'DSH', situation: '' },
        source: { episodes: ['e0'], quote: '把 DSH 改造成接近 GPT', at: now - 9e8 },
        validFrom: now - 9e8,
        status: 'foreground',
        confidence: 0.8,
        pinned: false,
        firstSeen: now - 9e8,
        reviewedAt: now - 9e8,
        lastUsedAt: 0,
        uses: 0,
        history: [],
      },
      {
        id: 'pin-1',
        section: 'preferences',
        text: '交付前必须自验证。',
        scope: { object: '所有交付', situation: '' },
        status: 'foreground',
        pinned: true,
        firstSeen: now - 9e8,
        reviewedAt: now - 9e8,
        lastUsedAt: 0,
        uses: 0,
        history: [],
      },
    ],
  }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
  }
}

// 1. Over-generalization: a one-off decision for one video must not become a preference.
check('one-off aesthetic demoted to notes with artifact scope', () => {
  const ops = [{
    op: 'add', section: 'preferences', text: '用暗金代替红色',
    scope: { object: '即梦演示视频', situation: '该视频配色' },
    episodes: ['e1'], quote: '这个演示视频里把红色改成暗金，其它地方不用改', confidence: 0.8,
  }]
  const { entries, results: applied } = applyOps(ops, base(), now, episodes)
  const added = entries.find((entry) => entry.text === '用暗金代替红色')
  assert.ok(added, 'entry was dropped entirely')
  assert.equal(added.section, 'notes', 'must be demoted out of preferences')
  assert.equal(added.scope.object, '即梦演示视频')
  assert.equal(applied[0].demoted, true)
})

// 2. A stated general rule may stay a preference.
check('explicit general rule stays a preference', () => {
  const ops = [{
    op: 'add', section: 'preferences', text: '所有 UI 用暗金强调色',
    scope: { object: '所有 UI', situation: 'Dsh 主题' },
    episodes: ['e2'], quote: '以后所有 UI 都用暗金强调色',
  }]
  const { entries } = applyOps(ops, base(), now, episodes)
  const added = entries.find((entry) => entry.text === '所有 UI 用暗金强调色')
  assert.ok(added)
  assert.equal(added.section, 'preferences')
  assert.equal(added.status, 'foreground')
})

// 3. Scope loss is impossible: an add without scope.object is rejected.
check('add without scope is rejected', () => {
  const ops = [{ op: 'add', section: 'notes', text: '偏好暗金色系' }]
  const { entries, results: applied } = applyOps(ops, base(), now, episodes)
  assert.equal(entries.length, base().entries.length)
  assert.equal(applied[0].accepted, false)
  assert.match(applied[0].reason, /scope/)
})

// 4. Update keeps identity and appends history.
check('update preserves id and firstSeen, appends history', () => {
  const before = base()
  const target = before.entries[0]
  const ops = [{ op: 'update', id: target.id, text: '正在把 DSH 改造成 GPT 级体验', quote: '正在把 DSH 改造成 GPT 级体验', episodes: ['e3'] }]
  const { entries } = applyOps(ops, before, now, episodes)
  const updated = entries.find((entry) => entry.id === target.id)
  assert.ok(updated)
  assert.equal(updated.firstSeen, target.firstSeen)
  assert.equal(updated.text, '正在把 DSH 改造成 GPT 级体验')
  assert.ok(updated.history.length >= 1)
})

// 5. Delete invalidates instead of erasing, and pinned entries are untouchable.
check('delete invalidates, pinned delete rejected', () => {
  const before = base()
  const { entries, results: applied } = applyOps([
    { op: 'delete', id: 'keep-1', reason: 'no longer true', episodes: ['e6'], quote: 'DSH 改造工作已撤销' },
    { op: 'delete', id: 'pin-1', reason: 'attempt', episodes: ['e6'], quote: 'DSH 改造工作已撤销' },
  ], before, now, episodes)
  const deleted = entries.find((entry) => entry.id === 'keep-1')
  assert.ok(deleted, 'row must remain for audit')
  assert.equal(deleted.validTo, now)
  assert.equal(deleted.status, 'background')
  const pinned = entries.find((entry) => entry.id === 'pin-1')
  assert.equal(pinned.status, 'foreground')
  assert.equal(pinned.validTo, undefined)
  assert.equal(applied[1].accepted, false)
})

check('unverified deletion retains the active entry', () => {
  const { entries, results: applied } = applyOps([
    { op: 'delete', id: 'keep-1', reason: 'no longer true' },
  ], base(), now, episodes)
  assert.equal(applied[0].accepted, false)
  assert.equal(entries[0].status, 'foreground')
})

// 6. Provenance is mandatory and preserved.
check('provenance carries episodes and quote', () => {
  const ops = [{
    op: 'add', section: 'projects', text: '余额面板保留充值入口',
    scope: { object: 'dsh-balance-hud', situation: '面板动作区' },
    episodes: ['e4'], quote: '余额面板保留充值入口',
  }]
  const { entries } = applyOps(ops, base(), now, episodes)
  const added = entries.find((entry) => entry.text === '余额面板保留充值入口')
  assert.deepEqual(added.source.episodes, ['e4'])
  assert.equal(added.source.quote, '余额面板保留充值入口')
  assert.ok(added.source.at >= episodes[0].t)
})

// 7. No global rewrite: a noop-only run leaves every id and text byte-identical.
check('noop leaves the store untouched (no global rewrite)', () => {
  const before = base()
  const { entries } = applyOps([{ op: 'noop' }], before, now, episodes)
  assert.deepEqual(entries.map((entry) => entry.id), before.entries.map((entry) => entry.id))
  assert.deepEqual(entries.map((entry) => entry.text), before.entries.map((entry) => entry.text))
})

// A newer claim supersedes the older entry within the same normalized scope.
check('same-subject claim in the same scope supersedes the older entry', () => {
  const before = base()
  before.entries[0].subject = '出口IP'
  before.entries[0].scope = { object: ' 代理出口 ', situation: '静态  IP 方案' }
  const ops = [{
    op: 'add', section: 'projects', subject: '出口IP', text: '出口 IP 改为 1.2.3.4',
    scope: { object: '代理出口', situation: '静态 IP 方案' }, episodes: ['e5'], quote: '以后出口换 1.2.3.4',
  }]
  const { entries, results: applied } = applyOps(ops, before, now, episodes)
  const old = entries.find((entry) => entry.id === 'keep-1')
  assert.equal(old.status, 'background', 'older claim must be retired')
  assert.equal(old.validTo, now)
  assert.ok(old.supersededBy, 'older claim must point at its replacement')
  assert.ok(applied[0].superseded === 'keep-1')
})

check('same-subject claims in different project scopes both stay active', () => {
  const ops = [
    { op: 'add', section: 'projects', subject: '验收环境', text: '本地模拟环境', scope: { object: 'Alpha' }, episodes: ['e7'] },
    { op: 'add', section: 'projects', subject: '验收环境', text: '集成环境', scope: { object: 'Beta' }, episodes: ['e8'] },
  ]
  const { entries, results: applied } = applyOps(ops, base(), now, episodes)
  const matches = entries.filter((entry) => entry.subject === '验收环境')
  assert.deepEqual(matches.map((entry) => [entry.scope.object, entry.status, entry.validTo]), [
    ['Alpha', 'foreground', undefined],
    ['Beta', 'foreground', undefined],
  ])
  assert.equal(applied[1].superseded, undefined)
})

check('a scoped claim preserves an older entry with unknown scope', () => {
  const before = base()
  before.entries[0].subject = '验收环境'
  delete before.entries[0].scope
  const ops = [
    { op: 'add', section: 'projects', subject: '验收环境', text: '集成环境', scope: { object: 'Beta' }, episodes: ['e8'] },
  ]
  const { entries, results: applied } = applyOps(ops, before, now, episodes)
  const old = entries.find((entry) => entry.id === 'keep-1')
  assert.equal(old.status, 'foreground')
  assert.equal(old.validTo, undefined)
  assert.equal(applied[0].accepted, true)
  assert.equal(applied[0].superseded, undefined)
})

check('a background claim preserves the foreground fact in the same scope', () => {
  const before = base()
  const current = before.entries[0]
  current.subject = '验收环境'
  current.scope = { object: 'Beta', situation: '验收' }
  const ops = [{
    op: 'add', section: 'projects', subject: '验收环境', status: 'background', text: '集成环境',
    scope: current.scope, episodes: ['e8'],
  }]
  const { entries, results: applied } = applyOps(ops, before, now, episodes)
  const existing = entries.find((entry) => entry.id === current.id)
  const added = entries.find((entry) => entry.id === applied[0].id)
  assert.equal(existing.status, 'foreground')
  assert.equal(existing.validTo, undefined)
  assert.equal(added.status, 'background')
  assert.equal(applied[0].superseded, undefined)
})

const failed = results.filter((entry) => !entry.ok)
for (const entry of results) console.log((entry.ok ? 'PASS ' : 'FAIL ') + entry.name + (entry.error ? ' :: ' + entry.error : ''))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1
