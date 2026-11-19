#!/usr/bin/env node
/**
 * Push the repository through the GitHub Git Data API.
 *
 * Some networks reset the git smart-HTTP endpoint while api.github.com works.\n * This tool refuses suspicious tracked files and never force-updates main.
 * This script builds blobs/tree/commit over HTTPS and updates refs/heads/main.
 *
 *   GITHUB_TOKEN=... GITHUB_REPO=owner/name node scripts/push-api.mjs "message"
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPO || 'Cliping2077/somnia'
const message = process.argv[2] || 'release: Somnia v1.0.0'
if (!token) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file.length > 0 && fs.existsSync(path.join(root, file)))

// Fail closed: Git tracks files even after they are added to .gitignore.
// Do not let one forgotten screenshot, local record or credential escape.
const approvedImages = [
  /^assets\/sleep-indicator\.png$/,
  /^demo\/sleep-memory-demo\.gif$/,
  /^demo\/sleep-memory-(?:science-)?poster\.png$/,
  /^demo\/rhythm-[0-9.]+\.png$/,
]
const unsafePaths = files.filter((file) => {
  const normalized = file.replaceAll('\\', '/')
  if (/(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|(?:private|secrets?|screenshots?|recordings?)(?:\/|$))/i.test(normalized)) return true
  if (/(?:token|secret|password|credential|private|screenshot)/i.test(path.basename(normalized))) return true
  if (/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(normalized) && !approvedImages.some((pattern) => pattern.test(normalized))) return true
  return false
})
if (unsafePaths.length) {
  console.error('Refusing to publish unreviewed or sensitive-looking files:\\n' + unsafePaths.join('\\n'))
  process.exit(1)
}

async function api(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'somnia-release',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${options.method || 'GET'} ${endpoint} -> ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.json()
}

async function createBlob(file) {
  const content = fs.readFileSync(path.join(root, file)).toString('base64')
  const result = await api(`/repos/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'base64' }),
  })
  return { path: file, mode: '100644', type: 'blob', sha: result.sha }
}

const entries = new Array(files.length)
let cursor = 0
async function worker() {
  while (cursor < files.length) {
    const index = cursor
    cursor += 1
    entries[index] = await createBlob(files[index])
    if ((index + 1) % 10 === 0) console.log(`blobs ${index + 1}/${files.length}`)
  }
}
await Promise.all(Array.from({ length: 5 }, () => worker()))

const tree = await api(`/repos/${repo}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree: entries }),
})

let parent = null
try {
  const ref = await api(`/repos/${repo}/git/ref/heads/main`)
  parent = ref.object.sha
} catch (error) {
  parent = null
}

const commit = await api(`/repos/${repo}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree: tree.sha, parents: parent ? [parent] : [] }),
})

if (parent) {
  await api(`/repos/${repo}/git/refs/heads/main`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
} else {
  await api(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/main', sha: commit.sha }),
  })
}

console.log(`pushed ${files.length} files -> https://github.com/${repo}/commit/${commit.sha}`)
