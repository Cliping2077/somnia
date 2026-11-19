# Install the DSH adapter

Somnia ships as a DeepSeek Harness bundle named `dsh-plugin-sleep-memory`.

## Install a local bundle

1. In the DeepSeek Harness **Plugins** page, install a local bundle using the
   absolute path of the checkout's `packages/dsh-memory` directory. Keep the
   directory available because the installation links to it.
2. Check that the bundle and its `memory` plugin are enabled. Restart DSH if
   the Plugin Manager reports that a restart is required.

The equivalent Harness tool is
`plugin_manager({ action: 'install_bundle', target: '/absolute/path/to/packages/dsh-memory' })`.

To prepare a standalone bundle directory, run
`node scripts/install-dsh.mjs /path/to/dsh-memory` and use the resulting directory
as the Plugin Manager target. The script copies the packaged files. The Plugin
Manager registers and activates the bundle for the current profile.

## What you get

- `episodes.jsonl` buffer under `~/.dsh/memory`
- a dream after 10 idle minutes (configurable with `memory({action:'config'})`)
- a synthesized `memory.json` injected into the system prompt
- `dream-report.md`, `dreams/`, `snapshots/`
- the `memory` tool for saving, reviewing, and restoring memories
- the sleep row in the conversation tail

The sleep row estimates idle time from the conversation status in the client.
The `memory` tool's `state` action shows the actual consolidation state and
configured idle interval.

## Uninstall

Remove the bundle in the DSH Plugin Manager. Memory data stays in `~/.dsh/memory`.
