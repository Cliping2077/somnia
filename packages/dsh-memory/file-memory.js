/**
 * A `MEMORY.md` index and one Markdown file per Somnia memory record.
 *
 * The layout follows Claude Code's documented auto-memory format. Each record can be
 * inspected, edited, or deleted on disk. Edits are authoritative on the next load.
 * See docs/adoption/memory.md.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

const INDEX = 'MEMORY.md'
const FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}\.md$/

export function slugOf(entry) {
  const source = String(entry.text || entry.id || 'memory').toLowerCase()
  const ascii = source.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const base = ascii.length >= 3 ? ascii.slice(0, 44) : 'memory'
  const id = createHash('sha256').update(String(entry.id || source)).digest('hex').slice(0, 12)
  return base + '-' + id + '.md'
}

function scopeBlock(scope) {
  if (!scope) return '(scope unconfirmed)'
  const parts = ['object: ' + scope.object]
  if (scope.situation) parts.push('situation: ' + scope.situation)
  if (scope.excludes) parts.push('excludes: ' + scope.excludes)
  return parts.join(' · ')
}

export function renderEntryFile(entry) {
  const lines = [
    '---',
    'id: ' + entry.id,
    'section: ' + entry.section,
    'confidence: ' + String(entry.confidence ?? 0.6),
    'status: ' + String(entry.status || 'foreground'),
    'scope: ' + scopeBlock(entry.scope),
    ...(entry.subject ? ['subject: ' + entry.subject] : []),
    ...(entry.source && entry.source.quote ? ['quote: ' + String(entry.source.quote).replace(/\n/g, ' ')] : []),
    ...(entry.source && Array.isArray(entry.source.episodes) && entry.source.episodes.length > 0
      ? ['episodes: ' + entry.source.episodes.join(', ')]
      : []),
    '---',
    '',
    String(entry.text),
    '',
  ]
  return lines.join('\n')
}

export function renderIndex(entries) {
  const lines = ['# Memory index', '', 'One line per memory; the file named on each line holds the detail.', '']
  for (const entry of entries) {
    if (entry.section === 'hypotheses') continue
    const suffix = entry.status === 'background' ? ' (background)' : ''
    lines.push('- [' + entry.section + '] ' + String(entry.text).replace(/\s+/g, ' ') + suffix + ' → `' + slugOf(entry) + '`')
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Write the whole store as files, removing entry files that no longer exist.
 * @returns the number of entry files written.
 */
export function writeFileMemory(dir, entries) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const write = (name, body) => {
    const file = join(dir, name)
    const temp = file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temp, file)
    } finally {
      rmSync(temp, { force: true })
    }
  }
  const wanted = new Set()
  let written = 0
  for (const entry of entries) {
    if (entry.section === 'hypotheses') continue
    const name = slugOf(entry)
    wanted.add(name)
    write(name, renderEntryFile(entry))
    written += 1
  }
  for (const name of listEntryFiles(dir)) {
    if (!wanted.has(name)) rmSync(join(dir, name), { force: true })
  }
  write(INDEX, renderIndex(entries))
  return written
}

/** @returns the index body, or empty string when the store has not been written yet. */
export function readIndex(dir) {
  try { return readFileSync(join(dir, INDEX), 'utf8') } catch { return '' }
}

/** @returns the entry files present on disk, for auditing a write. */
export function listEntryFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
  } catch { return [] }
}

/** Parse one entry file written by {@link renderEntryFile}. @returns entry fields or undefined. */
export function parseEntryFile(name, body) {
  const lines = String(body).split(/\r?\n/)
  if (lines[0] !== '---') return undefined
  const end = lines.indexOf('---', 1)
  if (end < 0) return undefined
  const meta = new Map()
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':')
    if (colon > 0) meta.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const text = lines.slice(end + 1).join('\n').trim()
  if (text.length === 0) return undefined
  const scopeLine = meta.get('scope') || ''
  const scope = { object: '', situation: '' }
  for (const part of scopeLine.split(' · ')) {
    if (part.startsWith('object: ')) scope.object = part.slice(8).trim()
    else if (part.startsWith('situation: ')) scope.situation = part.slice(11).trim()
    else if (part.startsWith('excludes: ')) scope.excludes = part.slice(10).trim()
  }
  const episodes = (meta.get('episodes') || '').split(',').map((value) => value.trim()).filter((value) => value.length > 0)
  return {
    id: meta.get('id') || name.replace(/\.md$/, ''),
    section: meta.get('section') || 'notes',
    confidence: Number(meta.get('confidence')) || 0.6,
    status: meta.get('status') === 'background' ? 'background' : 'foreground',
    subject: meta.get('subject') || undefined,
    scope: scope.object.length > 0 ? scope : undefined,
    source: { episodes, quote: meta.get('quote') || '' },
    text,
  }
}

/** Read every entry file on disk; a user edit here is authoritative. */
export function readFileEntries(dir) {
  const out = []
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (!FILE_PATTERN.test(name)) continue
    let body = ''
    try { body = readFileSync(join(dir, name), 'utf8') } catch { continue }
    const parsed = parseEntryFile(name, body)
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}
