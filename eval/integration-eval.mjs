// Integration test for the ported memory write pipeline:
// real somnia instance in a temp dir, stubbed model that returns ops, then assertions on the
// machine store, the file mirror (MEMORY.md + one file per entry), provenance and injection.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const dir = mkdtempSync(join(tmpdir(), 'somnia-integration-'))
let calls = 0
const replies = [
  {
    ops: [
      {
        op: 'add',
        section: 'preferences',
        text: '用暗金代替红色',
        scope: { object: '即梦演示视频', situation: '该视频的配色' },
        episodes: ['e1'],
        quote: '这个演示视频里把红色改成暗金，其它地方不用改',
        confidence: 0.8,
      },
      {
        op: 'add',
        section: 'projects',
        text: '窗口几何需要持久化',
        scope: { object: 'DSH 桌面端', situation: '窗口启动与恢复' },
        episodes: ['e2'],
        quote: '桌面窗口每次都要回到上次的位置和大小',
        confidence: 0.9,
      },
    ],
  },
  { ops: [{ op: 'noop' }] },
]
const somnia = createSomnia({
  dir,
  generate: async () => {
    const reply = replies[Math.min(calls, replies.length - 1)]
    calls += 1
    return { text: JSON.stringify(reply), usage: { inputTokens: 10, outputTokens: 10 } }
  },
})

// Two episodes with ids the stub can cite.
somnia.capture('s', '这个演示视频里把红色改成暗金，其它地方不用改', { id: 'e1' })
somnia.capture('s', '桌面窗口每次都要回到上次的位置和大小', { id: 'e2' })

const first = await somnia.dream('wash')
assert.equal(first.engine, 'model', 'dream must use the ops model')

const entries = somnia.memory().entries
const aesthetic = entries.find((entry) => entry.text === '用暗金代替红色')
assert.ok(aesthetic, 'aesthetic entry missing')
assert.equal(aesthetic.section, 'notes', 'one-off decision must be demoted out of preferences')
assert.equal(aesthetic.scope.object, '即梦演示视频', 'scope must keep the artifact')
assert.ok(aesthetic.source && aesthetic.source.quote, 'provenance quote missing')

const project = entries.find((entry) => entry.text === '窗口几何需要持久化')
assert.ok(project)
assert.ok(project.source.episodes.length > 0, 'episode ids missing')

// File mirror: MEMORY.md index plus one file per entry.
const mirror = join(dir, 'memory')
assert.ok(existsSync(join(mirror, 'MEMORY.md')), 'MEMORY.md index missing')
const index = readFileSync(join(mirror, 'MEMORY.md'), 'utf8')
assert.ok(index.includes('窗口几何需要持久化'), 'index does not list the entry')
assert.ok(index.includes('用暗金代替红色'), 'index does not list the demoted entry')
const files = readdirSync(mirror).filter((name) => name.endsWith('.md') && name !== 'MEMORY.md')
assert.ok(files.length >= 2, 'expected one file per entry, got ' + files.length)
const one = files.map((name) => readFileSync(join(mirror, name), 'utf8')).find((body) => body.includes('即梦演示视频'))
assert.ok(one && one.includes('quote:'), 'entry file must carry scope and quote')

// Injection carries the scope so the model cannot apply the entry blindly.
const injected = somnia.injectText()
assert.ok(injected.includes('适用于'), 'injection must show the applicability of an entry')

// A noop dream must not rewrite ids.
const idsBefore = entries.map((entry) => entry.id).sort()
const second = await somnia.dream('wash')
assert.equal(second.engine, 'model')
const idsAfter = somnia.memory().entries.map((entry) => entry.id).sort()
assert.deepEqual(idsAfter, idsBefore, 'a noop consolidation must not change ids')

// Controls: pause stops injection, source shows provenance, edit changes the claim, export writes.
await somnia.action({ action: 'pause' })
assert.equal(somnia.injectText(), '', 'paused memory must inject nothing')
await somnia.action({ action: 'resume' })
assert.ok(somnia.injectText().length > 0, 'resume must restore injection')

const provenance = await somnia.action({ action: 'source', id: aesthetic.id })
assert.equal(provenance.found, true)
assert.ok(provenance.quote.includes('暗金'), 'source must return the supporting quote')

await somnia.action({ action: 'edit', id: aesthetic.id, text: '用暗金代替红色（仅该视频）' })
assert.ok(somnia.memory().entries.some((entry) => entry.text === '用暗金代替红色（仅该视频）'))
const exported = await somnia.action({ action: 'export' })
assert.ok(exported.entries >= 2)
assert.ok(existsSync(exported.path), 'export file missing')

// Relevance: the injected line shows the applicability of a foreground scoped entry.
assert.ok(somnia.injectText('DSH 桌面端').includes('适用于 DSH 桌面端'), 'injection must show where the entry applies')

console.log('integration ok: ops dream, demotion+scope, provenance, file mirror (index + ' + files.length + ' files), injection scope, noop identity, pause/resume, source, edit, export, relevance')
