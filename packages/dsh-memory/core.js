/**
 * Somnia core — sleep-stage memory, host-agnostic.
 *
 * No Cordis, no DSH, no network. The host supplies:
 *   dir       where episodes.jsonl, memory.json, snapshots/, dreams/ live
 *   generate  ({ system, user, maxTokens }) => Promise<string>
 *
 * Everything else (buffer, salience, rewrite, downscale, snapshots, injection,
 * tool actions) is here.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { OPS_SYSTEM, applyOps, migrateEntries, opsPrompt, scopeLine } from './consolidate.js'
import { listEntryFiles, readFileEntries, readIndex, writeFileMemory } from './file-memory.js'

export const SECTIONS = ['identity', 'preferences', 'projects', 'plans', 'lessons', 'hypotheses', 'notes']
export const EPISODE_TTL_MS = 30 * 86400000
export const EPISODE_MAX = 5000
export const EPISODE_SALIENT_MAX = 40
export const MEMORY_MAX = 40
export const SNAPSHOT_KEEP = 20
export const INJECT_LIMIT = 20
export const INJECT_MAX_CHARS = 2400
export const REPLAY_OLD_MAX = 8

const EXPLICIT = /(记住|记一下|记下来|别忘|以后都|以后要|每次|下次都|永远|始终|我的偏好|我更喜欢|我要你|remember|from now on|always use|never use|i prefer)/i
const HYPOTHETICAL = /(万一|如果|假如|假设|要是|比如|例如|可能|也许|或许|假装|角色扮演|hypothetical|suppose|what if|for example)/i
const PREFERENCE = /(偏好|喜欢|不要|别用|必须|统一|风格|习惯|用中文|用英文|prefer|always|never)/i
const DECISION = /(决定|采用|方案|改成|修正|不对|错误|重做|换成|选|定下来)/i
const PROJECT = /(项目|文件|路径|版本|框架|仓库|部署|测试|插件|界面|面板)/i
const ENGINEERING = /(发布|重构|修复|提交|上线|仓库|版本|测试|commit|release|repo|repository|version|test|bug|fix|deploy|publish|ship)/i

export const REWRITE_SYSTEM = [
  "You maintain a user's long-term memory as a rewritten summary, not a log.",
  'Input: the current memory entries and new salient episodes.',
  'Output: the complete rewritten memory. Rules:',
  '- Keep only durable, specific, evidence-backed items; merge duplicates.',
  '- Resolve contradictions in favor of newer evidence.',
  '- Time-shift: a future plan whose date has passed becomes a past fact (e.g. "will visit Singapore in July" -> "visited Singapore in July 2026").',
  '- Track active projects: include project-state entries under section "projects" (name, what shipped, current state).',
  '- Prefer recent engineering decisions (repo, release, tests, fixes, versions) over cosmetic preferences.',
  '- For each entry include "source": the ISO timestamp of the episode that supports it, when known.',
  '- For factual entries, include "subject": a short normalized key naming the entity the fact is about (e.g. "出口IP", "常驻城市"); omit it for preferences and notes. Two entries with the same subject and a newer value supersede the older one.',
  '- Test-only or temporary preferences must be status "background".',
  '- Demote stale or rarely relevant items to status "background"; drop what no longer matters.',
  '- Never drop or paraphrase an entry marked pinned: reproduce it verbatim, keep pinned true.',
  '- User identity and working preferences outrank project details; keep them explicit and concrete.',
  '- Every preference must carry its scope in the text: name the object and the situation (e.g. "在即梦演示视频里用暗金主色，不用红色" rather than "偏好暗金").',
  '- A decision made for one artifact, screen, document, or video is not a global taste. Record such one-off choices as a "notes" or "projects" entry naming the artifact; promote to "preferences" only when the user states a general rule or repeats it across contexts.',
  '- Never generalize a single occurrence into a standing preference. If the user did not state the scope, write the entry so the scope is explicit or mark it status "background" and say the scope is unconfirmed.',
  '- Keep the situation with the fact: an entry that loses where or when it applied is worse than no entry, because it will be misapplied elsewhere.',
  '- Replay is interleaved (recent plus older episodes); integrate them, do not replace older memories wholesale.',
  '- Never store secrets, tokens, personal identifiers, hypotheticals, or one-off chatter.',
  '- Hypotheses: at most 3 tentative connections, clearly tentative, confidence <= 0.4.',
  'Reply with a single JSON object only: no markdown fences, no reasoning, no commentary.',
  'Return strict JSON and nothing else:',
  '{"entries":[{"section":"identity|preferences|projects|plans|lessons|notes","text":"...","confidence":0.6,"status":"foreground|background","subject":"entity key","source":"2026-11-17T21:00:00Z"}],"hypotheses":[{"text":"...","confidence":0.3}]}',
].join('\n')

const SECTION_OF_KIND = { preference: 'preferences', fact: 'projects', lesson: 'lessons', note: 'notes' }
const KIND_OF_SECTION = { identity: 'fact', preferences: 'preference', projects: 'fact', plans: 'fact', lessons: 'lesson', hypotheses: 'note', notes: 'note' }

export function normalizeText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function normalizeSubject(text) {
  const value = normalizeText(text)
  if (value.length === 0) return undefined
  return value.slice(0, 80)
}

/** Strip secrets and personal identifiers before anything is stored. */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/\b(sk-|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/g, '$1…')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, '$1…')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
}

