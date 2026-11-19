import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const node = process.execPath

const targets = [
  ['packages/core/test/units.mjs'],
  ['packages/dsh-memory/test-adapter.mjs'],
  ['eval/memory-eval.mjs'],
  ['eval/abilities-eval.mjs'],
  ['eval/locomo-eval.mjs', '50'],
  ['eval/longmemeval-eval.mjs', '500'],
]

const results = {}
let failed = false
for (const [relative, ...args] of targets) {
  const file = path.join(root, relative)
  const started = Date.now()
  const child = spawnSync(node, [file, ...args], { cwd: root, encoding: 'utf8', timeout: 600000 })
  const stdout = (child.stdout || '').trim()
  let parsed = null
  try { parsed = JSON.parse(stdout) } catch {}
  results[relative] = {
    exit: child.status,
    ms: Date.now() - started,
    stdout: parsed !== null ? parsed : stdout.slice(-500),
  }
  if (child.status !== 0) failed = true
}

const out = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  results,
  failed,
}
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
process.exit(failed ? 1 : 0)
