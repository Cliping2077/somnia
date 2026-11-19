import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const data = JSON.parse(fs.readFileSync(new URL('./locomo10.json', import.meta.url), 'utf8'))

function conversationTurns(conversation) {
  const turns = []
  for (let index = 1; index <= 100; index += 1) {
    const session = conversation[`session_${index}`]
    if (!Array.isArray(session)) break
    for (const turn of session) {
      turns.push({ id: String(turn.dia_id || ''), text: `[${turn.dia_id}] ${turn.speaker}: ${turn.text}` })
    }
  }
  return turns
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function hit(context, question) {
  const text = normalize(context)
  const evidence = Array.isArray(question.evidence) ? question.evidence : []
  const answer = normalize(question.answer)
  if (evidence.some((id) => text.includes(normalize(id)))) return true
  return answer.length >= 3 && text.includes(answer)
}

const configs = {
  limitPerConversation: Number(process.argv[2] || 50),
  topK: 10,
}

const totals = {
  questions: 0,
  v3: { hits: 0, chars: 0 },
  recency: { hits: 0, chars: 0 },
  summary: { hits: 0, chars: 0 },
}

for (const sample of data) {
  const turns = conversationTurns(sample.conversation)
  if (turns.length === 0) continue
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-locomo-'))
  const somnia = createSomnia({ dir })
  for (const turn of turns) somnia.capture(String(sample.sample_id || 'locomo'), turn.text)

  const questions = (sample.qa || []).slice(0, configs.limitPerConversation)
  for (const question of questions) {
    const v3 = somnia.retrieve(question.question, configs.topK)
    const v3text = [...v3.episodes, ...v3.entries].map((item) => item.text).join('\n')
    const recencyText = turns.slice(-configs.topK).map((turn) => turn.text).join('\n')
    const summaryText = turns.map((turn) => turn.text).join('\n').slice(0, 2000)

    totals.questions += 1
    totals.v3.chars += v3text.length
    totals.recency.chars += recencyText.length
    totals.summary.chars += summaryText.length
    if (hit(v3text, question)) totals.v3.hits += 1
    if (hit(recencyText, question)) totals.recency.hits += 1
    if (hit(summaryText, question)) totals.summary.hits += 1
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

const n = totals.questions || 1
const report = {
  questions: totals.questions,
  evidenceRecallAtK: {
    v3: +(totals.v3.hits / n).toFixed(4),
    recency: +(totals.recency.hits / n).toFixed(4),
    summary: +(totals.summary.hits / n).toFixed(4),
  },
  avgContextChars: {
    v3: Math.round(totals.v3.chars / n),
    recency: Math.round(totals.recency.chars / n),
    summary: Math.round(totals.summary.chars / n),
  },
}
console.log(JSON.stringify(report, null, 2))
