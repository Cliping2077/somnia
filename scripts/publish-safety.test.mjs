import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const mockFetch = `
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const reply = (data, status = 200) => Response.json(data, { status })
let refReads = 0
globalThis.fetch = async (url, { method = 'GET', body } = {}) => {
  const endpoint = new URL(url).pathname.replace('/repos/test/somnia', '')
  const request = body && JSON.parse(body)
  let blobSha
  if (endpoint === '/git/blobs') {
    const bytes = Buffer.from(request.content, 'base64')
    blobSha = createHash('sha1')
      .update('blob ' + bytes.length + '\\0')
      .update(bytes)
      .digest('hex')
  }
  appendFileSync(process.env.TEST_API_LOG, JSON.stringify({
    method, endpoint, blobSha, force: request?.force,
    parents: request?.parents, entries: request?.tree,
  }) + '\\n')

  if (endpoint === '' && method === 'GET') return reply({ default_branch: 'main' })
  if (endpoint.startsWith('/git/ref/heads/') && method === 'GET') {
    if (process.env.TEST_REF_STATUS) {
      return reply({ message: process.env.TEST_HTTP_ERROR }, Number(process.env.TEST_REF_STATUS))
    }
    const ref = process.env.TEST_REF_NAME || endpoint.slice('/git/'.length).replace('ref/', 'refs/')
    const firstRead = refReads++ === 0
    const sha = firstRead ? process.env.TEST_REMOTE_HEAD : process.env.TEST_UPDATED_REMOTE_HEAD || process.env.TEST_REMOTE_HEAD
    return reply({ ref, object: { sha, type: 'commit' } })
  }
  if (blobSha) return reply({ sha: blobSha })
  if (endpoint === '/git/trees') return reply({ sha: process.env.TEST_TREE })
  if (endpoint === '/git/commits') return reply({ sha: 'b'.repeat(40) })
  if (endpoint.startsWith('/git/refs')) return reply({})
  throw new Error('Unexpected mock request')
}
`

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'somnia-publish-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const hooksDirectory = join(cwd, 'empty-hooks')
  mkdirSync(hooksDirectory)
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (/^GIT_/.test(name)) delete env[name]
  }
  env.GIT_CONFIG_COUNT = '1'
  env.GIT_CONFIG_KEY_0 = 'safe.directory'
  env.GIT_CONFIG_VALUE_0 = cwd.replaceAll('\\', '/')
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=fix/privacy', '--object-format=sha1')
  git('config', 'core.hooksPath', hooksDirectory.replaceAll('\\', '/'))
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.name', 'Synthetic Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  const put = (path, data) => writeFileSync(join(cwd, path), data)
  const commit = (message = 'Synthetic fixture change') => {
    git('add', '--all')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  mkdirSync(join(cwd, 'assets'))
  put('app.js', 'export const version = 1\n')
  put('assets/sleep-indicator.png', Buffer.from([137, 80, 78, 71]))
  const base = commit('Synthetic fixture baseline')
  const upload = (overrides = {}) => {
    const scripts = join(cwd, 'scripts')
    if (!existsSync(scripts)) mkdirSync(scripts)
    for (const name of ['push-api.mjs', 'publish-safety.mjs']) {
      const source = join(scriptDirectory, name)
      if (existsSync(source)) copyFileSync(source, join(scripts, name))
    }
    const log = join(cwd, 'calls.jsonl')
    put('mock-fetch.mjs', mockFetch)
    const result = spawnSync(process.execPath, ['--import', './mock-fetch.mjs', './scripts/push-api.mjs'], {
      cwd,
      env: {
        ...env,
        NODE_OPTIONS: '',
        GITHUB_TOKEN: 'fixture-authentication',
        GITHUB_REPO: 'test/somnia',
        GITHUB_BRANCH: 'fix/privacy',
        TEST_API_LOG: log,
        TEST_REMOTE_HEAD: base,
        TEST_TREE: git('rev-parse', 'HEAD^{tree}'),
        ...overrides,
      },
      encoding: 'utf8',
    })
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      : []
    return { ...result, calls }
  }
  const check = (revision = base) => spawnSync(process.execPath, [join(scriptDirectory, 'publish-safety.mjs'), revision], {
    cwd, env, encoding: 'utf8',
  })
  return { base, git, put, commit, upload, check }
}

const fakePat = 'gh' + 'p_' + 'x'.repeat(36)
const writes = (calls) => calls.filter(({ method }) => method !== 'GET')
const shaForBlob = (content) => createHash('sha1')
  .update('blob ' + Buffer.byteLength(content) + '\0')
  .update(content)
  .digest('hex')

