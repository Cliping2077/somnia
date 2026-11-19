# Install the DSH adapter

Somnia ships as a host-agnostic core plus a DeepSeek Harness adapter. DSH is the
default and needs no configuration beyond copying the adapter directory.

## One command

```bash
node scripts/install-dsh.mjs
```

Default destination:

```text
~/Documents/deepseek-harness/default-workspace/dsh-memory
```

Or point it at another profile plugin directory:

```bash
node scripts/install-dsh.mjs /path/to/dsh-memory
```

The script copies `index.js`, `core.js`, `client.js`, `package.json`,
`cordis.patch.yml`, `icon.svg`, and `locale/`. The adapter is self-contained —
`index.js` imports `./core.js`, so no npm install is needed.

## Restart

Restart DSH (or reload the plugin) after copying. The sleep indicator and the
`memory` tool appear in the session.

## What you get

- `episodes.jsonl` buffer under `~/.dsh/memory`
- a dream after 10 idle minutes (configurable with `memory({action:'config'})`)
- a synthesized `memory.json` injected into the system prompt
- `dream-report.md`, `dreams/`, `snapshots/`
- the `memory` tool with 12 actions
- the sleep row in the conversation tail

## Uninstall

Remove the plugin directory (or restore the previous `index.js`). Memory data stays
in `~/.dsh/memory`; delete that directory to forget everything.
