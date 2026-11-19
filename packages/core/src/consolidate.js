/**
 * Scoped, operation-based memory consolidation — the ported write pipeline.
 *
 * Adoption: docs/adoption/memory.md. Mem0 supplies the ADD/UPDATE/DELETE/NOOP op model and the
 * "extract, never rewrite the store" rule; Graphiti supplies validity intervals
 * (validFrom/validTo, supersede by invalidation). Everything here is a pure function so the
 * failure-mode eval can run without a model.
 */

export const SECTIONS = ['identity', 'preferences', 'projects', 'plans', 'lessons', 'notes', 'hypotheses']

/** Wording that turns a one-off decision into a stated general rule. */
const GENERAL_CUE = /(以后|今后|一律|每次都|都要|都用|都按|默认(都)?|always|from now on|by default|as a rule|general rule)/i

const MAX_TEXT = 300

export function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function clampNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.6
  return Math.min(1, Math.max(0, number))
}

export function similar(left, right) {
  const a = text(left).toLowerCase()
  const b = text(right).toLowerCase()
  if (a.length === 0 || b.length === 0) return 0
  const grams = new Map()
  for (let index = 0; index + 1 < a.length; index += 1) grams.set(a.slice(index, index + 2), (grams.get(a.slice(index, index + 2)) || 0) + 1)
  let overlap = 0
  for (let index = 0; index + 1 < b.length; index += 1) {
    const gram = b.slice(index, index + 2)
    const count = grams.get(gram) || 0
    if (count > 0) {
      overlap += 1
      grams.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1))
}

/** A scope is required for every stored claim: what it applies to, and in which situation. */
export function normalizeScope(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const object = text(raw.object)
  if (object.length === 0) return undefined
  const situation = text(raw.situation)
  const excludes = text(raw.excludes)
  return {
    object: object.slice(0, 120),
    situation: situation.slice(0, 200),
    ...(excludes.length > 0 ? { excludes: excludes.slice(0, 200) } : {}),
  }
}

export function scopeLine(scope) {
  if (!scope || !scope.object) return ''
  const parts = ['适用于 ' + scope.object]
  if (scope.situation) parts.push(scope.situation)
  if (scope.excludes) parts.push('不含 ' + scope.excludes)
  return '（' + parts.join('；') + '）'
}

/** Add the v5 fields to entries written by the previous schema, without touching their meaning. */
export function migrateEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const scope = normalizeScope(entry.scope)
    const source = entry.source && typeof entry.source === 'object'
      ? entry.source
      : (typeof entry.source === 'string' ? { at: entry.source, ts: Number(entry.source) || undefined } : undefined)
    return {
      ...entry,
      pinned: Boolean(entry.pinned),
      scope,
      source,
      validFrom: entry.validFrom ?? entry.firstSeen ?? undefined,
      validTo: entry.validTo ?? undefined,
      supersededBy: entry.supersededBy ?? undefined,
      history: Array.isArray(entry.history) ? entry.history : [],
    }
  })
}

function episodeQuote(episodes, ids, quote) {
  if (quote && text(quote).length > 0) return text(quote).slice(0, MAX_TEXT)
  const list = Array.isArray(episodes) ? episodes : []
  const found = list.find((episode) => ids.includes(String(episode.id)))
  return found ? text(found.text).slice(0, MAX_TEXT) : ''
}

function sourceOf(raw, episodes, now) {
  const ids = Array.isArray(raw.episodes) ? raw.episodes.map(String) : []
  const list = Array.isArray(episodes) ? episodes : []
  const first = list.find((episode) => ids.includes(String(episode.id)))
  return {
    episodes: ids,
    quote: episodeQuote(list, ids, raw.quote),
    at: first && Number(first.t) ? Number(first.t) : now,
  }
}

/**
 * Apply an op list to the previous store.
 * Never rewrites an unchanged entry; ids survive updates; deletion invalidates instead of erasing.
 *
 * @returns {{ entries: object[], results: object[] }}
 */
