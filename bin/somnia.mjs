#!/usr/bin/env node
/**
 * Somnia review CLI. Reads the same store as the DSH adapter.
 *
 *   somnia state
 *   somnia list [--status foreground|background]
 *   somnia search "间距"
 *   somnia snapshots
 *   somnia restore <name>
 *   somnia report
 *   somnia config --minutes 10
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const argv = process.argv.slice(2)
const command = argv[0] || 'state'
const option = (name, fallback = undefined) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

const dir = option('--dir', path.join(os.homedir(), '.dsh', 'memory'))
const somnia = createSomnia({ dir })

try {
  switch (command) {
    case 'state':
      console.log(JSON.stringify(await somnia.action({ action: 'state' }), null, 2))
      break
    case 'list': {
      const entries = await somnia.action({ action: 'list', status: option('--status') })
      for (const entry of entries) {
        console.log(`${entry.status === 'foreground' ? '●' : '○'} [${entry.section}] ${entry.text}  (${entry.id.slice(0, 8)})`)
      }
      console.log(`\n${entries.length} entries`)
      break
    }
    case 'search': {
      const query = option('--query') || argv.slice(1).find((value) => !value.startsWith('--'))
      if (!query) throw new Error('usage: somnia search "query"')
      const entries = await somnia.action({ action: 'search', query })
      for (const entry of entries) console.log(`[${entry.section}] ${entry.text}`)
      break
    }
    case 'snapshots':
      console.log((await somnia.action({ action: 'snapshots' })).join('\n'))
      break
    case 'restore': {
      const name = option('--name') || argv[1]
      if (!name) throw new Error('usage: somnia restore <name>')
      console.log(JSON.stringify(await somnia.action({ action: 'restore', name }), null, 2))
      break
    }
    case 'report': {
      const file = path.join(dir, 'dream-report.md')
      console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'no dream report yet')
      break
    }
    case 'config': {
      const minutes = Number(option('--minutes', '10'))
      console.log(JSON.stringify(await somnia.action({ action: 'config', idleMinutes: minutes }), null, 2))
      break
    }
    default:
      console.error(`unknown command "${command}"`)
      process.exit(1)
  }
} catch (error) {
  console.error(String(error.message || error))
  process.exit(1)
}
