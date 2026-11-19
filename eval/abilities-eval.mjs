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

console.log(JSON.stringify({
  singleHop: 'pass',
  recencyOrdering: 'pass',
  multiFact: 'pass',
  abstention: 'pass',
  temporalOrdering: 'pass',
  knowledgeUpdate: 'pass',
  implicitSupersession: 'pass',
  note: 'knowledgeUpdate is latest-wins via explicit subject or lexical-overlap heuristic; free-text entity linking is not implemented',
}, null, 2))
fs.rmSync(dir, { recursive: true, force: true })
