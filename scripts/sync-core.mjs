#!/usr/bin/env node
// The DSH plugin is installed as a plain local directory, so it cannot import
// from packages/core at runtime. It ships its own copy of the core files.
// packages/core/src is the source of truth; this script keeps the copies equal.
//
//   node scripts/sync-core.mjs          copy core files into the DSH plugin
//   node scripts/sync-core.mjs --check  fail if any copy differs (used by npm test)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repo = fileURLToPath(new URL('../', import.meta.url))
const pairs = [
  ['packages/core/src/somnia.js', 'packages/dsh-memory/core.js'],
  ['packages/core/src/consolidate.js', 'packages/dsh-memory/consolidate.js'],
  ['packages/core/src/file-memory.js', 'packages/dsh-memory/file-memory.js'],
]
const check = process.argv.includes('--check')
const drifted = []

for (const [from, to] of pairs) {
  const source = readFileSync(join(repo, from))
  const target = join(repo, to)
  if (existsSync(target) && readFileSync(target).equals(source)) continue
  if (check) drifted.push(`${to} differs from ${from}`)
  else {
    writeFileSync(target, source)
    console.log(`synced ${from} -> ${to}`)
  }
}

if (drifted.length) {
  console.error('Core copies are out of sync. Edit packages/core/src, then run: npm run sync-core')
  for (const line of drifted) console.error(`  ${line}`)
  process.exit(1)
}
if (check) console.log('core copies in sync')
