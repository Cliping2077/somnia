# dsh-plugin-sleep-memory

Sleep-stage long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai):
a 7-day episodic buffer, a background nap that **rewrites** the memory summary,
active forgetting, snapshots, and a sleep indicator in the conversation tail.

## Install

```bash
dsh plugin add ./packages/dsh-memory
```

Then enable **sleep-memory** in the plugin manager and refresh the page once so
the client half loads.

Remove:

```bash
dsh plugin remove dsh-plugin-sleep-memory
```

## What it does

- Captures every user message (6–600 chars, not slash commands) into
  `~/.dsh/memory/episodes.jsonl`, capped at 2000 lines and 7 days.
- After `idleMinutes` (default 10) without a running turn, and after a
  5-minute cooldown, runs one nap: select salient episodes → one model call
  rewrites the whole summary → downscale → trim → snapshot + report.
- Injects up to 8 foreground entries (~1400 chars) into the system prompt.
- A user message always outranks a nap; a nap never creates a session.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `idleMinutes` | `10` | idle minutes before a nap; `0` disables the idle nap |

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
| `wash` | run a rewrite now |
| `state` | sleep state, entry and episode counts |
| `config` | set `idleMinutes` |
| `snapshots` | list snapshot files |
| `restore` | restore a snapshot by name |

## Files

```
~/.dsh/memory/
  episodes.jsonl
  memory.json
  snapshots/
  dreams/YYYY-MM-DD.md
  dream-report.md
  dream-journal.json
  state.json
```

## Notes

- Local only; the only network call is the model provider already configured in
  DSH.
- The store is a summary, not a transcript; `memory list` / `forget` /
  `restore` are the escape hatches.
- Windows is verified; macOS/Linux use `os.homedir()` and should work but are
  not yet tested.

License: MIT.
