// Bidirectional file memory: an edit to the user-facing markdown must win on the next load.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const dir = mkdtempSync(join(tmpdir(), 'somnia-file-sync-'))
const first = createSomnia({ dir })
await first.action({ action: 'save', text: '交付前必须自验证', kind: 'preference', confidence: 0.9 })
assert.ok(first.memory().entries.length === 1)

const mirror = join(dir, 'memory')
const files = readdirSync(mirror).filter((name) => name.endsWith('.md') && name !== 'MEMORY.md')
assert.equal(files.length, 1, 'one entry should produce one file')
const file = join(mirror, files[0])
const before = readFileSync(file, 'utf8')
assert.ok(before.includes('交付前必须自验证'))
assert.ok(before.includes('scope:'), 'entry file must carry a scope line')

// Simulate the user editing the markdown.
writeFileSync(file, before.replace('交付前必须自验证', '交付前必须自验证，并由 review 记录 P0/P1'))

const second = createSomnia({ dir })
const entries = second.memory().entries
assert.equal(entries.length, 1)
assert.ok(entries[0].text.includes('并由 review 记录 P0/P1'), 'the file edit must be authoritative')

console.log('file sync ok: user edit in MEMORY file overrides the JSON store on next load')