export function applyOps(ops, previous, now = Date.now(), episodes = []) {
  const before = Array.isArray(previous && previous.entries) ? previous.entries : []
  const entries = before.map((entry) => ({ ...entry, history: Array.isArray(entry.history) ? entry.history.slice() : [] }))
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const results = []

  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = String((raw && raw.op) || '').toLowerCase()

    if (op === 'noop') {
      results.push({ op: 'NOOP', accepted: true })
      continue
    }

    if (op === 'add') {
      const claim = text(raw.text)
      if (claim.length < 2) {
        results.push({ op: 'ADD', accepted: false, reason: 'empty text' })
        continue
      }
      let section = SECTIONS.includes(raw.section) ? raw.section : 'notes'
      const scope = normalizeScope(raw.scope)
      const source = sourceOf(raw, episodes, now)
      const general = raw.general === true || GENERAL_CUE.test(source.quote) || GENERAL_CUE.test(claim)
      let demoted = false
      let reason
      if (section === 'preferences' && !general) {
        section = 'notes'
        demoted = true
        reason = 'one-off decision demoted to notes; no general rule in the user words'
      }
      if (scope === undefined) {
        results.push({ op: 'ADD', accepted: false, reason: 'scope.object is required' })
        continue
      }
      if (section === 'preferences' && (scope.object.length === 0 || /未确认/.test(scope.object))) {
        results.push({ op: 'ADD', accepted: false, reason: 'preference needs a concrete scope.object' })
        continue
      }
      const duplicate = entries.find((entry) =>
        entry.section === section && similar(entry.text, claim) >= 0.9 && scopeLine(entry.scope) === scopeLine(scope))
      if (duplicate !== undefined) {
        results.push({ op: 'ADD', accepted: false, reason: 'duplicate', id: duplicate.id })
        continue
      }
      const entry = {
        id: raw.id ? String(raw.id) : cryptoId(),
        section,
        text: claim.slice(0, MAX_TEXT),
        confidence: clampNumber(raw.confidence ?? 0.6),
        status: demoted || raw.status === 'background' ? 'background' : 'foreground',
        pinned: false,
        subject: raw.subject ? text(raw.subject).slice(0, 80) : undefined,
        scope,
        source,
        validFrom: now,
        history: [],
        firstSeen: now,
        reviewedAt: now,
        lastConfirmedAt: now,
        lastUsedAt: 0,
        uses: 0,
      }
      entries.push(entry)
      byId.set(entry.id, entry)
      // Programmatic conflict resolution: a newer claim about the same subject supersedes the older
      // one instead of leaving two contradictory foreground entries behind.
      const subject = entry.subject && entry.subject.trim().toLowerCase()
      let supersededId
      if (subject) {
        for (const other of entries) {
          if (other === entry) continue
          if (other.section !== section) continue
          if (!other.subject || other.subject.trim().toLowerCase() !== subject) continue
          if (other.status !== 'foreground' || other.validTo !== undefined) continue
          other.validTo = now
          other.supersededBy = entry.id
          other.status = 'background'
          other.reviewedAt = now
          other.history.push({ at: now, op: 'SUPERSEDED', by: entry.id })
          supersededId = other.id
        }
      }
      results.push({ op: 'ADD', accepted: true, id: entry.id, section, demoted, reason, superseded: supersededId })
      continue
    }

    if (op === 'update') {
      const target = byId.get(String((raw && raw.id) || ''))
      if (target === undefined) {
        results.push({ op: 'UPDATE', accepted: false, reason: 'unknown id' })
        continue
      }
      if (target.pinned) {
        results.push({ op: 'UPDATE', accepted: false, reason: 'pinned entries are never rewritten by ops' })
        continue
      }
      target.history.push({ at: now, op: 'UPDATE', text: target.text, scope: target.scope })
      const claim = text(raw.text)
      if (claim.length >= 2) target.text = claim.slice(0, MAX_TEXT)
      const scope = normalizeScope(raw.scope)
      if (scope !== undefined) target.scope = scope
      if (typeof raw.confidence === 'number') target.confidence = clampNumber(raw.confidence)
      if (raw.status === 'background' || raw.status === 'foreground') target.status = raw.status
      if (raw.section && SECTIONS.includes(raw.section)) target.section = raw.section
      if (raw.quote || Array.isArray(raw.episodes)) target.source = sourceOf(raw, episodes, now)
      target.reviewedAt = now
      target.lastConfirmedAt = now
      results.push({ op: 'UPDATE', accepted: true, id: target.id })
      continue
    }

    if (op === 'delete') {
      const target = byId.get(String((raw && raw.id) || ''))
      if (target === undefined) {
        results.push({ op: 'DELETE', accepted: false, reason: 'unknown id' })
        continue
      }
      if (target.pinned) {
        results.push({ op: 'DELETE', accepted: false, reason: 'pinned entries are never deleted by ops' })
        continue
      }
      target.validTo = now
      target.status = 'background'
      target.reviewedAt = now
      target.history.push({ at: now, op: 'DELETE', reason: text(raw.reason).slice(0, 200) })
      results.push({ op: 'DELETE', accepted: true, id: target.id })
      continue
    }

    results.push({ op: op || 'unknown', accepted: false, reason: 'unknown op' })
  }

  return { entries, results }
}

