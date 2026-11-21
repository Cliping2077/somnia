# dsh-plugin-sleep-memory

Sleep-stage long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai):
a 30-day episodic replay window, a background nap that consolidates memories,
active forgetting, snapshots, and a sleep indicator in the conversation tail.

## Install

In the DeepSeek Harness **Plugins** page, install a local bundle by selecting
this package directory. Check that the bundle and its `memory` plugin are
enabled. Restart DSH if the Plugin Manager requests it.

To uninstall, remove the bundle from the same page. Memory data stays on disk.

## What it does

- Captures eligible user text (6–600 characters) after redaction into
  `~/.dsh/memory/episodes.jsonl`. A nap keeps up to 5,000 episodes in the active buffer.
- After `idleMinutes` (default 10) without a running turn, and after a
  6-hour minimum cooldown, runs one nap. It selects salient episodes, applies
  evidence-backed changes, and writes a report and recovery snapshot.
- Adds up to 2,400 characters of memory to the system prompt, with pinned and
  profile entries given priority.
- A user message always outranks a nap; a nap never creates a session.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `idleMinutes` | `10` | idle minutes before a nap; `0` disables the idle nap |
| `dreamCooldownMinutes` | `360` | minimum interval between automatic attempts; values below 360 use 360 |

Runtime override: `memory { "action": "config", "idleMinutes": 10 }`.

## Tools

| Action | Purpose |
| --- | --- |
| `save` | add a foreground entry |
| `search` | term-overlap search; bumps use counts |
| `list` | recent entries, optional status filter |
| `hide` / `show` | move an entry to background / foreground |
| `forget` | delete an entry |
| `dream` | run one nap now |
| `wash` | request a broader consolidation |
| `state` | sleep state, entry and episode counts |
| `config` | set `idleMinutes` |
| `snapshots` | list snapshot files |
| `restore` | restore a snapshot by name |

## Files

```
~/.dsh/memory/
  episodes.jsonl
  episodes-archive.jsonl
  memory.json
  snapshots/
  dreams/YYYY-MM-DD.md
  dream-report.md
  dream-journal.json
  state.json
```

## Notes

- Memory files stay on disk. For model-backed consolidation, selected
  episodes and memory entries go to the model provider configured in DSH.
- `memory list`, `source`, `forget`, and `restore` let you inspect or change
  the long-term store. The episode archive and snapshots have their own
  retention.
- Automated tests and package checks have passed on Windows and Ubuntu.

License: MIT.
