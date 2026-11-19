import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createSomnia } from '../src/somnia.js'

function makeStore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnia-stability-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return createSomnia({ dir, ...options })
}

const noop = JSON.stringify({ ops: [{ op: 'noop' }] })
const secret = 'github_pat_' + 'synthetic_test_'.repeat(4)

test('a disabled idle timer survives restart', async (t) => {
  const store = makeStore(t)
  await store.action({ action: 'config', idleMinutes: 0 })
  assert.equal(createSomnia({ dir: store.dir }).state().idleMinutes, 0)
})

test('a pause saved from another engine instance prevents model access', async (t) => {
  let calls = 0
  const store = makeStore(t, { generate: async () => { calls += 1; return noop } })
  store.state()
  const other = createSomnia({ dir: store.dir })
  await other.action({ action: 'pause' })
  assert.equal((await store.dream('wash')).skipped, true)
  assert.equal(calls, 0)
  assert.equal(other.state().paused, true)
})

test('a model response with only rejected operations can be retried', async (t) => {
  const store = makeStore(t, {
    generate: async () => JSON.stringify({ ops: [{ op: 'add', text: 'No evidence' }] }),
  })
  store.capture('session', 'Remember the test fixture for release')
  assert.equal((await store.dream()).engine, 'fallback')
  assert.equal(store.state().lastDreamAt, 0)
})

test('foreground activity aborts an in-flight dream and preserves its input for later', async (t) => {
  let signal
  let resolveGeneration
  const store = makeStore(t, {
    generate: (request) => {
      signal = request.signal
      return new Promise((resolve) => { resolveGeneration = resolve })
    },
  })
  store.capture('session', 'Remember to use the test fixture for publishing')
  const dream = store.dream('idle')
  store.interruptDream()
  store.setState('awake')
  assert.equal(signal.aborted, true)
  assert.equal((await dream).interrupted, true)
  assert.equal(store.state().state, 'awake')
  assert.equal(store.state().lastDreamAt, 0)
  resolveGeneration(noop)
  assert.equal(store.episodes().length, 1)
})

test('a save during model generation survives and the stale result is discarded', async (t) => {
  let resolveGeneration
  const store = makeStore(t, {
    generate: () => new Promise((resolve) => { resolveGeneration = resolve }),
  })
  store.capture('session', 'Remember to use the test fixture for publishing')
  const dream = store.dream()
  await store.action({ action: 'save', kind: 'note', text: 'Foreground write' })
  resolveGeneration(JSON.stringify({ ops: [{
    op: 'add', text: 'Stale result', scope: { object: 'test' },
  }] }))
  assert.equal((await dream).interrupted, true)
  assert.deepEqual(store.memory().entries.map((entry) => entry.text), ['Foreground write'])
  assert.equal(store.state().lastDreamAt, 0)
})

test('rejected model output never reaches the journal or raw diagnostic files', async (t) => {
  const store = makeStore(t, { generate: async () => secret })
  store.capture('session', 'Remember the test fixture for release')
  assert.equal((await store.dream()).engine, 'fallback')
  assert.equal(fs.existsSync(path.join(store.paths.dreams, 'ops-raw.txt')), false)
  assert.ok(!fs.readFileSync(store.paths.journal, 'utf8').includes(secret))
})

test('stored model operations and manually edited fields are sanitized', async (t) => {
  let replayed
  const store = makeStore(t, {
    generate: async ({ user }) => {
      replayed = JSON.parse(user).episodes[0]
      return JSON.stringify({ ops: [{
        op: 'add',
        text: 'Generated text ' + secret,
        scope: { object: 'test ' + secret },
        episodes: [replayed.id],
        quote: replayed.text,
      }] })
    },
  })
  store.capture('session', 'Remember the test fixture for release')
  assert.equal((await store.dream()).engine, 'model')
  assert.ok(replayed.id)
  const [entry] = store.memory().entries
  assert.ok(!JSON.stringify(entry).includes(secret))
  await store.action({
    action: 'edit',
    id: entry.id,
    text: 'Edited ' + secret,
    scope: { object: 'edited ' + secret },
  })
  assert.ok(!fs.readFileSync(store.paths.memory, 'utf8').includes(secret))
  assert.ok(!fs.readFileSync(store.paths.report, 'utf8').includes(secret))
})

test('restore accepts only listed snapshots and migrates legacy entries', async (t) => {
  const store = makeStore(t)
  const entry = await store.action({ action: 'save', text: 'Original test fact' })
  fs.writeFileSync(path.join(store.paths.snapshots, 'old.json'), JSON.stringify({ entries: [entry] }))
  await assert.rejects(store.action({ action: 'restore', name: '../old.json' }), /invalid snapshot name/)
  await store.action({ action: 'restore', name: 'old.json' })
  await store.action({ action: 'edit', id: entry.id, text: 'Revised test fact' })
  assert.equal(store.memory().entries[0].history.length, 1)
})

test('consolidation rejects fabricated source quotes and records exact episode references', async (t) => {
  const store = makeStore(t, {
    generate: async ({ user }) => {
      const [episode] = JSON.parse(user).episodes
      return JSON.stringify({ ops: [
        { op: 'add', text: 'Grounded', scope: { object: 'test' }, episodes: [episode.id], quote: episode.text },
        { op: 'add', text: 'Fabricated', scope: { object: 'test' }, episodes: [episode.id], quote: 'invented quote' },
      ] })
    },
  })
  store.capture('session', 'Remember the test fixture for release')
  await store.dream()
  assert.deepEqual(store.memory().entries.map((entry) => entry.text), ['Grounded'])
  assert.equal(store.memory().entries[0].source.episodes[0], store.episodes()[0].id)
})

test('a full store retains a newly saved entry', async (t) => {
  const store = makeStore(t)
  for (let index = 0; index <= 40; index += 1) {
    await store.action({ action: 'save', text: `Local fact ${index}` })
  }
  assert.equal(store.memory().entries.length, 40)
  assert.ok(store.memory().entries.some((entry) => entry.text === 'Local fact 40'))
})

test('entries with the same text in distinct sections have separate mirror files', async (t) => {
  const store = makeStore(t)
  await store.action({ action: 'save', text: 'Shared label', kind: 'note' })
  await store.action({ action: 'save', text: 'Shared label', kind: 'fact' })
  const files = fs.readdirSync(path.join(store.dir, 'memory'))
  assert.equal(files.filter((name) => name !== 'MEMORY.md').length, 2)
})
