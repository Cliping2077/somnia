import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const installer = fileURLToPath(new URL('../../scripts/install-dsh.mjs', import.meta.url))
const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const runtimeFiles = ['index.js', 'core.js', 'consolidate.js', 'file-memory.js', 'client.js', 'cordis.patch.yml',
  'icon.svg', 'locale/en.json', 'locale/zh.json', 'package.json']

test('a fresh copied installation loads without dependencies from the checkout', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'somnia-install-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  execFileSync(process.execPath, [installer, directory], { stdio: 'pipe' })
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { apply, inject } from './index.js'
    assert.equal(typeof apply, 'function')
    assert.deepEqual(inject, ['tools', 'systemPrompt'])
  `], { cwd: directory, stdio: 'pipe' })
})

test('npm pack contains the full adapter runtime', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'somnia-pack-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const bundledNpm = process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null
  const npmCli = process.env.npm_execpath || bundledNpm
  const args = ['pack', '--dry-run', '--json', '--offline', '--ignore-scripts', '--cache', directory]
  const packageInfo = execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd: packageRoot, encoding: 'utf8',
  })
  const paths = JSON.parse(packageInfo)[0].files.map(({ path }) => path)
  for (const file of runtimeFiles) assert.ok(paths.includes(file), `Package is missing ${file}`)
  assert.ok(!paths.includes('test-install.mjs'))
})