test('staged check rejects the index bytes even after a worktree cleanup', (t) => {
  const { put, git, check } = fixture(t)
  put('app.js', 'export const fixture = ' + JSON.stringify(fakePat) + '\n')
  git('add', 'app.js')
  put('app.js', 'export const version = 1\n')
  const { status, stdout, stderr } = check('--staged')
  assert.equal(status, 1)
  assert.match(stderr, /credentials or private data/)
  assert.ok(!(stdout + stderr).includes(fakePat))
})

test('blocks a token in ordinary committed source before uploading objects', (t) => {
  const { put, commit, upload } = fixture(t)
  put('app.js', 'export const token = ' + JSON.stringify(fakePat) + '\n')
  commit()
  const { status, stdout, stderr, calls } = upload()
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
  assert.equal((stdout + stderr).includes(fakePat), false)
})

test('blocks changed content at a previously accepted image path', (t) => {
  const { put, commit, upload } = fixture(t)
  put('assets/sleep-indicator.png', Buffer.from([137, 80, 78, 71, 255]))
  commit()
  const { status, calls } = upload()
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
})

test('publishes committed bytes and modes without uploading inherited assets', (t) => {
  const { base, git, put, upload } = fixture(t)
  const committed = 'export const version = 2\n'
  put('app.js', committed)
  git('add', '--update')
  git('update-index', '--chmod=+x', 'app.js')
  git('commit', '--quiet', '-m', 'Synthetic executable change')
  put('app.js', 'export const token = ' + JSON.stringify(fakePat) + '\n')
  const { status, calls } = upload()
  assert.equal(status, 0)
  assert.deepEqual(calls.filter(({ blobSha }) => blobSha).map(({ blobSha }) => blobSha), [shaForBlob(committed)])
  assert.equal(calls.find(({ endpoint }) => endpoint === '/git/trees')
    ?.entries.find(({ path }) => path === 'app.js').mode, '100755')
  assert.deepEqual(calls.find(({ endpoint }) => endpoint === '/git/commits')?.parents, [base])
  assert.deepEqual(calls.find(({ method }) => method === 'PATCH'), {
    method: 'PATCH', endpoint: '/git/refs/heads/fix/privacy', force: false,
  })
})

test('refuses a failed remote ref lookup without writing or displaying the response body', (t) => {
  const { put, commit, upload } = fixture(t)
  put('app.js', 'export const version = 3\n')
  commit()
  const { status, stdout, stderr, calls } = upload({ TEST_REF_STATUS: '403', TEST_HTTP_ERROR: fakePat })
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
  assert.equal((stdout + stderr).includes(fakePat), false)
})

test('checks content added in an intermediate commit and subsequently removed', (t) => {
  const { put, commit, upload } = fixture(t)
  put('app.js', 'export const token = ' + JSON.stringify(fakePat) + '\n')
  commit()
  put('app.js', 'export const version = 4\n')
  commit()
  const { status, calls } = upload()
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
})

test('refuses to target the default branch', (t) => {
  const { put, commit, upload } = fixture(t)
  put('app.js', 'export const version = 5\n')
  commit()
  const { status, calls } = upload({ GITHUB_BRANCH: 'main' })
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
})

test('cancels a ref update when the remote branch changes during upload', (t) => {
  const { git, put, commit, upload } = fixture(t)
  put('app.js', 'export const version = 6\n')
  commit()
  const { status, calls } = upload({ TEST_UPDATED_REMOTE_HEAD: git('rev-parse', 'HEAD') })
  assert.equal(status, 1)
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false)
})

test('rejects a remote response for a different branch before writes', (t) => {
  const { put, commit, upload } = fixture(t)
  put('app.js', 'export const version = 7\n')
  commit()
  const { status, calls } = upload({ TEST_REF_NAME: 'refs/heads/other' })
  assert.equal(status, 1)
  assert.equal(writes(calls).length, 0)
})

test('CLI rejects a banned filename without including its name in the diagnostic', (t) => {
  const { put, commit, check } = fixture(t)
  const filename = 'chip-' + fakePat + '.png'
  put(filename, 'Synthetic attachment')
  commit()
  const { status, stderr } = check()
  assert.equal(status, 1)
  assert.match(stderr, /sensitive path/)
  assert.equal(stderr.includes(fakePat), false)
})

test('CLI permits deletion of an inherited image', (t) => {
  const { git, commit, check } = fixture(t)
  git('rm', '-q', 'assets/sleep-indicator.png')
  commit()
  const { status, stdout } = check()
  assert.equal(status, 0)
  assert.match(stdout, /safety checks passed/)
})
