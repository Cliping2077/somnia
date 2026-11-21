import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSomnia } from '../packages/core/src/somnia.js'

const conversation = [
  {
    id: 'review-default',
    message: 'Remember: always use dark mode when reviewing project drafts.',
    text: 'Use dark mode',
    scope: { object: 'project drafts', situation: 'when reviewing' },
  },
  {
    id: 'release-demo',
    message: 'For this release demo only, we decided to use light mode.',
    text: 'Use light mode',
    scope: { object: 'release demo', situation: 'this demo only' },
  },
]

// A local stand-in for the model. Both statements are proposed as preferences
// so Somnia's own consolidation rules decide which one is a lasting preference.
function generate({ user }) {
  const { episodes } = JSON.parse(user)
  const ops = conversation.map(({ id, text, scope }) => {
    const evidence = episodes.find((episode) => episode.id === id)
    if (!evidence) throw new Error('The example message was not selected for consolidation.')
    return { op: 'add', section: 'preferences', text, scope, episodes: [evidence.id], quote: evidence.text }
  })
  return JSON.stringify({ ops })
}

const dir = mkdtempSync(join(tmpdir(), 'somnia-quickstart-'))
try {
  const somnia = createSomnia({ dir, generate })
  for (const { id, message } of conversation) somnia.capture('quickstart', message, { id })
  await somnia.dream('manual')

  const entries = await somnia.action({ action: 'list' })
  const preference = entries.find((entry) => entry.section === 'preferences' && entry.status === 'foreground')
  const note = entries.find((entry) => entry.section === 'notes' && entry.status === 'background')
  if (!preference || !note) throw new Error('The example needs a foreground preference and a background note.')
  const evidence = await somnia.action({ action: 'source', id: preference.id })

  console.log('Somnia quickstart · local example with a simulated model response')
  console.log(`Foreground preference · ${preference.text} (${preference.scope.object}, ${preference.scope.situation})`)
  console.log(`Background note · ${note.text} (${note.scope.object}, ${note.scope.situation})`)
  console.log(`Evidence · “${evidence.quote}”`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
