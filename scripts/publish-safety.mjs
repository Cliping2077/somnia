import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const maxTextBytes = 2 * 1024 * 1024
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const privateDirectory = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.ssh|\.aws|\.gnupg|\.codex|\.claude|\.agents|private|secrets?|screenshots?|recordings?|user data|browser profiles?|profile \d+)(?:\/|$)/i
const privateFilename = /(?:^|[_. -])(?:tokens?|passwords?|credentials?|screenshots?)(?:[_. -]|$)|^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|bookmarks|cookies|history|login data|local state|secure preferences|top sites|web data)$/i
const unsafeExtension = /\.(?:png|apng|jpe?g|webp|gif|bmp|tiff?|heic|avif|ico|mp4|mov|webm|mkv|avi|mp3|m4a|wav|flac|ogg|pdf|zip|7z|tar|gz|bz2|xz|rar|docx?|xlsx?|pptx?|db|sqlite3?|p12|pfx|key|pem|har)$/i
const confidentialText = [
  /\b(?:gh[pousr]_[\da-z]{20,}|github_pat_[\da-z_]{20,})\b/i,
  /\bsk-(?:proj-|svcacct-)?[\da-z_-]{24,}\b/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[\da-z_-]{35}\b/i,
  /\b(?:xox[baprs]-|npm_)[\da-z-]{16,}\b/i,
  /\bBearer[ \t]+[a-z0-9._~+/-]{20,}/i,
  /(?:[a-z]:[\\/]users[\\/]|\/(?:Users|home)\/)[a-z0-9_.@-]+[\\/]/i,
  /-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----/,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /data:(?:image|audio|video|application)\/[^,\s]{1,100};base64,/i,
  /(?:^|\s)version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\s|$)/,
]

export class PublishSafetyError extends Error {}

export function gitOutput(cwd, ...args) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  try {
    return execFileSync('git', args, { cwd, env, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    throw new PublishSafetyError('Git could not read the complete publication snapshot.')
  }
}

function asText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new PublishSafetyError('Publication blocked because a changed Git object is not UTF-8 text.')
  }
}

export function checkPublishText(text) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ||
      confidentialText.some((pattern) => pattern.test(text))) {
    throw new PublishSafetyError('Publication blocked because changed content may contain credentials or private data.')
  }
}

export function resolveCommit(cwd, ref) {
  const oid = gitOutput(cwd, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim()
  if (!oidPattern.test(oid)) throw new PublishSafetyError('Git returned an invalid commit ID.')
  return oid
}

function checkPath(path) {
  const basename = path.split('/').at(-1)
  if (/[\x00-\x1f\x7f\\:]/.test(path) || privateDirectory.test(path) ||
      privateFilename.test(basename) || unsafeExtension.test(basename) ||
      /^(?:eval\/(?:locomo10|longmemeval_s|results)\.json|scripts\/(?:cdp-token|push-incremental)\.|.*(?:episodes(?:-archive)?\.jsonl|dream-journal\.json|dream-report\.md|ops-raw\.txt)$)/i.test(path)) {
    throw new PublishSafetyError('Publication blocked because a sensitive path or unreviewed binary file changed.')
  }
  checkPublishText(path)
}

function changedEntries(cwd, commit, parent) {
  const revisions = parent ? [parent, commit] : ['--root', commit]
  return parseChanges(gitOutput(cwd, 'diff-tree', '-r', '-z', '--no-commit-id',
    '--no-abbrev', '--no-renames', '--no-ext-diff', ...revisions))
}

function parseChanges(bytes) {
  const entries = asText(bytes).split('\0')
  entries.pop()
  const changes = []
  for (let i = 0; i < entries.length; i += 2) {
    const [, mode, , sha, status] = entries[i].slice(1).split(' ')
    if (!oidPattern.test(sha) || entries[i + 1] === undefined || !/^[ADMT]$/.test(status)) {
      throw new PublishSafetyError('Git returned an unrecognized tree change.')
    }
    if (status !== 'D') changes.push({ mode, sha, path: entries[i + 1] })
  }
  return changes
}

function checkEntries(cwd, entries, checkedBlobs = new Set()) {
  for (const entry of entries) {
    checkPath(entry.path)
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      throw new PublishSafetyError('Publication blocked because a symbolic link or submodule changed.')
    }
    if (checkedBlobs.has(entry.sha)) continue
    const size = Number(gitOutput(cwd, 'cat-file', '-s', entry.sha).toString().trim())
    if (!Number.isSafeInteger(size) || size < 0 || size > maxTextBytes) {
      throw new PublishSafetyError('Publication blocked because a changed file exceeds the safety scan size limit.')
    }
    checkPublishText(asText(gitOutput(cwd, 'cat-file', 'blob', entry.sha)))
    checkedBlobs.add(entry.sha)
  }
}

export function checkStagedChanges(cwd = process.cwd()) {
  const changes = parseChanges(gitOutput(cwd, 'diff', '--cached', '--raw', '-z',
    '--no-abbrev', '--no-renames', '--no-ext-diff'))
  checkEntries(cwd, changes)
}

export function checkPublishChanges(base, head = 'HEAD', { cwd = process.cwd() } = {}) {
  if (!base || gitOutput(cwd, 'rev-parse', '--is-shallow-repository').toString().trim() !== 'false') {
    throw new PublishSafetyError('Publication requires a trusted baseline and complete Git history.')
  }
  const from = resolveCommit(cwd, base)
  const to = resolveCommit(cwd, head)
  const commits = gitOutput(cwd, 'rev-list', '--parents', `${from}..${to}`).toString().trim()
  if (!commits) return
  const checkedBlobs = new Set()
  for (const line of commits.split('\n')) {
    const [commit, parent] = line.split(' ')
    checkPublishText(asText(gitOutput(cwd, 'cat-file', 'commit', commit)))
    checkEntries(cwd, changedEntries(cwd, commit, parent), checkedBlobs)
  }
}

export function snapshotEntries(cwd, commit) {
  const records = asText(gitOutput(cwd, 'ls-tree', '-r', '-z', '--full-tree', commit)).split('\0')
  records.pop()
  return records.map((record) => {
    const separator = record.indexOf('\t')
    const [mode, type, sha] = record.slice(0, separator).split(' ')
    if (separator < 0 || !oidPattern.test(sha) || !['blob', 'commit'].includes(type)) {
      throw new PublishSafetyError('Git returned an unrecognized snapshot entry.')
    }
    return { path: record.slice(separator + 1), mode, type, sha }
  })
}

export function reportPublishError(error) {
  console.error(error instanceof PublishSafetyError ? error.message : 'Publication validation failed.')
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--staged') checkStagedChanges()
    else checkPublishChanges(process.argv[2], process.argv[3])
    console.log('Publication safety checks passed.')
  } catch (error) {
    reportPublishError(error)
  }
}
