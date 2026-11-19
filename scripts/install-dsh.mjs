#!/usr/bin/env node
/**
 * Prepare a standalone directory for the DSH Plugin Manager.
 *
 *   node scripts/install-dsh.mjs [dest]
 *
 * Default destination in the local workspace:
 *   ~/Documents/deepseek-harness/default-workspace/dsh-memory
 *
 * The plugin includes the same runtime files as the npm package.
 * Install the prepared directory as a local bundle in the DSH Plugin Manager.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(here, '..', 'packages', 'dsh-memory')
const dest = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents', 'deepseek-harness', 'default-workspace', 'dsh-memory'))

const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
const files = ['package.json', ...manifest.files]
for (const file of files) {
  if (!fs.statSync(path.join(source, file), { throwIfNoEntry: false })?.isFile()) {
    console.error(`Cannot install Somnia. The adapter package is missing ${file}.`)
    process.exit(1)
  }
}

for (const file of files) {
  const target = path.join(dest, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(source, file), target)
}

console.log(`Somnia DSH bundle prepared at:\n  ${dest}\nInstall this directory as a local bundle in the DeepSeek Harness Plugin Manager.`)