export const OPS_SYSTEM = [
  'You maintain a scoped long-term memory by applying operations. You never rewrite the store.',
  'Input JSON: "existing" entries (id, section, text, scope, status) and "episodes" (id, t, text).',
  'Output a single JSON object: {"ops":[...]} and nothing else.',
  'Allowed ops:',
  '  {"op":"add","section":"identity|preferences|projects|plans|lessons|notes","text":"...","scope":{"object":"what it applies to","situation":"when/where","excludes":"what it does not cover"},"episodes":["episode id"],"quote":"the user words that support it","confidence":0.6,"subject":"entity key"}',
  '  {"op":"update","id":"existing id","text":"...","scope":{...},"quote":"...","episodes":["..."]}',
  '  {"op":"delete","id":"existing id","reason":"..."}',
  '  {"op":"noop"}',
  'Rules:',
  '- Every add needs scope.object and scope.situation. No scope, no add.',
  '- A preference (section "preferences") is allowed only when the user states a general rule in their own words ("以后都…", "always", "by default"). A decision made for one video, screen, document, or artifact goes to "notes" with that artifact as scope.object.',
  '- quote must be copied from the episode, never paraphrased. episodes must list the supporting episode ids.',
  '- Never restate an unchanged entry. Use update for a changed value, delete for a retracted one, noop when the episodes add nothing.',
  '- Keep entries short, standalone, and specific. At most 12 ops.',
].join('\n')

export function opsPrompt(memoryData, episodes, now = Date.now()) {
  return JSON.stringify({
    today: new Date(now).toISOString().slice(0, 10),
    existing: (memoryData && Array.isArray(memoryData.entries) ? memoryData.entries : [])
      .filter((entry) => entry.section !== 'hypotheses')
      .slice(0, 80)
      .map((entry) => ({
        id: entry.id,
        section: entry.section,
        text: String(entry.text).slice(0, 200),
        scope: entry.scope || null,
        status: entry.status,
        pinned: Boolean(entry.pinned),
        validTo: entry.validTo || null,
      })),
    episodes: (Array.isArray(episodes) ? episodes : []).slice(-40).map((episode) => ({
      id: String(episode.id || ''),
      t: new Date(Number(episode.t) || now).toISOString(),
      text: String(episode.text).slice(0, 200),
    })),
  })
}

function cryptoId() {
  try {
    // eslint-disable-next-line no-undef
    return globalThis.crypto.randomUUID()
  } catch (error) {
    return 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }
}