function bigramsOf(text) {
  const value = String(text).toLowerCase().replace(/\s+/g, ' ')
  const grams = new Map()
  for (let index = 0; index + 1 < value.length; index += 1) {
    const gram = value.slice(index, index + 2)
    grams.set(gram, (grams.get(gram) || 0) + 1)
  }
  return grams
}

function cosine(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (const [gram, count] of left) {
    leftNorm += count * count
    const other = right.get(gram)
    if (other) dot += count * other
  }
  for (const count of right.values()) rightNorm += count * count
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

/** Cosine similarity between two equal-length numeric vectors; 0 on any mismatch. */
export function vecCos(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

/** Word/CJK overlap + character-bigram cosine. Better for Chinese than Jaccard alone. */
export function tokensOf(text) {
  const value = String(text).toLowerCase()
  const words = value.match(/[a-z0-9_]{2,}/g) ?? []
  const cjk = value.match(/[\u4e00-\u9fff]/g) ?? []
  const bigrams = []
  for (let index = 0; index + 1 < cjk.length; index += 1) bigrams.push(cjk[index] + cjk[index + 1])
  return [...words, ...cjk, ...bigrams]
}

/** BM25 over a fixed corpus; returns raw scores aligned with the input order. */
export function bm25Scores(query, documents, k1 = 1.2, b = 0.75) {
  const terms = [...new Set(tokensOf(query))]
  if (terms.length === 0 || documents.length === 0) return documents.map(() => 0)
  const tokenized = documents.map((document) => tokensOf(document))
  const lengths = tokenized.map((tokens) => tokens.length)
  const average = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, lengths.length)
  const idf = new Map()
  for (const term of terms) {
    const frequency = tokenized.filter((tokens) => tokens.includes(term)).length
    idf.set(term, Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)))
  }
  return tokenized.map((tokens, index) => {
    const counts = new Map()
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
    let score = 0
    for (const term of terms) {
      const tf = counts.get(term) || 0
      if (tf === 0) continue
      score += (idf.get(term) || 0) * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (lengths[index] / Math.max(1, average)))))
    }
    return score
  })
}

export function rankScore(query, text) {
  const lexical = similarity(query, text)
  const semantic = cosine(bigramsOf(query), bigramsOf(text))
  return lexical * 0.55 + semantic * 0.45
}

export function clamp(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5
}

