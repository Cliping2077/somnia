#!/usr/bin/env node
/**
 * Install the DSH adapter into a DSH plugin directory.
 *
 *   node scripts/install-dsh.mjs [dest]
 *
 * Default dest is the local DSH workspace plugin:
 *   ~/Documents/deepseek-harness/default-workspace/dsh-memory
 *
 * The plugin is self-contained: index.js + core.js + client.js + patch + locale.
 * Restart DSH (or reload the plugin) afterwards.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(here, '..', 'packages', 'dsh-memory')
const dest = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents', 'deepseek-harness', 'default-workspace', 'dsh-memory'))

if (!fs.existsSync(path.join(source, 'index.js'))) {
  console.error(`source not found: ${source}`)
  process.exit(1)
}

fs.mkdirSync(dest, { recursive: true })
const files = ['index.js', 'core.js', 'client.js', 'package.json', 'cordis.patch.yml', 'README.md', 'icon.svg']
for (const file of files) {
  const from = path.join(source, file)
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, file))
}
const localeFrom = path.join(source, 'locale')
const localeTo = path.join(dest, 'locale')
if (fs.existsSync(localeFrom)) fs.cpSync(localeFrom, localeTo, { recursive: true })

console.log(`Somnia DSH adapter installed to:\n  ${dest}\nRestart DSH (or reload the plugin) to load it.`)
