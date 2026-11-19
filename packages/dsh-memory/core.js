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

export const SECTIONS = ['identity', 'preferences', 'projects', 'plans', 'lessons', 'hypotheses', 'notes']
export const EPISODE_TTL_MS = 7 * 86400000
export const EPISODE_MAX = 2000
export const EPISODE_SALIENT_MAX = 40
export const MEMORY_MAX = 40
export const SNAPSHOT_KEEP = 20
export const INJECT_LIMIT = 8
export const INJECT_MAX_CHARS = 1400

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
  '- Test-only or temporary preferences must be status "background".',
  '- Demote stale or rarely relevant items to status "background"; drop what no longer matters.',
  '- Never store secrets, tokens, personal identifiers, hypotheticals, or one-off chatter.',
  '- Hypotheses: at most 3 tentative connections, clearly tentative, confidence <= 0.4.',
  'Return strict JSON and nothing else:',
  '{"entries":[{"section":"identity|preferences|projects|plans|lessons|notes","text":"...","confidence":0.6,"status":"foreground|background","source":"2026-11-17T21:00:00Z"}],"hypotheses":[{"text":"...","confidence":0.3}]}',
].join('\n')

const SECTION_OF_KIND = { preference: 'preferences', fact: 'projects', lesson: 'lessons', note: 'notes' }
const KIND_OF_SECTION = { identity: 'fact', preferences: 'preference', projects: 'fact', plans: 'fact', lessons: 'lesson', hypotheses: 'note', notes: 'note' }

export function normalizeText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
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

/** Word/CJK overlap + character-bigram cosine. Better for Chinese than Jaccard alone. */
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

export function applyRewrite(parsed, previous, now = Date.now()) {
  const oldEntries = previous.entries.slice()
  const entries = []
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
      source: typeof raw.source === 'string' ? raw.source : (match ? match.source || null : null),
      firstSeen: match ? match.firstSeen : now,
      reviewedAt: now,
      lastConfirmedAt: now,
      lastUsedAt: match ? match.lastUsedAt || 0 : 0,
      uses: match ? match.uses || 0 : 0,
    })
    if (entries.length >= MEMORY_MAX) break
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

export function downscale(entries, now = Date.now()) {
  const out = []
  for (const entry of entries) {
    const idleDays = (now - (entry.lastUsedAt || entry.firstSeen || now)) / 86400000
    if (idleDays > 30 && (entry.uses || 0) === 0 && entry.status === 'foreground') entry.status = 'background'
    if (idleDays > 90 && (entry.uses || 0) === 0) entry.confidence = Math.max(0, (entry.confidence ?? 0) - 0.2)
    if ((entry.confidence ?? 0) >= 0.15 || (entry.uses ?? 0) > 0) out.push(entry)
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
      source: entry.source || null,
      lastUsedAt: entry.lastUsedAt || 0,
    })),
    episodes: episodes.slice(-12).map((entry) => ({ t: new Date(entry.t).toISOString(), text: entry.text.slice(0, 200) })),
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
export function createSomnia({ dir = path.join(os.homedir(), '.dsh', 'memory'), generate, now = Date.now } = {}) {
  const paths = {
    dir,
    episodes: path.join(dir, 'episodes.jsonl'),
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
    return { version: 3, updatedAt: 0, entries: [] }
  }

  function loadMemory() {
    if (memory !== null) return memory
    const parsed = readJson(paths.memory, null)
    if (parsed && Array.isArray(parsed.entries)) {
      memory = { version: 3, updatedAt: Number(parsed.updatedAt) || 0, entries: parsed.entries }
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
    if (clean.length < 6 || clean.length > 600) return false
    try {
      fs.mkdirSync(paths.dir, { recursive: true })
      fs.appendFileSync(paths.episodes, JSON.stringify({ t: now(), session: String(session || ''), text: clean }) + '\n', 'utf8')
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

  function trimEpisodes() {
    const at = now()
    const kept = loadEpisodes().filter((entry) => at - (entry.t || 0) <= EPISODE_TTL_MS).slice(-EPISODE_MAX)
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

  function injectText() {
    const data = loadMemory()
    const foreground = data.entries
      .filter((entry) => entry.status === 'foreground')
      .sort((left, right) => (right.lastUsedAt || right.reviewedAt || 0) - (left.lastUsedAt || left.reviewedAt || 0))
      .slice(0, INJECT_LIMIT)
    if (foreground.length === 0) return ''
    const lines = ['Long-term memory (synthesized summary; use the memory tool to search for more):']
    let used = lines[0].length
    for (const entry of foreground) {
      const line = `- [${entry.section}] ${entry.text}`
      if (used + line.length > INJECT_MAX_CHARS) break
      lines.push(line)
      used += line.length + 1
    }
    return lines.join('\n')
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
      const salient = selectSalient(allEpisodes, startedAt, since)
      const before = loadMemory()
      let next = before.entries
      let engine = 'maintenance'
      let hypotheses = []
      const shouldRewrite = salient.length > 0 || reason === 'wash'

      let usage = null
      if (shouldRewrite && typeof generate === 'function') {
        writeJournal({ phase: 'rewrite', reason, startedAt, episodes: salient.length })
        let text = null
        try {
          const generated = await generate({
            system: REWRITE_SYSTEM,
            user: selectionPrompt(before, salient, startedAt),
            maxTokens: 1200,
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
        const usable = parsed !== null && Array.isArray(parsed.entries)
          && (parsed.entries.length > 0 || before.entries.length === 0)
        if (usable) {
          const rewrite = applyRewrite(parsed, before, startedAt)
          next = rewrite.entries
          hypotheses = rewrite.hypotheses
          engine = 'model'
        } else {
          const at = now()
          for (const episode of salient.slice(-10)) {
            next = next.concat([{
              id: randomUUID(),
              section: 'notes',
              text: episode.text.slice(0, 300),
              confidence: 0.3,
              status: 'background',
              firstSeen: at,
              reviewedAt: at,
              lastUsedAt: 0,
              uses: 0,
            }])
          }
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
    const at = now()
    const existing = data.entries.find((entry) => entry.section === section && entry.text === text)
    if (existing !== undefined) {
      existing.confidence = Math.max(existing.confidence, clamp(args.confidence ?? 0.6))
      existing.status = 'foreground'
      existing.reviewedAt = at
      persistMemory()
      return existing
    }
    const entry = {
      id: randomUUID(), section, text,
      confidence: clamp(args.confidence ?? 0.6),
      status: 'foreground',
      firstSeen: at, reviewedAt: at, lastUsedAt: 0, uses: 0,
    }
    snapshotMemory()
    data.entries.push(entry)
    if (data.entries.length > MEMORY_MAX) data.entries.length = MEMORY_MAX
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
    memory = { version: 3, updatedAt: now(), entries: parsed.entries }
    persistMemory()
    return { entries: memory.entries.length }
  }

  async function action(args) {
    switch (args.action) {
      case 'save': return saveEntry(args)
      case 'search': {
        if (typeof args.query !== 'string' || args.query.trim().length === 0) throw new Error('search requires query')
        return searchEntries(args.query, Math.min(Math.max(Number(args.limit) || 5, 1), 50))
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