export function similarity(left, right) {
  const terms = (text) => {
    const value = String(text).toLowerCase()
    const words = value.match(/[a-z0-9_]{2,}/g) ?? []
    const cjk = value.match(/[\u4e00-\u9fff]/g) ?? []
    const bigrams = []
    for (let index = 0; index + 1 < cjk.length; index += 1) bigrams.push(cjk[index] + cjk[index + 1])
    return new Set([...words, ...cjk, ...bigrams])
  }
  const a = terms(left)
  const b = terms(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const term of a) if (b.has(term)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

/** Jaccard over words + CJK unigrams (no bigrams), for implicit same-subject detection. */
export function contentOverlap(left, right) {
  const set = (text) => {
    const value = String(text).toLowerCase()
    return new Set([...(value.match(/[a-z0-9_]{2,}/g) ?? []), ...(value.match(/[\u4e00-\u9fff]/g) ?? [])])
  }
  const a = set(left)
  const b = set(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const term of a) if (b.has(term)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

export function salienceOf(text) {
  let score = 0
  if (EXPLICIT.test(text)) score += 3
  if (HYPOTHETICAL.test(text)) score -= 3
  if (PREFERENCE.test(text)) score += 1
  if (DECISION.test(text)) score += 1
  if (PROJECT.test(text)) score += 0.5
  if (ENGINEERING.test(text)) score += 1.5
  if (text.length > 80) score += 0.5
  return score
}

export function selectSalient(episodes, now = Date.now(), since = 0) {
  return episodes
    .filter((entry) => now - (entry.t || 0) <= EPISODE_TTL_MS)
    .filter((entry) => (entry.t || 0) > since)
    .map((entry) => ({ ...entry, salience: salienceOf(entry.text) }))
    .filter((entry) => entry.salience >= 1)
    .slice(-EPISODE_SALIENT_MAX)
}

export function sampleEvenly(items, count) {
  if (items.length <= count) return items.slice()
  const step = items.length / count
  return Array.from({ length: count }, (_, index) => items[Math.min(items.length - 1, Math.floor(index * step))])
}

export function applyRewrite(parsed, previous, now = Date.now()) {
  const oldEntries = previous.entries.slice()
  let entries = []
  for (const raw of Array.isArray(parsed.entries) ? parsed.entries : []) {
    const text = normalizeText(raw && raw.text)
    if (text.length < 2) continue
    const section = SECTIONS.includes(raw.section) ? raw.section : 'notes'
    const match = oldEntries.find((entry) => entry.section === section && (entry.text === text || similarity(entry.text, text) >= 0.75))
    const temporary = /测试(时|用|阶段)|临时的|暂时/.test(text)
    entries.push({
      id: match ? match.id : randomUUID(),
      section,
      text: text.slice(0, 300),
      confidence: clamp(raw.confidence ?? (match ? match.confidence : 0.5)),
      status: temporary ? 'background' : (raw.status === 'background' ? 'background' : 'foreground'),
      subject: normalizeSubject(raw.subject ?? (match ? match.subject : undefined)),
      pinned: match ? Boolean(match.pinned) : false,
      source: typeof raw.source === 'string' ? raw.source : (match ? match.source || null : null),
      firstSeen: match ? match.firstSeen : now,
      reviewedAt: now,
      lastConfirmedAt: now,
      lastUsedAt: match ? match.lastUsedAt || 0 : 0,
      uses: match ? match.uses || 0 : 0,
    })
    if (entries.length >= MEMORY_MAX) break
  }
  // Pinned entries are the neocortical anchors: a rewrite may add to them,
  // never drop them, even when the model omits them.
  for (const keep of oldEntries.filter((entry) => entry.pinned)) {
    if (!entries.some((entry) => entry.id === keep.id || (entry.section === keep.section && entry.text === keep.text))) {
      entries.push({ ...keep, reviewedAt: now })
    }
  }
  if (entries.length > MEMORY_MAX) {
    const pinnedEntries = entries.filter((entry) => entry.pinned)
    const rest = entries.filter((entry) => !entry.pinned).slice(0, Math.max(0, MEMORY_MAX - pinnedEntries.length))
    entries = pinnedEntries.concat(rest)
  }
  const hypotheses = (Array.isArray(parsed.hypotheses) ? parsed.hypotheses : []).slice(0, 3).map((raw) => ({
    id: randomUUID(),
    section: 'hypotheses',
    text: normalizeText(raw && raw.text).slice(0, 300),
    confidence: Math.min(0.4, clamp((raw && raw.confidence) ?? 0.3)),
    status: 'background',
    source: typeof (raw && raw.source) === 'string' ? raw.source : null,
    firstSeen: now,
    reviewedAt: now,
    lastConfirmedAt: now,
    lastUsedAt: 0,
    uses: 0,
  })).filter((entry) => entry.text.length >= 6)
  return { entries: entries.concat(hypotheses), hypotheses }
}

export function parseRewrite(text) {
  if (text === null || text === undefined) return null
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (error) {
    return null
  }
}

export function retentionOf(entry, now = Date.now()) {
  const last = entry.lastUsedAt || entry.lastConfirmedAt || entry.reviewedAt || entry.firstSeen || now
  const ageDays = Math.max(0, (now - last) / 86400000)
  const strength = 1 + (entry.uses || 0) * 0.6 + (entry.pinned ? 20 : 0) + (entry.confidence ?? 0.5) * 2
  return Math.exp(-ageDays / (strength * 20))
}

export function downscale(entries, now = Date.now()) {
  const out = []
  for (const entry of entries) {
    if (entry.pinned) { out.push(entry); continue }
    const retention = retentionOf(entry, now)
    if (retention < 0.05 && (entry.uses || 0) === 0) continue
    if (retention < 0.6 && entry.status === 'foreground' && (entry.uses || 0) === 0) entry.status = 'background'
    out.push(entry)
  }
  return out
}

export function estimateCostCny(usage) {
  if (!usage) return null
  const input = Number(usage.inputTokens ?? usage.prompt_tokens ?? 0)
  const hit = Number(usage.cacheReadTokens ?? usage.prompt_cache_hit_tokens ?? 0)
  const miss = Math.max(0, input - hit)
  const output = Number(usage.outputTokens ?? usage.completion_tokens ?? 0)
  // deepseek-flash off-peak: cache hit ¥0.02/M, miss ¥1/M, output ¥4/M.
  return Math.round(((hit * 0.02 + miss * 1 + output * 4) / 1e6) * 10000) / 10000
}

export function selectionPrompt(memoryData, episodes, now = Date.now()) {
  return JSON.stringify({
    today: new Date(now).toISOString().slice(0, 10),
    existing: memoryData.entries.slice(0, 20).map((entry) => ({
      section: entry.section,
      text: entry.text.slice(0, 200),
      confidence: entry.confidence,
      status: entry.status,
      pinned: Boolean(entry.pinned),
      subject: entry.subject || null,
      source: entry.source || null,
      lastUsedAt: entry.lastUsedAt || 0,
    })),
    episodes: episodes.slice(-20).map((entry) => ({ t: new Date(entry.t).toISOString(), text: entry.text.slice(0, 200), replayed: Boolean(entry.replayed) })),
  })
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, text, 'utf8')
  fs.renameSync(temp, file)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return fallback
  }
}

/**
 * Create a Somnia instance.
 * @param {object} options
 * @param {string} [options.dir]
 * @param {(req:{system:string,user:string,maxTokens?:number}) => Promise<string>} options.generate
 * @param {() => number} [options.now]
 */
export function createSomnia({ dir = path.join(os.homedir(), '.dsh', 'memory'), generate, now = Date.now, embed } = {}) {
  const paths = {
    dir,
    episodes: path.join(dir, 'episodes.jsonl'),
    archive: path.join(dir, 'episodes-archive.jsonl'),
    memory: path.join(dir, 'memory.json'),
    snapshots: path.join(dir, 'snapshots'),
    dreams: path.join(dir, 'dreams'),
    report: path.join(dir, 'dream-report.md'),
    journal: path.join(dir, 'dream-journal.json'),
    state: path.join(dir, 'state.json'),
    legacy: path.join(dir, 'store.json'),
  }

  let memory = null
  let runtime = null
  let dreaming = false

  function loadState() {
    if (runtime !== null) return runtime
    const parsed = readJson(paths.state, {})
    runtime = {
      state: typeof parsed.state === 'string' ? parsed.state : 'asleep',
      since: Number(parsed.since) || now(),
      lastDreamAt: Number(parsed.lastDreamAt) || 0,
      lastWashAt: Number(parsed.lastWashAt) || 0,
      idleMinutes: Number(parsed.idleMinutes) > 0 ? Number(parsed.idleMinutes) : 10,
      paused: parsed.paused === true,
    }
    return runtime
  }

  function persistState() {
    atomicWrite(paths.state, JSON.stringify(runtime, null, 2))
  }

  function setState(next) {
    const data = loadState()
    if (data.state === next) return
    data.state = next
    data.since = now()
    persistState()
  }

  function emptyMemory() {
    return { version: 4, updatedAt: 0, entries: [] }
  }

  function loadMemory() {
    if (memory !== null) return memory
    const parsed = readJson(paths.memory, null)
    if (parsed && Array.isArray(parsed.entries)) {
      memory = {
        version: 5,
        updatedAt: Number(parsed.updatedAt) || 0,
        entries: migrateEntries(parsed.entries.map((entry) => ({ ...entry, pinned: Boolean(entry.pinned) }))),
      }
      // The file mirror is user-editable; an edit there must win over the JSON written earlier.
      const fileEntries = readFileEntries(path.join(paths.dir, 'memory'))
      if (fileEntries.length > 0) {
        const byId = new Map(memory.entries.map((entry) => [entry.id, entry]))
        for (const fileEntry of fileEntries) {
          const existing = byId.get(fileEntry.id)
          if (existing !== undefined) {
            existing.text = fileEntry.text
            if (fileEntry.scope !== undefined) existing.scope = fileEntry.scope
            existing.status = fileEntry.status
            existing.confidence = fileEntry.confidence
            if (fileEntry.source !== undefined && fileEntry.source.quote) existing.source = { ...(existing.source || {}), ...fileEntry.source }
            existing.reviewedAt = now()
          } else {
            memory.entries.push({
              ...fileEntry,
              pinned: false,
              firstSeen: now(),
              reviewedAt: now(),
              lastConfirmedAt: now(),
              lastUsedAt: 0,
              uses: 0,
              validFrom: now(),
              history: [],
            })
          }
        }
      }
      return memory
    }
    memory = emptyMemory()
    const legacy = readJson(paths.legacy, null)
    if (legacy && Array.isArray(legacy.entries)) {
      memory.entries = legacy.entries.map((entry) => ({
        id: entry.id || randomUUID(),
        section: SECTION_OF_KIND[entry.kind] || 'notes',
        text: normalizeText(entry.text),
        confidence: clamp(entry.confidence ?? 0.5),
        status: 'foreground',
        pinned: Boolean(entry.pinned),
        firstSeen: entry.createdAt || now(),
        reviewedAt: now(),
        lastUsedAt: entry.lastUsedAt || 0,
        uses: entry.uses || 0,
      }))
    }
    return memory
  }

  function persistMemory() {
    memory.updatedAt = now()
    atomicWrite(paths.memory, JSON.stringify(memory, null, 2))
    // Claude-style mirror: MEMORY.md index plus one file per entry, so the store is auditable and
    // editable outside the plugin. The JSON stays the machine source of truth.
    try { writeFileMemory(path.join(paths.dir, 'memory'), memory.entries) } catch (error) { /* mirror is best effort */ }
  }

  function snapshotMemory() {
    try {
      fs.mkdirSync(paths.snapshots, { recursive: true })
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      atomicWrite(path.join(paths.snapshots, `${stamp}.json`), JSON.stringify(loadMemory(), null, 2))
      const files = fs.readdirSync(paths.snapshots).filter((file) => file.endsWith('.json')).sort()
      for (const file of files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP))) {
        try { fs.unlinkSync(path.join(paths.snapshots, file)) } catch (error) { /* best effort */ }
      }
    } catch (error) {
      /* a missing snapshot must not block a dream */
    }
  }

  function capture(session, text) {
    const clean = redactSecrets(normalizeText(text))
    if (clean.length < 3 || clean.length > 600) return false
    try {
      fs.mkdirSync(paths.dir, { recursive: true })
      const record = { t: now(), session: String(session || ''), text: clean }
      if (typeof embed === 'function') {
        const vector = embed(clean)
        if (Array.isArray(vector) && vector.length > 0) record.v = vector
      }
      fs.appendFileSync(paths.episodes, JSON.stringify(record) + '\n', 'utf8')
      return true
    } catch (error) {
      return false
    }
  }

  function loadEpisodes() {
    let text = ''
    try {
      text = fs.readFileSync(paths.episodes, 'utf8')
    } catch (error) {
      return []
    }
    const out = []
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue
      try {
        const entry = JSON.parse(line)
        if (entry && typeof entry.text === 'string' && entry.text.length > 0) out.push(entry)
      } catch (error) { /* skip torn line */ }
    }
    return out
  }

  function loadArchivedEpisodes() {
    let text = ''
    try {
      text = fs.readFileSync(paths.archive, 'utf8')
    } catch (error) {
      return []
    }
    const out = []
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue
      try {
        const entry = JSON.parse(line)
        if (entry && typeof entry.text === 'string' && entry.text.length > 0) out.push(entry)
      } catch (error) { /* skip torn line */ }
    }
    return out
  }

  function trimEpisodes() {
    const at = now()
    const all = loadEpisodes()
    const kept = []
    const archived = []
    for (const entry of all) {
      if (at - (entry.t || 0) <= EPISODE_TTL_MS) kept.push(entry)
      else archived.push(entry)
    }
    while (kept.length > EPISODE_MAX) archived.push(kept.shift())
    if (archived.length > 0) {
      fs.mkdirSync(paths.dir, { recursive: true })
      fs.appendFileSync(paths.archive, archived.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
    }
    atomicWrite(paths.episodes, kept.map((entry) => JSON.stringify(entry)).join('\n') + (kept.length > 0 ? '\n' : ''))
    return kept
  }

  function writeJournal(value) {
    atomicWrite(paths.journal, JSON.stringify(value, null, 2))
  }

  function writeReport(startedAt, lines) {
    const body = [`# Dream ${new Date(startedAt).toISOString().slice(0, 10)}`, '', ...lines, ''].join('\n')
    fs.mkdirSync(paths.dreams, { recursive: true })
    atomicWrite(path.join(paths.dreams, `${new Date(startedAt).toISOString().slice(0, 10)}.md`), body)
    atomicWrite(paths.report, body)
  }

  /** Relevance of an entry to the current context (workspace path, query), used before injection. */
  function relevanceOf(entry, context) {
    const hay = String(context || '').toLowerCase()
    if (hay.length === 0) return 0
    const scope = entry.scope || {}
    let score = 0
    if (scope.object && hay.includes(String(scope.object).toLowerCase())) score += 3
    if (scope.situation && hay.includes(String(scope.situation).toLowerCase())) score += 1
    if (scope.excludes && hay.includes(String(scope.excludes).toLowerCase())) score -= 4
    return score
  }

  function injectText(context) {
    if (loadState().paused === true) return ''
    const data = loadMemory()
    const pinned = data.entries.filter((entry) => entry.pinned)
    const profile = data.entries.filter((entry) => !entry.pinned
      && entry.status === 'foreground'
      && (entry.section === 'identity' || entry.section === 'preferences'))
    const candidates = data.entries
      .filter((entry) => !entry.pinned && !profile.includes(entry) && entry.status === 'foreground')
      .map((entry) => ({ entry, relevance: relevanceOf(entry, context), at: entry.lastUsedAt || entry.reviewedAt || 0 }))
      // Negative relevance means the entry says it does not apply here; drop it entirely.
      .filter((item) => item.relevance > -4)
      .sort((left, right) => (right.relevance - left.relevance) || (right.at - left.at))
      .map((item) => item.entry)
      .slice(0, INJECT_LIMIT)
    if (pinned.length + profile.length + candidates.length === 0) return ''
    const lines = ['Long-term memory (pinned and profile entries are verbatim; the rest is a summary; use the memory tool to search for more):']
    let used = lines[0].length
    const push = (label, entry) => {
      const line = `- [${label}/${entry.section}] ${entry.text}${scopeLine(entry.scope)}`
      if (used + line.length > INJECT_MAX_CHARS) return false
      lines.push(line)
      used += line.length + 1
      return true
    }
    for (const entry of pinned) if (!push('pinned', entry)) break
    for (const entry of profile) if (!push('profile', entry)) break
    for (const entry of candidates) if (!push('summary', entry)) break
    return lines.join('\n')
  }

  function setPaused(paused) {
    loadState().paused = paused
    persistState()
    return { paused }
  }

  /** Flatten the whole store into one markdown document for export. */
  function exportAll() {
    const data = loadMemory()
    fs.mkdirSync(path.join(paths.dir, 'export'), { recursive: true })
    const body = [readIndex(path.join(paths.dir, 'memory')), '', '---', '']
    for (const entry of data.entries) {
      body.push('## ' + entry.section + ' · ' + entry.id, '', entry.text, '')
      if (entry.scope) body.push('scope: ' + scopeLine(entry.scope).replace(/[()]/g, ''), '')
      if (entry.source && entry.source.quote) body.push('> ' + entry.source.quote, '')
      body.push('---', '')
    }
    const file = path.join(paths.dir, 'export', 'memory.md')
    atomicWrite(file, body.join('\n'))
    return { path: file, entries: data.entries.length }
  }

  async function dream(reason = 'manual') {
    if (dreaming) return { skipped: true }
    dreaming = true
    const startedAt = now()
    const state = loadState()
    setState('sleeping')
    writeJournal({ phase: 'replay', reason, startedAt })
    try {
      const allEpisodes = trimEpisodes()
      const since = reason === 'wash' ? 0 : state.lastDreamAt
      const newEpisodes = selectSalient(allEpisodes, startedAt, since)
      const shouldRewrite = newEpisodes.length > 0 || reason === 'wash'
      const oldPool = allEpisodes.filter((entry) => (entry.t || 0) <= since && startedAt - (entry.t || 0) <= EPISODE_TTL_MS)
      const replayed = shouldRewrite ? sampleEvenly(oldPool, REPLAY_OLD_MAX).map((entry) => ({ ...entry, replayed: true })) : []
      const salient = newEpisodes.concat(replayed)
      const before = loadMemory()
      let next = before.entries
      let engine = 'maintenance'
      let hypotheses = []

      let usage = null
      let opStats = []
      if (shouldRewrite && typeof generate === 'function') {
        writeJournal({ phase: 'ops', reason, startedAt, episodes: salient.length })
        let text = null
        try {
          const generated = await generate({
            system: OPS_SYSTEM,
            user: opsPrompt(before, salient, startedAt),
            maxTokens: 8000,
          })
          if (typeof generated === 'string') {
            text = generated
          } else if (generated && typeof generated === 'object') {
            text = typeof generated.text === 'string' ? generated.text : null
            usage = generated.usage || null
          }
        } catch (error) {
          text = null
        }
        const parsed = parseRewrite(text)
        const usable = parsed !== null && Array.isArray(parsed.ops)
        if (!usable) {
          writeJournal({ phase: 'ops-rejected', reason, raw: typeof text === 'string' ? text.slice(0, 800) : null })
          try {
            fs.mkdirSync(paths.dreams, { recursive: true })
            atomicWrite(path.join(paths.dreams, 'ops-raw.txt'), typeof text === 'string' ? text.slice(0, 4000) : '(no text)')
          } catch (error) { /* best effort */ }
        }
        if (usable) {
          const applied = applyOps(parsed.ops, before, startedAt, salient)
          next = applied.entries
          opStats = applied.results
          engine = 'model'
        } else {
          // Ops unusable: keep the previous curated entries. No whole-store rewrite exists any more,
          // so a failed dream can only fail to add — it can never erase.
          next = before.entries
          engine = 'fallback'
        }
      }

      writeJournal({ phase: 'downscale', reason, startedAt, engine })
      const finalEntries = downscale(next, startedAt)
      const costCny = estimateCostCny(usage)
      if (engine === 'model' || engine === 'fallback') snapshotMemory()
      memory.entries = finalEntries
      persistMemory()
      state.lastDreamAt = startedAt
      state.lastWashAt = startedAt
      persistState()

      writeReport(startedAt, [
        `- Reason: ${reason}`,
        `- Engine: ${engine}`,
        `- Episodes in buffer: ${allEpisodes.length}`,
        `- New episodes since last dream: ${since === 0 ? 'all' : new Date(since).toISOString()}`,
        `- Salient episodes: ${salient.length}`,
        `- Replayed older: ${replayed.length}`,
        `- Entries: ${before.entries.length} -> ${finalEntries.length}`,
        `- Hypotheses: ${hypotheses.length}`,
        `- Tokens: ${usage ? `${usage.inputTokens ?? usage.prompt_tokens ?? '?'} in / ${usage.outputTokens ?? usage.completion_tokens ?? '?'} out` : 'n/a'}`,
        `- Cost estimate (CNY, flash off-peak): ${costCny === null ? 'n/a' : costCny}`,
        '',
        '## Kept',
        ...(finalEntries.filter((entry) => entry.status === 'foreground').length === 0
          ? ['- none']
          : finalEntries.filter((entry) => entry.status === 'foreground').map((entry) => `- [${entry.section}] ${entry.text}`)),
        '',
        '## Background',
        ...(finalEntries.filter((entry) => entry.status === 'background' && entry.section !== 'hypotheses').length === 0
          ? ['- none']
          : finalEntries.filter((entry) => entry.status === 'background' && entry.section !== 'hypotheses').map((entry) => `- [${entry.section}] ${entry.text}`)),
        '',
        '## Hypotheses',
        ...(hypotheses.length === 0 ? ['- none'] : hypotheses.map((entry) => `- ${entry.text}`)),
      ])
      writeJournal({ phase: 'done', reason, startedAt, finishedAt: now(), engine, episodes: salient.length, entries: finalEntries.length, hypotheses: hypotheses.length, usage, costCny })
      return { engine, entries: finalEntries.length, hypotheses: hypotheses.length, episodes: salient.length, usage, costCny }
    } catch (error) {
      writeJournal({ phase: 'failed', reason, startedAt, error: String(error) })
      return { error: String(error) }
    } finally {
      dreaming = false
      setState('asleep')
    }
  }

  function saveEntry(args) {
    const data = loadMemory()
    const text = redactSecrets(normalizeText(args.text))
    if (text.length === 0) throw new Error('text is required')
    const section = SECTION_OF_KIND[args.kind] || 'notes'
    const subject = normalizeSubject(args.subject)
    const at = now()
    const existing = data.entries.find((entry) => entry.section === section && entry.text === text)
    if (existing !== undefined) {
      existing.confidence = Math.max(existing.confidence, clamp(args.confidence ?? 0.6))
      existing.status = 'foreground'
      if (args.pinned) existing.pinned = true
      if (subject !== undefined) existing.subject = subject
      existing.reviewedAt = at
      persistMemory()
      return existing
    }
    const entry = {
      id: randomUUID(), section, text,
      confidence: clamp(args.confidence ?? 0.6),
      status: 'foreground',
      pinned: Boolean(args.pinned),
      subject,
      firstSeen: at, reviewedAt: at, lastUsedAt: 0, uses: 0,
    }
    snapshotMemory()
    data.entries.push(entry)
    if (data.entries.length > MEMORY_MAX) {
      const pinnedEntries = data.entries.filter((item) => item.pinned)
      const rest = data.entries.filter((item) => !item.pinned).slice(0, Math.max(0, MEMORY_MAX - pinnedEntries.length))
      data.entries = pinnedEntries.concat(rest)
    }
    persistMemory()
    return entry
  }

  function searchEntries(query, limit) {
    const data = loadMemory()
    const scored = data.entries
      .map((entry) => ({ entry, score: rankScore(query, entry.text) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
    for (const { entry } of scored) {
      entry.uses = (entry.uses || 0) + 1
      entry.lastUsedAt = now()
    }
    if (scored.length > 0) persistMemory()
    return scored.map(({ entry }) => entry)
  }

  function setStatus(id, status) {
    const data = loadMemory()
    const entry = data.entries.find((item) => item.id === id)
    if (entry === undefined) return false
    entry.status = status
    entry.reviewedAt = now()
    persistMemory()
    return true
  }

  function restoreSnapshot(name) {
    const file = path.join(paths.snapshots, path.basename(name))
    if (!fs.existsSync(file)) throw new Error('snapshot not found')
    const parsed = readJson(file, null)
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error('invalid snapshot')
    snapshotMemory()
    memory = { version: 4, updatedAt: now(), entries: parsed.entries.map((entry) => ({ ...entry, pinned: Boolean(entry.pinned) })) }
    persistMemory()
    return { entries: memory.entries.length }
  }

  function retrieve(query, limit = 8) {
    const text = normalizeText(query)
    if (text.length === 0) return { entries: [], episodes: [] }
    const data = loadMemory()
    const active = loadEpisodes()
    const archived = loadArchivedEpisodes()
    const episodePool = active.concat(archived)
    const bm25 = bm25Scores(text, episodePool.map((episode) => episode.text))
    const maxBm25 = Math.max(0, ...bm25)
    const queryVec = typeof embed === 'function' ? (() => { const q = embed(text); return Array.isArray(q) ? q : null })() : null
    const scored = []
    for (const entry of data.entries) {
      const score = rankScore(text, entry.text)
      if (score > 0) scored.push({ kind: 'entry', score, entry })
    }
    for (let index = 0; index < episodePool.length; index += 1) {
      const episode = episodePool[index]
      const lexical = rankScore(text, episode.text)
      const bm = maxBm25 > 0 ? bm25[index] / maxBm25 : 0
      const relevance = lexical * 0.45 + bm * 0.55
      const sem = (queryVec && Array.isArray(episode.v)) ? vecCos(queryVec, episode.v) : 0
      if (relevance <= 0 && sem <= 0.35) continue
      const ageDays = Math.max(0, (now() - (episode.t || now())) / 86400000)
      const recency = Math.exp(-ageDays / 30)
      const score = relevance + sem * 0.4 + recency * 0.15
      scored.push({ kind: 'episode', score, episode, archived: index >= active.length })
    }
    const timeOf = (hit) => (hit.kind === 'episode' && hit.episode && typeof hit.episode.t === 'number') ? hit.episode.t : 0
    scored.sort((left, right) => (right.score - left.score) || (timeOf(right) - timeOf(left)))
    const top = scored.slice(0, limit)
    const at = now()
    for (const hit of top) {
      if (hit.kind === 'entry') {
        hit.entry.uses = (hit.entry.uses || 0) + 1
        hit.entry.lastUsedAt = at
      }
    }
    if (top.some((hit) => hit.kind === 'entry')) persistMemory()
    const entryHits = top.filter((hit) => hit.kind === 'entry')
    const bySubject = new Map()
    for (const hit of entryHits) {
      if (hit.entry.subject) {
        const list = bySubject.get(hit.entry.subject) || []
        list.push(hit.entry)
        bySubject.set(hit.entry.subject, list)
      }
    }
    const superseded = new Set()
    for (const list of bySubject.values()) {
      if (list.length < 2) continue
      list.sort((left, right) => (right.lastConfirmedAt || right.firstSeen || 0) - (left.lastConfirmedAt || left.firstSeen || 0))
      for (let index = 1; index < list.length; index += 1) superseded.add(list[index].id)
    }
    // Implicit same-subject supersession: subject-less entries that are lexically close are
    // treated as versions of one fact, latest wins. A heuristic, not entity linking.
    const noSubject = entryHits.map((hit) => hit.entry).filter((entry) => !entry.subject)
    const implicit = []
    for (const entry of noSubject) {
      let placed = false
      for (const group of implicit) {
        if (contentOverlap(group[0].text, entry.text) >= 0.5) { group.push(entry); placed = true; break }
      }
      if (!placed) implicit.push([entry])
    }
    for (const group of implicit) {
      if (group.length < 2) continue
      group.sort((left, right) => (right.lastConfirmedAt || right.firstSeen || 0) - (left.lastConfirmedAt || left.firstSeen || 0))
      for (let index = 1; index < group.length; index += 1) superseded.add(group[index].id)
    }
    const episodes = top.filter((hit) => hit.kind === 'episode').map((hit) => ({ ...hit.episode, score: hit.score, archived: Boolean(hit.archived) }))
    return {
      entries: entryHits.map((hit) => ({ ...hit.entry, score: hit.score, superseded: superseded.has(hit.entry.id) })),
      episodes,
      timeline: episodes.slice().sort((left, right) => (left.t || 0) - (right.t || 0)),
    }
  }

  async function action(args) {
    switch (args.action) {
      case 'save': return saveEntry(args)
      case 'search': {
        if (typeof args.query !== 'string' || args.query.trim().length === 0) throw new Error('search requires query')
        return searchEntries(args.query, Math.min(Math.max(Number(args.limit) || 5, 1), 50))
      }
      case 'recall': {
        if (typeof args.query !== 'string' || args.query.trim().length === 0) throw new Error('recall requires query')
        return retrieve(args.query, Math.min(Math.max(Number(args.limit) || 8, 1), 20))
      }
      case 'list': {
        const data = loadMemory()
        return data.entries
          .filter((entry) => args.status === undefined || entry.status === args.status)
          .sort((left, right) => (right.reviewedAt || 0) - (left.reviewedAt || 0))
          .slice(0, Math.min(Math.max(Number(args.limit) || 50, 1), 200))
      }
      case 'hide':
      case 'show':
        if (typeof args.id !== 'string' || args.id.length === 0) throw new Error(args.action + ' requires id')
        return { changed: setStatus(args.id, args.action === 'hide' ? 'background' : 'foreground') }
      case 'pin': {
        if (typeof args.id !== 'string' || args.id.length === 0) throw new Error('pin requires id')
        const data = loadMemory()
        const entry = data.entries.find((item) => item.id === args.id)
        if (entry === undefined) return { changed: false }
        entry.pinned = args.pinned !== false
        entry.reviewedAt = now()
        persistMemory()
        return { changed: true, pinned: entry.pinned }
      }
      case 'forget': {
        if (typeof args.id !== 'string' || args.id.length === 0) throw new Error('forget requires id')
        const data = loadMemory()
        const index = data.entries.findIndex((entry) => entry.id === args.id)
        if (index < 0) return { removed: false }
        snapshotMemory()
        data.entries.splice(index, 1)
        persistMemory()
        return { removed: true }
      }
      case 'dream':
      case 'wash':
        return dream(args.action)
      case 'state':
        return {
          ...loadState(),
          dreaming,
          entries: loadMemory().entries.length,
          episodes: loadEpisodes().length,
        }
      case 'config': {
        const minutes = Number(args.idleMinutes)
        if (!Number.isFinite(minutes) || minutes < 0) throw new Error('idleMinutes must be a non-negative number')
        loadState().idleMinutes = minutes
        persistState()
        return { idleMinutes: minutes }
      }
      case 'pause':
      case 'resume':
        return setPaused(args.action === 'pause')
      case 'export':
        return exportAll()
      case 'source': {
        if (typeof args.id !== 'string' || args.id.length === 0) throw new Error('source requires id')
        const entry = loadMemory().entries.find((item) => item.id === args.id)
        if (entry === undefined) return { found: false }
        return {
          found: true,
          id: entry.id,
          text: entry.text,
          scope: entry.scope || null,
          quote: entry.source && entry.source.quote ? entry.source.quote : null,
          episodes: entry.source && Array.isArray(entry.source.episodes) ? entry.source.episodes : [],
          reviewedAt: entry.reviewedAt || entry.firstSeen || null,
        }
      }
      case 'edit': {
        if (typeof args.id !== 'string' || args.id.length === 0) throw new Error('edit requires id')
        const entry = loadMemory().entries.find((item) => item.id === args.id)
        if (entry === undefined) return { changed: false }
        if (entry.pinned) throw new Error('pinned entries cannot be edited by the tool')
        if (typeof args.text === 'string' && args.text.trim().length >= 2) {
          entry.history.push({ at: now(), op: 'EDIT', text: entry.text, scope: entry.scope })
          entry.text = normalizeText(args.text).slice(0, 300)
        }
        if (args.scope !== undefined && args.scope !== null && typeof args.scope === 'object') {
          const object = normalizeText(args.scope.object)
          if (object.length > 0) {
            const situation = normalizeText(args.scope.situation)
            const excludes = normalizeText(args.scope.excludes)
            entry.scope = { object, situation, ...(excludes.length > 0 ? { excludes } : {}) }
          }
        }
        entry.reviewedAt = now()
        persistMemory()
        return { changed: true, entry }
      }
      case 'snapshots':
        try {
          return fs.readdirSync(paths.snapshots).filter((file) => file.endsWith('.json')).sort().reverse().slice(0, 20)
        } catch (error) {
          return []
        }
      case 'restore':
        if (typeof args.name !== 'string' || args.name.length === 0) throw new Error('restore requires name')
        return restoreSnapshot(args.name)
      default:
        throw new Error(`unknown memory action "${args.action}"`)
    }
  }

  function setIdleMinutes(minutes) {
    const value = Number(minutes)
    if (Number.isFinite(value) && value > 0) {
      loadState().idleMinutes = value
      persistState()
    }
  }

  return {
    dir,
    paths,
    capture,
    dream,
    injectText,
    retrieve,
    action,
    setIdleMinutes,
    setState,
    state: () => loadState(),
    memory: () => loadMemory(),
    episodes: () => loadEpisodes(),
    sections: SECTIONS,
    kindOfSection: KIND_OF_SECTION,
  }
}
