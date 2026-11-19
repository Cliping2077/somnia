import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const file = new URL('./longmemeval_s.json', import.meta.url)
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const limit = Number(process.argv[2] || 100)
const k = Number(process.argv[3] || 10)
const instances = Array.isArray(data) ? data.slice(0, limit) : []

const perType = new Map()
let total = 0
let hit = 0

for (const instance of instances) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-lme-'))
  const somnia = createSomnia({ dir })
  const sessionIds = Array.isArray(instance.haystack_session_ids) ? instance.haystack_session_ids : []
  const sessions = Array.isArray(instance.haystack_sessions) ? instance.haystack_sessions : []
  for (let index = 0; index < sessions.length; index += 1) {
    const sessionId = String(sessionIds[index] ?? index)
    const turns = Array.isArray(sessions[index]) ? sessions[index] : []
    for (const turn of turns) {
      if (!turn || typeof turn.content !== 'string') continue
      somnia.capture(sessionId, `${turn.role || 'user'}: ${turn.content}`.slice(0, 600))
    }
  }
  const result = somnia.retrieve(instance.question || '', k)
  const retrievedSessions = new Set(result.episodes.map((episode) => episode.session))
  const gold = new Set((Array.isArray(instance.answer_session_ids) ? instance.answer_session_ids : []).map(String))
  let found = false
  for (const id of retrievedSessions) if (gold.has(id)) { found = true; break }
  const type = instance.question_type || 'unknown'
  const stat = perType.get(type) || { n: 0, hit: 0 }
  stat.n += 1
  if (found) stat.hit += 1
  perType.set(type, stat)
  total += 1
  if (found) hit += 1
  fs.rmSync(dir, { recursive: true, force: true })
}

const byType = {}
for (const [type, stat] of perType) byType[type] = { n: stat.n, hitRate: +(stat.hit / stat.n).toFixed(4) }
console.log(JSON.stringify({
  instances: total,
  k,
  sessionRecall: +(hit / Math.max(1, total)).toFixed(4),
  byType,
}, null, 2))
