import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createSomnia } from '../packages/core/src/somnia.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-abilities-'))
const somnia = createSomnia({ dir })

// single-hop recall
somnia.capture('a', '出口用动态 IP')
const single = somnia.retrieve('出口用哪个 IP', 5)
assert.ok(single.episodes.length >= 1, 'single-hop fact must be retrieved')

// recency ordering: the newer value is retrievable and is the newest among hits
await new Promise((resolve) => setTimeout(resolve, 10))
somnia.capture('a', '出口改用静态 IP')
const update = somnia.retrieve('出口现在用什么 IP', 5)
assert.ok(update.episodes.some((episode) => episode.text.includes('静态')), 'newer value must be retrievable')
const byTime = [...update.episodes].sort((left, right) => (right.t || 0) - (left.t || 0))
assert.ok(byTime[0] && byTime[0].text.includes('静态'), 'newest episode must be the update')

// multi-fact: earlier and later values both stay retrievable
const both = somnia.retrieve('出口 IP', 8)
assert.ok(both.episodes.some((episode) => episode.text.includes('动态')))
assert.ok(both.episodes.some((episode) => episode.text.includes('静态')))

// abstention: an unanswerable query returns nothing
const abstain = somnia.retrieve('我的猫叫什么名字', 5)
assert.equal(abstain.entries.length + abstain.episodes.length, 0, 'unanswerable query must return nothing')

// temporal ordering: a chronological timeline puts earlier events first
somnia.capture('a', '先去了北京')
await new Promise((resolve) => setTimeout(resolve, 10))
somnia.capture('a', '后去了上海')
const timeline = somnia.retrieve('去了哪些城市', 5).timeline
assert.ok(timeline.length >= 2, 'both temporal events must be retrieved')
assert.ok(timeline[0].text.includes('北京'), 'earlier event must come first in the timeline')
assert.ok(timeline[timeline.length - 1].text.includes('上海'), 'later event must come last in the timeline')

// knowledge update (subject-scoped latest-wins): the newer value is current, the older is superseded
await somnia.action({ action: 'save', text: '出口用动态 IP', kind: 'fact', subject: '出口IP', confidence: 0.9 })
await new Promise((resolve) => setTimeout(resolve, 5))
await somnia.action({ action: 'save', text: '出口改用静态 IP', kind: 'fact', subject: '出口IP', confidence: 0.9 })
const knowledge = somnia.retrieve('出口 IP', 5)
const current = knowledge.entries.find((entry) => entry.subject === '出口IP' && entry.text.includes('静态'))
const older = knowledge.entries.find((entry) => entry.subject === '出口IP' && entry.text.includes('动态'))
assert.ok(current && current.superseded === false, 'newer value must be current')
assert.ok(older && older.superseded === true, 'older value must be marked superseded')

// implicit supersession: same fact stated twice without an explicit subject still latest-wins
const impDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-imp-'))
const imp = createSomnia({ dir: impDir })
await imp.action({ action: 'save', text: '出口用动态 IP', kind: 'fact', confidence: 0.9 })
await new Promise((resolve) => setTimeout(resolve, 5))
await imp.action({ action: 'save', text: '出口改用静态 IP', kind: 'fact', confidence: 0.9 })
const impRes = imp.retrieve('出口 IP', 5)
const impCurrent = impRes.entries.find((entry) => entry.text.includes('静态'))
const impOlder = impRes.entries.find((entry) => entry.text.includes('动态'))
assert.ok(impCurrent && impCurrent.superseded === false, 'implicit: newer value must be current')
assert.ok(impOlder && impOlder.superseded === true, 'implicit: older value must be superseded')
fs.rmSync(impDir, { recursive: true, force: true })

const scopedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-scoped-recall-'))
try {
  let time = Date.parse('2026-11-20T12:00:00Z')
  const scoped = createSomnia({ dir: scopedDir, now: () => time++ })
  const subject = 'Preview theme'
  const alpha = { object: 'Alpha', situation: '预览' }
  const beta = { object: 'Beta', situation: '预览' }

  async function saveFact(text, scope, options = {}) {
    const { id } = await scoped.action({ action: 'save', text, kind: 'fact', subject: options.subject })
    if (scope) await scoped.action({ action: 'edit', id, scope })
    if (options.background) await scoped.action({ action: 'hide', id })
    return id
  }

  const oldAlpha = await saveFact('配置主题使用深色', alpha, { subject })
  const activeBeta = await saveFact('配置主题使用高对比色', beta, { subject })
  const activeAlpha = await saveFact('配置主题使用浅色', alpha, { subject: subject.toUpperCase() })
  const backgroundAlpha = await saveFact('配置主题使用蓝色', alpha, { subject, background: true })
  const unknownScope = await saveFact('配置主题使用灰色', undefined, { subject })
  const implicitAlpha = await saveFact('出口用动态 IP', alpha)
  const implicitBeta = await saveFact('出口改用静态 IP', beta)

  // User-authored memories from previous versions can already carry invalidation metadata.
  const data = JSON.parse(fs.readFileSync(scoped.paths.memory, 'utf8'))
  data.entries.push(
    { id: 'retired-layout', section: 'projects', text: '注册表单使用单列排版', status: 'background', validTo: time },
    { id: 'future-layout', section: 'projects', text: '注册表单使用双列排版', status: 'foreground', validTo: time + 60_000 },
    { id: 'linked-layout', section: 'projects', text: '注册表单使用多列排版', status: 'foreground', supersededBy: 'missing-layout' },
  )
  fs.writeFileSync(scoped.paths.memory, JSON.stringify(data))

  const reopened = createSomnia({ dir: scopedDir, now: () => time++ })
  const theme = await reopened.action({ action: 'recall', query: '配置主题', limit: 20 })
  const layout = await reopened.action({ action: 'recall', query: '注册表单排版', limit: 20 })
  const endpoint = await reopened.action({ action: 'recall', query: '出口 IP', limit: 20 })
  const supersededFlags = (recall, ids) => ids.map((id) => recall.entries.find((entry) => entry.id === id)?.superseded)

  assert.deepEqual(supersededFlags(theme, [oldAlpha, activeBeta, activeAlpha, backgroundAlpha, unknownScope]),
    [true, false, false, false, false], 'only the older foreground claim in the same scope should be superseded')
  assert.deepEqual(supersededFlags(endpoint, [implicitAlpha, implicitBeta]),
    [false, false], 'lexical overlap must not supersede across scopes')
  assert.deepEqual(supersededFlags(layout, ['retired-layout', 'future-layout', 'linked-layout']),
    [true, false, true], 'invalidation applies without its replacement present and once the expiry time is reached')
} finally {
  fs.rmSync(scopedDir, { recursive: true, force: true })
}

console.log(JSON.stringify({
  singleHop: 'pass',
  recencyOrdering: 'pass',
  multiFact: 'pass',
  abstention: 'pass',
  temporalOrdering: 'pass',
  knowledgeUpdate: 'pass',
  implicitSupersession: 'pass',
  scopedSupersession: 'pass',
  note: 'knowledgeUpdate is latest-wins via explicit subject or lexical-overlap heuristic; free-text entity linking is not implemented',
}, null, 2))
fs.rmSync(dir, { recursive: true, force: true })
