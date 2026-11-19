# @somnia/core

Host-agnostic sleep-stage memory. No Cordis, no DSH, no network.

```js
import { createSomnia } from '@somnia/core'

const somnia = createSomnia({
  dir: './.somnia',                  // episodes.jsonl, memory.json, snapshots/, dreams/
  generate: async ({ system, user, maxTokens }) => {
    // one completion from your model; return raw text
  },
})

somnia.capture('session-1', '我不吃辣')       // ephemeral buffer
await somnia.dream('manual')                  // replay → rewrite → downscale
somnia.injectText()                           // put this in your system prompt
await somnia.action({ action: 'search', query: '辣' })
await somnia.action({ action: 'state' })
```

The host owns three things: how messages arrive (`capture`), when the agent is idle
(`dream`), and the model call (`generate`). Everything else — salience, the rewrite
prompt, time-shift, downscale, snapshots, injection, the 12 memory actions — is in
the core.

Smoke test: `node packages/core/test/smoke.mjs`.
