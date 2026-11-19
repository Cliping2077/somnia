#!/usr/bin/env node
/**
 * Use the HTTPS Git Data API when the git push transport is unavailable.
 * The target must be an existing non-default branch whose tip is an ancestor of local HEAD.
 * Set GITHUB_TOKEN and GITHUB_BRANCH, then run node scripts/push-api.mjs "message".
 */
import { fileURLToPath } from 'node:url'
import {
  checkPublishChanges,
  checkPublishText,
  gitOutput,
  PublishSafetyError,
  reportPublishError,
  resolveCommit,
  snapshotEntries,
} from './publish-safety.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const token = process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPO || 'Cliping2077/somnia'
const branch = process.env.GITHUB_BRANCH
const message = process.argv[2] || 'chore: publish validated Somnia snapshot'

function requireSha(sha) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new PublishSafetyError('GitHub returned an invalid Git object ID.')
  }
  return sha
}

async function api(endpoint, method = 'GET', payload) {
  const response = await fetch('https://api.github.com/repos/' + repo + endpoint, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'somnia-release',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: payload && JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new PublishSafetyError('GitHub rejected a ' + method + ' request (HTTP ' + response.status + ').')
  }
  return response.json()
}

async function branchTip(refPath) {
  const ref = await api(refPath)
  if (ref?.ref !== 'refs/heads/' + branch || ref?.object?.type !== 'commit') {
    throw new PublishSafetyError('GitHub returned a different reference from the requested branch.')
  }
  return requireSha(ref.object.sha)
}

async function publish() {
  if (!token) throw new PublishSafetyError('GITHUB_TOKEN is required.')
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repo) || repo.endsWith('/.') || repo.endsWith('/..')) {
    throw new PublishSafetyError('GITHUB_REPO must use the owner/name format.')
  }
  if (!branch || branch.startsWith('-')) {
    throw new PublishSafetyError('GITHUB_BRANCH must name an existing non-default branch.')
  }
  gitOutput(root, 'check-ref-format', 'refs/heads/' + branch)
  checkPublishText(branch)
  checkPublishText(message)
  const repository = await api('')
  if (typeof repository.default_branch !== 'string' || !repository.default_branch ||
      repository.default_branch.toLowerCase() === branch.toLowerCase()) {
    throw new PublishSafetyError('The API publisher requires an existing non-default branch.')
  }

  const branchPath = branch.split('/').map(encodeURIComponent).join('/')
  const refPath = '/git/ref/heads/' + branchPath
  const parent = await branchTip(refPath)
  const head = resolveCommit(root, 'HEAD')
  if (parent === head) {
    console.log('The target branch already matches local HEAD.')
    return
  }
  const ancestor = gitOutput(root, 'merge-base', parent, head).toString().trim()
  if (ancestor !== parent) {
    throw new PublishSafetyError('The remote branch tip is not an ancestor of the local commit.')
  }
  checkPublishChanges(parent, head, { cwd: root })

  const baseObjects = new Set(snapshotEntries(root, parent).map(({ sha }) => sha))
  const entries = snapshotEntries(root, head)
  for (const { path } of entries) checkPublishText(path)
  const expectedTree = gitOutput(root, 'rev-parse', '--verify', head + '^{tree}').toString().trim()
  const uploaded = new Set()
  for (const { type, sha } of entries) {
    if (type !== 'blob' || baseObjects.has(sha) || uploaded.has(sha)) continue
    const content = gitOutput(root, 'cat-file', 'blob', sha).toString('base64')
    const response = await api('/git/blobs', 'POST', { content, encoding: 'base64' })
    if (response.sha !== sha) throw new PublishSafetyError('GitHub returned a different blob from the reviewed object.')
    uploaded.add(sha)
  }

  const tree = await api('/git/trees', 'POST', { tree: entries })
  if (tree.sha !== expectedTree) throw new PublishSafetyError('GitHub returned a different tree from the reviewed snapshot.')
  const commit = await api('/git/commits', 'POST', { message, tree: tree.sha, parents: [parent] })
  const sha = requireSha(commit.sha)
  if (await branchTip(refPath) !== parent) {
    throw new PublishSafetyError('The target branch changed during publication. Ref update cancelled.')
  }
  await api('/git/refs/heads/' + branchPath, 'PATCH', { sha, force: false })

  console.log('Updated the target branch to validated commit ' + sha + '.')
}

try {
  await publish()
} catch (error) {
  reportPublishError(error)
}
