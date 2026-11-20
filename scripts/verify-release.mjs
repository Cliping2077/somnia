import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url))
const windows = process.platform === 'win32'
const packages = [
  {
    directory: 'core',
    name: '@somnia/core',
    files: ['src/consolidate.js', 'src/file-memory.js', 'src/somnia.js'],
  },
  {
    directory: 'dsh-memory',
    name: 'dsh-plugin-sleep-memory',
    files: [
      'client.js',
      'consolidate.js',
      'cordis.patch.yml',
      'core.js',
      'file-memory.js',
      'icon.svg',
      'index.js',
      'locale/en.json',
      'locale/zh.json',
    ],
  },
]

function run(command, args, options, failure) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(failure)
  return result.stdout
}

function verifyPackage(spec, workspace, license, version) {
  const destination = join(workspace, spec.directory)
  mkdirSync(destination)
  const packArgs = ['pack', '--json', '--offline', '--ignore-scripts']
  // npm.cmd is a batch file on Windows. The shell command contains only constants.
  const packCommand = windows ? ['npm.cmd', ...packArgs].join(' ') : 'npm'
  const output = run(packCommand, windows ? [] : packArgs, {
    cwd: join(repo, 'packages', spec.directory),
    env: {
      ...process.env,
      npm_config_cache: join(workspace, 'cache'),
      npm_config_userconfig: join(workspace, 'npmrc'),
      npm_config_pack_destination: destination,
    },
    shell: windows,
  }, 'npm pack failed')
  const metadata = JSON.parse(output)
  const archives = readdirSync(destination)
  if (metadata.length !== 1 || metadata[0].name !== spec.name ||
      archives.length !== 1 || !archives[0].endsWith('.tgz')) {
    throw new Error('unexpected package identity or archive count')
  }
  if (metadata[0].version !== version) {
    throw new Error('package version does not match the Somnia release version')
  }

  const archive = join(destination, archives[0])
  const expected = new Set(['LICENSE', 'README.md', 'package.json', ...spec.files]
    .map(file => `package/${file}`))
  const tar = windows ? 'tar.exe' : 'tar'
  const files = run(tar, ['-tzf', archive], {}, 'could not list the package archive')
    .trimEnd().split(/\r?\n/)
  const details = run(tar, ['-tvzf', archive], {}, 'could not verify archive entry types')
    .trimEnd().split(/\r?\n/)
  if (files.length !== expected.size || new Set(files).size !== expected.size ||
      files.some(file => !expected.has(file)) || details.length !== files.length ||
      details.some(line => !line.startsWith('-'))) {
    throw new Error('archive files do not match the release allowlist')
  }

  run(tar, ['-xzf', archive, '-C', destination], {}, 'could not extract the package archive')
  const unpacked = join(destination, 'package')
  if (!readFileSync(join(unpacked, 'LICENSE')).equals(license)) {
    throw new Error('packaged license does not match the repository license')
  }
  run(process.execPath, [
    '--input-type=module', '--eval', 'await import(process.argv[1])', spec.name,
  ], { cwd: unpacked }, 'packaged entry point could not be imported')
}

const workspace = mkdtempSync(join(tmpdir(), 'somnia-release-'))
try {
  const license = readFileSync(join(repo, 'LICENSE'))
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  for (const spec of packages) {
    try {
      verifyPackage(spec, workspace, license, version)
      console.log(`${spec.name}@${version}: verified archive, license and entry point`)
    } catch (error) {
      // JSON parser and subprocess diagnostics can contain package contents or filenames.
      const message = error instanceof SyntaxError ? 'invalid pack metadata'
        : error.code ? 'could not read a required release file' : error.message
      console.error(`${spec.name}: ${message}`)
      process.exitCode = 1
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
